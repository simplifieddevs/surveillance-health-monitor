import { EnvKeyProvider } from "../../src/crypto/env-key-provider.js";
import { CredentialVault } from "../../src/crypto/credential-vault.js";

/**
 * Build a CredentialVault with a deterministic key.
 * Tests should not depend on env vars; this helper ensures that.
 */
export function fakeVault(): CredentialVault {
  // EnvKeyProvider reads from process.env; force CRED_ENC_KEY.
  process.env.CRED_ENC_KEY = "a".repeat(43) + "="; // 32 bytes base64
  delete process.env.CRED_ENC_KEY_VERSIONS;
  delete process.env.CRED_ENC_KEY_VERSION;
  return new CredentialVault(new EnvKeyProvider());
}
