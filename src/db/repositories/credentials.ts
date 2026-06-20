import { and, eq } from "drizzle-orm";
import { devices } from "../schema.js";
import type { Db } from "../client.js";
import type { TenantContext } from "../../core/tenant-context.js";
import { err } from "../../core/errors.js";
import { CredentialVault, type EncryptedCredential } from "../../crypto/credential-vault.js";

/**
 * Credential repository — the only layer that decrypts device credentials.
 *
 * Contract:
 *   - The route layer never sees ResolvedCredential.
 *   - Adapters call `withResolvedCredential` and receive the plaintext
 *     inside the closure. The plaintext is dropped when the closure
 *     returns. (No persistent references.)
 *   - The closure is expected to be short-lived (one HTTP poll).
 */

export async function rotateDeviceCredential(
  db: Db,
  ctx: TenantContext,
  deviceId: string,
  vault: CredentialVault,
  next: { username?: string; password?: string; token?: string; raw?: string },
): Promise<EncryptedCredential> {
  const blob = vault.encrypt(next);
  await db
    .update(devices)
    .set({
      credentialCipher: blob.ciphertext,
      credentialIv: blob.iv,
      credentialKeyVersion: blob.keyVersion,
      updatedAt: new Date(),
    })
    .where(and(eq(devices.companyId, ctx.companyId), eq(devices.id, deviceId)));
  return blob;
}

/**
 * Decrypt-and-use. The resolved credential lives only inside `use`.
 * Errors thrown from `use` propagate; vault errors are surfaced as
 * CREDENTIAL_DECRYPT_FAILED.
 */
export async function withResolvedCredential<T>(
  db: Db,
  ctx: TenantContext,
  deviceId: string,
  vault: CredentialVault,
  use: (cred: { username?: string; password?: string; token?: string; raw?: string }) => Promise<T>,
): Promise<T> {
  const rows = await db
    .select({
      cipher: devices.credentialCipher,
      iv: devices.credentialIv,
      kv: devices.credentialKeyVersion,
    })
    .from(devices)
    .where(and(eq(devices.companyId, ctx.companyId), eq(devices.id, deviceId)))
    .limit(1);
  const row = rows[0];
  if (!row) throw err.notFound("Device", deviceId);
  const blob: EncryptedCredential = {
    ciphertext: row.cipher,
    iv: row.iv,
    keyVersion: row.kv,
  };
  const resolved = vault.decrypt(blob, deviceId);
  try {
    return await use(resolved);
  } finally {
    // Best-effort scrub of local references. We can't reach inside
    // adapters, but we can drop our handle.
    void resolved;
  }
}
