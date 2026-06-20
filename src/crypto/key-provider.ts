/**
 * KeyProvider — abstraction over where AES-GCM keys live.
 *
 * The active key version is the only one used to *encrypt* new
 * ciphertexts. Older versions remain available to *decrypt* existing
 * ciphertexts, so a rotation does not require re-encrypting the world.
 *
 * Production deployments implement this against AWS KMS, GCP KMS,
 * Vault Transit, or similar. The default EnvKeyProvider reads keys
 * from process.env.
 */

export interface KeyVersion {
  /** Monotonically increasing integer version. */
  readonly version: number;
  /** 32 raw bytes for AES-256-GCM. */
  readonly key: Buffer;
}

export interface KeyProvider {
  /** Highest-versioned key. Used for encryption. */
  readonly active: KeyVersion;
  /**
   * Look up a specific version for decryption.
   * Throws if the version is unknown — caller's responsibility to surface
   * a "cannot decrypt — rotate and re-save" error.
   */
  get(version: number): KeyVersion;
  /** All known versions (for ops introspection). */
  versions(): readonly KeyVersion[];
}
