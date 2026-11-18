import { migrate } from "drizzle-orm/node-postgres/migrator";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { loadConfig } from "../config.js";
import { createDatabase, type Database } from "./client.js";

export async function runMigrations(db: Database): Promise<void> {
  await migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
}

export async function migrateWithRetry(db: Database, attempts = 20): Promise<void> {
  let last: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await runMigrations(db);
      return;
    } catch (error) {
      last = error;
      if (attempt === attempts) break;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
    }
  }
  throw last;
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (invokedDirectly) {
  const config = loadConfig();
  const { db, pool } = createDatabase(config.databaseUrl);
  try {
    await migrateWithRetry(db);
  } finally {
    await pool.end();
  }
}
