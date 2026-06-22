import { z } from "zod";

/**
 * Single source of truth for runtime configuration.
 * Validated at boot. No process.env access outside this module.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HTTP_HOST: z.string().default("0.0.0.0"),
  HTTP_PORT: z.coerce.number().int().positive().default(8080),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),

  // Set DISABLE_AUTH=true to bypass JWT verification (dev/demo only).
  DISABLE_AUTH: z
    .string()
    .optional()
    .transform((v) => v === "true" || v === "1"),

  JWT_SECRET: z.string().min(32, "JWT_SECRET must be >=32 chars").optional(),
  JWT_ISSUER: z.string().default("shm"),
  JWT_AUDIENCE: z.string().default("shm-api"),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  CRED_ENC_KEY: z.string().min(1, "CRED_ENC_KEY is required"),

  POLL_CONCURRENCY: z.coerce.number().int().positive().default(64),
  POLL_DEFAULT_INTERVAL_S: z.coerce.number().int().positive().default(60),
  POLL_JITTER_S: z.coerce.number().int().nonnegative().default(5),

  VENDOR_HTTP_TIMEOUT_MS: z.coerce.number().int().positive().default(4000),
  VENDOR_HTTP_RETRIES: z.coerce.number().int().nonnegative().default(2),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | undefined;

/**
 * Parse and freeze env once. Subsequent calls return the cached object.
 * Throws on invalid config — fail fast at boot.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const data = parsed.data;
  // JWT_SECRET is required unless DISABLE_AUTH is set.
  if (!data.DISABLE_AUTH && (!data.JWT_SECRET || data.JWT_SECRET.length < 32)) {
    throw new Error(
      "Invalid environment configuration:\n  - JWT_SECRET: must be >=32 chars (or set DISABLE_AUTH=true)",
    );
  }
  cached = Object.freeze(data);
  return cached;
}

/** For tests: reset cache so loadEnv re-reads from a mutated process.env. */
export function resetEnvCache(): void {
  cached = undefined;
}
