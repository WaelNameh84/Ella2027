import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "@workspace/db";
import { logger } from "./logger";

const MIGRATION_LOCK_KEY = 717_202_606;
const MIGRATION_DIRECTORY = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../lib/db/migrations",
);

/**
 * Apply the repository's additive SQL migrations before accepting requests.
 * The transaction-scoped advisory lock serializes concurrent Render instances
 * and works with both direct and pooled Neon connections.
 */
export async function runDatabaseMigrations(): Promise<void> {
  const client = await pool.connect();
  const appliedMigrations: string[] = [];
  let transactionStarted = false;

  try {
    await client.query("BEGIN");
    transactionStarted = true;
    await client.query("SELECT pg_advisory_xact_lock($1::integer)", [MIGRATION_LOCK_KEY]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS studio_schema_migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const migrationFiles = (await readdir(MIGRATION_DIRECTORY))
      .filter((file) => /^\d+_[a-z0-9_-]+\.sql$/i.test(file))
      .sort();

    for (const name of migrationFiles) {
      const alreadyApplied = await client.query(
        "SELECT 1 FROM studio_schema_migrations WHERE name = $1 LIMIT 1",
        [name],
      );
      if (alreadyApplied.rowCount) continue;

      const sql = await readFile(resolve(MIGRATION_DIRECTORY, name), "utf8");
      await client.query(sql);
      await client.query(
        "INSERT INTO studio_schema_migrations (name) VALUES ($1)",
        [name],
      );
      appliedMigrations.push(name);
    }

    await client.query("COMMIT");
    transactionStarted = false;
    for (const migration of appliedMigrations) {
      logger.info({ migration }, "Applied database migration");
    }
  } catch (error) {
    if (transactionStarted) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        logger.error({ err: rollbackError }, "Could not roll back database migrations");
      }
    }
    throw new Error("Database migration startup failed.", { cause: error });
  } finally {
    client.release();
  }
}
