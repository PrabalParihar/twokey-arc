import { createDb } from './client';
import { migrateDb } from './migrator';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');
const { db, pool } = createDb(url, 1);
await migrateDb(db);
await pool.end();
console.log('migrations applied');
