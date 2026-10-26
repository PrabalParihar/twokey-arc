import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { fileURLToPath } from 'node:url';
import type { Db } from './client';

/** Kept out of the package index so the web bundle never pulls in the migrations folder. */
export const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations', import.meta.url));

export async function migrateDb(db: Db): Promise<void> {
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
}
