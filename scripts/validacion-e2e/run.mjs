#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { cargarEnv, crearRedactor } from './lib/env.mjs';
import { crearPgrest } from './lib/pgrest.mjs';
import { pedirJson } from './lib/http.mjs';
import { crearReporte } from './lib/reporte.mjs';
import { listarUsuariosPruebaRestantes, borrarUsuario } from './lib/supabase.mjs';
import { faseInfra } from './fases/infra.mjs';
import { faseIdentidad } from './fases/identidad.mjs';
import { faseBoveda } from './fases/boveda.mjs';
import { faseEjecucion } from './fases/ejecucion.mjs';
import { faseWorker } from './fases/worker.mjs';
import { faseScheduler } from './fases/scheduler.mjs';
import { faseTriggers } from './fases/triggers.mjs';
import { faseCumplimiento } from './fases/cumplimiento.mjs';
import { faseGates } from './fases/gates.mjs';
import { limpiezaFinal, limpiarRestosDeOwner } from './fases/limpieza.mjs';

/**
 * VALIDACION END-TO-END AUTOMATIZADA contra PRODUCCION (fases 3-5 de la plataforma: boveda,
 * ejecucion, worker, scheduler, triggers, recetas, cumplimiento y gates por tier).
 *
 * - Secretos: SOLO desde .env.validation en la raiz (nunca commiteado; cubierto por .gitignore).
 * - Todo lo creado lleva el prefijo E2E-VALIDACION y un usuario propio; la limpieza final corre
 *   SIEMPRE y toca exclusivamente filas de ese owner.
 * - Idempotente / re-ejecutable: cada corrida usa un usuario nuevo y arranca barriendo restos de
 *   corridas anteriores (usuarios validacion-e2e+<ts>@ledesma-ai-labs.com).
 *
 * Uso:  node scripts/validacion-e2e/run.mjs [--sin-limpieza] [--solo-barrido]
 */

const RAIZ_REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

async function main() {
  const flags = new Set(process.argv.slice(2));
  const env = cargarEnv(RAIZ_REPO);
  const redactar = crearRedactor(env);
  const reporte = crearReporte(redactar);

  // Los rechazos y excepciones no capturados tambien pasan por el redactor antes de imprimirse.
  process.on('uncaughtException', (e) => {
    console.error('[FATAL]', redactar(e?.stack ?? String(e)));
    process.exit(1);
  });
  process.on('unhandledRejection', (e) => {
    console.error('[FATAL]', redactar(e instanceof Error ? (e.stack ?? e.message) : String(e)));
    process.exit(1);
  });

  // Acceso a la base via PostgREST (HTTPS): el entorno bloquea el puerto postgres directo. La
  // service_role key bypassa RLS, igual que el rol de servicio del backend.
  const db = crearPgrest(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  const ctx = {
    env,
    db,
    reporte,
    redactar,
    datos: { jobsVistos: new Set() },
    api: (ruta, opciones = {}) =>
      pedirJson(`${env.API_BASE_URL}${ruta}`, {
        ...opciones,
        headers: {
          ...(ctx.datos.jwt ? { authorization: `Bearer ${ctx.datos.jwt}` } : {}),
          ...(opciones.headers ?? {}),
        },
      }),
    apiAdmin: (ruta, opciones = {}) =>
      pedirJson(`${env.API_BASE_URL}${ruta}`, {
        ...opciones,
        headers: { 'x-admin-token': env.ADMIN_API_TOKEN, ...(opciones.headers ?? {}) },
      }),
  };

  console.log('== VALIDACION E2E contra', env.API_BASE_URL, '==\n');

  // BARRIDO PREVIO: restos de corridas anteriores (solo usuarios del patron propio del script).
  try {
    const restos = await listarUsuariosPruebaRestantes(env);
    for (const resto of restos) {
      try {
        await limpiarRestosDeOwner(db, resto.id);
        await borrarUsuario(env, resto.id);
      } catch (error) {
        reporte.info('PREPARACION', `barrido de resto ${resto.email}`, `fallo parcial: ${error.message}`);
      }
    }
    reporte.info('PREPARACION', 'barrido de corridas anteriores', restos.length === 0 ? 'sin restos' : `${restos.length} usuario(s) de prueba viejos eliminados`);
  } catch (error) {
    reporte.info('PREPARACION', 'barrido de corridas anteriores', `no disponible: ${error.message}`);
  }

  if (flags.has('--solo-barrido')) {
    console.log('\nBarrido completado (--solo-barrido).');
    return;
  }

  // FASES en orden. Cada una captura sus propios errores; un lanzamiento inesperado se anota como
  // FAIL de la fase y se sigue (las fases posteriores se auto-saltan si les falta contexto).
  const fases = [
    ['FASE 1 INFRA', faseInfra],
    ['FASE 2 IDENTIDAD', faseIdentidad],
    ['FASE 3 BOVEDA', faseBoveda],
    ['FASE 4 EJECUCION', faseEjecucion],
    ['FASE 5 WORKER', faseWorker],
    ['FASE 6 SCHEDULER', faseScheduler],
    ['FASE 7 TRIGGERS', faseTriggers],
    ['FASE 8 CUMPLIMIENTO', faseCumplimiento],
    ['FASE 9 GATES', faseGates],
  ];

  try {
    for (const [nombre, fase] of fases) {
      console.log(`\n-- ${nombre} --`);
      try {
        await fase(ctx);
      } catch (error) {
        reporte.fail(nombre, 'error inesperado del script en la fase', error instanceof Error ? (error.stack ?? error.message) : String(error));
      }
    }
  } finally {
    console.log('\n-- LIMPIEZA (siempre corre) --');
    if (flags.has('--sin-limpieza')) {
      reporte.info('LIMPIEZA', 'omitida por --sin-limpieza', `owner de prueba: ${ctx.datos.usuario?.id ?? 'n/a'}`);
    } else {
      try {
        await limpiezaFinal(ctx);
      } catch (error) {
        reporte.fail('LIMPIEZA', 'error inesperado en la limpieza', error instanceof Error ? (error.stack ?? error.message) : String(error));
      }
    }
  }

  const salida = reporte.guardar(resolve(RAIZ_REPO, 'scripts/validacion-e2e/salida'), {
    apiBaseUrl: env.API_BASE_URL,
    provider: env.TEST_PROVIDER,
    model: env.TEST_MODEL,
    usuarioPrueba: ctx.datos.usuario?.email ?? null,
  });

  console.log('\n== RESUMEN ==\n');
  console.log(reporte.renderMarkdown());
  console.log(`Resultados: ${salida.rutaJson}`);
  process.exitCode = reporte.hayFallas() ? 1 : 0;
}

main().catch((error) => {
  // El redactor puede no existir aun si fallo cargarEnv; ese error no contiene secretos.
  console.error('[FATAL]', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
