import pg from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import * as schema from './schema.js'

const pools = new WeakMap<object, pg.Pool>()

export function createDb(url: string) {
  const pool = new pg.Pool({ connectionString: url })
  const db = drizzle(pool, { schema })
  pools.set(db, pool)
  return db
}

export type Db = ReturnType<typeof createDb>

/** Drains the underlying pg pool for a db created by createDb(); no-op if unknown. */
export async function closeDb(db: Db): Promise<void> {
  const pool = pools.get(db)
  if (pool) await pool.end()
}
