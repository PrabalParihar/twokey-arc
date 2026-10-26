import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema';

export type Db = NodePgDatabase<typeof schema>;
/** A transaction handle; same query surface as Db. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type DbOrTx = Db | Tx;

// numeric -> string (exact), bigint (int8) -> number for audit seq.
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));

export function createDb(url: string, max = 10): { db: Db; pool: pg.Pool } {
  const pool = new pg.Pool({ connectionString: url, max });
  return { db: drizzle(pool, { schema }), pool };
}
