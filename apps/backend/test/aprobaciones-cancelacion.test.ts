import { describe, it, expect, vi } from 'vitest';
import type { Sql } from '@ledesma-platform/shared';
import {
  AprobacionesWebRepository,
  INSTRUCCION_CANCELADA_POR_USUARIO,
  INSTRUCCION_CANCELADA_SESION_CERRADA,
} from '../src/aprobaciones/aprobaciones-repository.js';

/**
 * Cierre de la aprobacion al CANCELAR un job pausado desde la consola (CAMBIO 5) y reclamo de la
 * marca por el barrido del worker (que cierra la sesion de navegador del checkpoint). Mismo estilo
 * de mock del tagged template `sql` que jobs-repository.test.ts de shared.
 */

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'apr-1',
    owner_id: 'user-1',
    job_id: 'job-1',
    connection_id: 'conn-1',
    sesion_externa_id: 'ses-1',
    accion_tipo: 'financiera',
    descripcion: 'Enviar el pago',
    screenshot_path: null,
    estado: 'rechazada',
    instruccion_rechazo: INSTRUCCION_CANCELADA_POR_USUARIO,
    decidida_por: 'user-1',
    decidida_en: '2026-07-24T00:00:00.000Z',
    creada_en: '2026-07-24T00:00:00.000Z',
    expira_en: '2026-07-24T00:15:00.000Z',
    ...overrides,
  };
}

function makeSql(result: unknown[]): Sql {
  const fn = vi.fn(async () => result) as unknown as Sql;
  (fn as unknown as { json: (v: unknown) => unknown }).json = (v: unknown) => v;
  return fn;
}

function sqlText(sql: Sql): string {
  const calls = (sql as unknown as { mock: { calls: Array<[readonly string[], ...unknown[]]> } }).mock.calls;
  return (calls[0]?.[0] ?? []).join('<param>');
}

function sqlValues(sql: Sql): unknown[] {
  const calls = (sql as unknown as { mock: { calls: Array<[readonly string[], ...unknown[]]> } }).mock.calls;
  const [, ...values] = (calls[0] ?? [[]]) as [readonly string[], ...unknown[]];
  return values;
}

describe('cerrarPendientePorCancelacion', () => {
  it("CAS 'pendiente' -> 'rechazada' con la marca de cancelacion, acotado por job_id + owner_id", async () => {
    const sql = makeSql([makeRow()]);
    const aprobacion = await new AprobacionesWebRepository(sql).cerrarPendientePorCancelacion(
      'job-1',
      'user-1',
      'user-1',
    );
    expect(aprobacion).toMatchObject({ id: 'apr-1', estado: 'rechazada', sesionExternaId: 'ses-1' });
    const texto = sqlText(sql);
    expect(texto).toContain("estado = 'rechazada'");
    expect(texto).toContain("estado = 'pendiente'");
    expect(texto).toContain('job_id = ');
    expect(texto).toContain('owner_id = ');
    // A diferencia de decidir(), NO exige expira_en > now(): cancelar siempre cierra el checkpoint.
    expect(texto).not.toContain('expira_en >');
    expect(sqlValues(sql)).toEqual([INSTRUCCION_CANCELADA_POR_USUARIO, 'user-1', 'job-1', 'user-1']);
  });

  it('sin aprobacion pendiente (ya decidida/expirada o job sin checkpoint) -> null, sin efectos', async () => {
    const aprobacion = await new AprobacionesWebRepository(makeSql([])).cerrarPendientePorCancelacion(
      'job-1',
      'user-1',
      'user-1',
    );
    expect(aprobacion).toBeNull();
  });
});

describe('reclamarCanceladasParaCerrarSesion', () => {
  it('reclama la marca en un UPDATE atomico (cada sesion se procesa una sola vez) y devuelve las filas', async () => {
    const sql = makeSql([makeRow({ instruccion_rechazo: INSTRUCCION_CANCELADA_SESION_CERRADA })]);
    const canceladas = await new AprobacionesWebRepository(sql).reclamarCanceladasParaCerrarSesion();
    expect(canceladas).toHaveLength(1);
    expect(canceladas[0]?.sesionExternaId).toBe('ses-1');
    const texto = sqlText(sql);
    expect(texto).toContain('update aprobaciones_web set instruccion_rechazo = ');
    expect(texto).toContain("estado = 'rechazada'");
    const values = sqlValues(sql);
    // CAS de la marca: de "por cerrar" a "sesion cerrada"; un segundo barrido no reclama nada.
    expect(values).toContain(INSTRUCCION_CANCELADA_POR_USUARIO);
    expect(values).toContain(INSTRUCCION_CANCELADA_SESION_CERRADA);
  });

  it('sin canceladas pendientes de cierre -> []', async () => {
    const canceladas = await new AprobacionesWebRepository(makeSql([])).reclamarCanceladasParaCerrarSesion();
    expect(canceladas).toEqual([]);
  });
});
