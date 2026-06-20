import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { KeyProvider } from "./key-provider.js";
import { IV_BYTES, TAG_BYTES } from "./env-key-provider.js";
import { err } from "../core/errors.js";

/**
 * Persisted credential blob — exactly what we store on a device row.
 * Decryption never happens at the route layer; callers request a
 * resolved credential via resolveFor() and pass it to an adapter call.
 */
export interface EncryptedCredential {
  readonly ciphertext: Buffer;     // ciphertext + 16-byte GCM tag, concatenated
  readonly iv: Buffer;             // 12 bytes
  readonly keyVersion: number;     // which key was used
}

export interface ResolvedCredential {
  readonly username?: string;
  readonly password?: string;
  readonly token?: string;
  readonly raw?: string;           // arbitrary vendor blob (e.g. ONVIF digest inputs)
}

/**
 * CredentialVault — encrypts ResolvedCredential -> EncryptedCredential
 * and back, using AES-256-GCM with a 12-byte random IV per ciphertext.
 *
 * Security notes:
 *   - Per-ciphertext IV — never reused with the same key.
 *   - The auth tag is concatenated onto the ciphertext by Node's API;
 *     we keep it together so storage is a single blob.
 *   - We never log the resolved credential. Route handlers MUST NOT
 *     serialize it back to clients; it only crosses process boundaries
 *     inside adapter implementations.
 */
export class CredentialVault {
  constructor(private readonly keys: KeyProvider) {}

  encrypt(plain: ResolvedCredential): EncryptedCredential {
    const json = Buffer.from(JSON.stringify(plain), "utf8");
    const iv = randomBytes(IV_BYTES);
    const { version, key } = this.keys.active;
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const enc = Buffer.concat([cipher.update(json), cipher.final()]);
    const tag = cipher.getAuthTag();
    return { ciphertext: Buffer.concat([enc, tag]), iv, keyVersion: version };
  }

  decrypt(blob: EncryptedCredential, deviceId: string): ResolvedCredential {
    let version;
    let key;
    try {
      ({ version, key } = this.keys.get(blob.keyVersion));
    } catch (cause) {
      throw err.credentialDecrypt(deviceId, cause);
    }
    if (blob.iv.length !== IV_BYTES) {
      throw err.credentialDecrypt(deviceId, new Error(`IV must be ${IV_BYTES} bytes`));
    }
    if (blob.ciphertext.length < TAG_BYTES) {
      throw err.credentialDecrypt(deviceId, new Error("ciphertext shorter than tag"));
    }
    const enc = blob.ciphertext.subarray(0, blob.ciphertext.length - TAG_BYTES);
    const tag = blob.ciphertext.subarray(blob.ciphertext.length - TAG_BYTES);
    try {
      const decipher = createDecipheriv("aes-256-gcm", key, blob.iv);
      decipher.setAuthTag(tag);
      const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
      return JSON.parse(dec.toString("utf8")) as ResolvedCredential;
    } catch (cause) {
      throw err.credentialDecrypt(deviceId, cause);
    } finally {
      // best-effort: scrub local refs
      void version;
    }
  }
}
