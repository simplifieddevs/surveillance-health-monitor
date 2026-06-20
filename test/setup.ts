/**
 * Test bootstrap. Mints a deterministic AES key for env, ensures the
 * required vars exist before any module that calls loadEnv() runs.
 */
import { randomBytes } from "node:crypto";

const KEY = randomBytes(32).toString("base64");

process.env.NODE_ENV ??= "test";
process.env.LOG_LEVEL ??= "fatal";
process.env.JWT_SECRET ??= "x".repeat(48);
process.env.JWT_ISSUER ??= "shm-test";
process.env.JWT_AUDIENCE ??= "shm-test-api";
process.env.DATABASE_URL ??= "postgres://shm:shm@127.0.0.1:5432/shm_test";
process.env.REDIS_URL ??= "redis://127.0.0.1:6379/1";
process.env.CRED_ENC_KEY ??= KEY;
process.env.HTTP_PORT ??= "18080";
