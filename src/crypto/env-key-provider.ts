import type { KeyProvider, KeyVersion } from "./key-provider.js";

/**
 * EnvKeyProvider — reads keys from process.env.
 *
 * Active key: process.env.CRED_ENC_KEY (base64, 32 bytes).
 * Additional versions: process.env.CRED_ENC_KEY_VERSIONS as a JSON map
 * keyed by integer version, e.g. {"1":"<b64>","2":"<b64>"}. The active
 * key is auto-versioned as the max(in map) + 1 unless CRED_ENC_KEY_VERSION
 * is set explicitly.
 */

const IV_BYTES = 12;       // 96-bit IV — recommended for GCM
const TAG_BYTES = 16;      // 128-bit auth tag — GCM default

function decodeKey(label: string, raw: string): Buffer {
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) {
    throw new Error(`${label} must decode to exactly 32 bytes (got ${buf.length})`);
  }
  return buf;
}

export class EnvKeyProvider implements KeyProvider {
  private readonly byVersion: Map<number, Buffer>;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    if (!env.CRED_ENC_KEY) {
      throw new Error("CRED_ENC_KEY is required");
    }
    this.byVersion = new Map();

    // Older versions, if any.
    if (env.CRED_ENC_KEY_VERSIONS) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(env.CRED_ENC_KEY_VERSIONS);
      } catch (cause) {
        throw new Error("CRED_ENC_KEY_VERSIONS is not valid JSON", { cause });
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("CRED_ENC_KEY_VERSIONS must be a JSON object");
      }
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        const version = Number(k);
        if (!Number.isInteger(version) || version <= 0) continue;
        if (typeof v !== "string") continue;
        this.byVersion.set(version, decodeKey(`CRED_ENC_KEY_VERSIONS[${k}]`, v));
      }
    }

    // Active key — explicit version if set, else max(known) + 1.
    const explicitVersion = env.CRED_ENC_KEY_VERSION
      ? Number(env.CRED_ENC_KEY_VERSION)
      : undefined;
    if (explicitVersion !== undefined) {
      if (!Number.isInteger(explicitVersion) || explicitVersion <= 0) {
        throw new Error("CRED_ENC_KEY_VERSION must be a positive integer");
      }
      this.byVersion.set(explicitVersion, decodeKey("CRED_ENC_KEY", env.CRED_ENC_KEY));
    } else {
      const next = (this.byVersion.size === 0 ? 1 : Math.max(...this.byVersion.keys()) + 1);
      this.byVersion.set(next, decodeKey("CRED_ENC_KEY", env.CRED_ENC_KEY));
    }
  }

  get active(): KeyVersion {
    let best: KeyVersion | undefined;
    for (const [version, key] of this.byVersion) {
      if (!best || version > best.version) best = { version, key };
    }
    if (!best) throw new Error("EnvKeyProvider: no keys configured");
    return best;
  }

  get(version: number): KeyVersion {
    const key = this.byVersion.get(version);
    if (!key) throw new Error(`Unknown key version: ${version}`);
    return { version, key };
  }

  versions(): readonly KeyVersion[] {
    return Array.from(this.byVersion, ([version, key]) => ({ version, key })).sort(
      (a, b) => a.version - b.version,
    );
  }
}

export { IV_BYTES, TAG_BYTES };
