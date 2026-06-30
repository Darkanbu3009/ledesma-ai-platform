import postgres from 'postgres';
import type { Sql } from '@ledesma-platform/shared';

let instance: Sql | undefined;

/**
 * Cliente Postgres singleton (pooler de Supabase). Mismo patron que apps/backend/src/db/client.ts:
 * lazy, prepare:false (compatible con el pooler en modo transaction). El worker se conecta a la MISMA
 * base que el backend.
 */
export function getSql(databaseUrl: string): Sql {
  if (!instance) {
    instance = postgres(databaseUrl, { max: 5, prepare: false });
  }
  return instance;
}

/**
 * Cierra el pool (shutdown limpio). timeoutSeconds acota el drenaje: tras ese plazo la libreria
 * postgres RECHAZA las queries en vuelo y resuelve el end(), en vez de esperar indefinidamente. Sin
 * timeout, una conexion colgada haria que end() no resolviera nunca y bloqueara el shutdown.
 */
export async function closeSql(timeoutSeconds?: number): Promise<void> {
  if (instance) {
    await (timeoutSeconds !== undefined ? instance.end({ timeout: timeoutSeconds }) : instance.end());
    instance = undefined;
  }
}
