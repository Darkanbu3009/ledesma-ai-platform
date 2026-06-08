import postgres from 'postgres';
import type { Env } from '../config/env.js';

export type Sql = ReturnType<typeof postgres>;

let instance: Sql | undefined;

/** Cliente Postgres singleton (pooler de Supabase). Lazy: se crea al primer uso. */
export function getSql(config: Env): Sql {
  if (!instance) {
    instance = postgres(config.DATABASE_URL, { max: 5, prepare: false });
  }
  return instance;
}

/** Para tests/cierre: permite inyectar o resetear el singleton. */
export function setSqlForTesting(sql: Sql | undefined): void {
  instance = sql;
}
