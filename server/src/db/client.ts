import pg from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import * as schema from './schema.js'

export function createDb(url: string) {
  return drizzle(new pg.Pool({ connectionString: url }), { schema })
}

export type Db = ReturnType<typeof createDb>
