import app from "./app";
import { logger } from "./lib/logger";
import { runDatabaseMigrations } from "./lib/runDatabaseMigrations";
import { pool } from "@workspace/db";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function startServer(): Promise<void> {
  await runDatabaseMigrations();
  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }

    logger.info({ port }, "Server listening");
  });
}

void startServer().catch(async (err: unknown) => {
  logger.fatal({ err }, "Database initialization failed; API server will not start");
  try {
    await pool.end();
  } catch {
    // Keep the original migration/connection failure as the actionable error.
  }
  process.exitCode = 1;
});
