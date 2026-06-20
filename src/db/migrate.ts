import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { systemPool } from "./client.js";
import { getLogger } from "../core/logger.js";

/**
 * Minimal forward-only migration runner. Reads .sql files in lexical
 * order from src/db/migrations and applies any that haven't been recorded
 * in `_migrations`. Tracks applied filenames (not hashes) — for prod
 * you'll want a checksum-based check, but this is enough for dev/test.
 */
const log = getLogger().child({ component: "migrate" });

const MIGRATIONS_TABLE = `
  CREATE TABLE IF NOT EXISTS _migrations (
    name        text PRIMARY KEY,
    applied_at  timestamptz NOT NULL DEFAULT now()
  )
`;

export async function runMigrations(): Promise<void> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const dir = path.resolve(here, "./migrations");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();

  const pool = systemPool();
  await pool.query(MIGRATIONS_TABLE);

  const { rows } = await pool.query<{ name: string }>(
    "SELECT name FROM _migrations ORDER BY name",
  );
  const applied = new Set(rows.map((r) => r.name));

  for (const file of files) {
    if (applied.has(file)) {
      log.debug({ file }, "skip (already applied)");
      continue;
    }
    const sql = await readFile(path.join(dir, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO _migrations(name) VALUES ($1)", [file]);
      await client.query("COMMIT");
      log.info({ file }, "applied");
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }
}

// Allow `node --import tsx src/db/migrate.ts` and `import { runMigrations }`.
if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations()
    .then(() => process.exit(0))
    .catch((e) => {
      log.error({ err: e }, "migration failed");
      process.exit(1);
    });
}
