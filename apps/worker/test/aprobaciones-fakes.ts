import { vi } from 'vitest';
import type { AprobacionWeb } from '@ledesma-platform/backend/aprobaciones';
import type { RepositorioAprobacionesParaWorker } from '../src/aprobaciones.js';

/** Fabrica de fixtures de aprobaciones (7.1e) compartida por los tests del worker. */
export function makeAprobacion(overrides: Partial<AprobacionWeb> = {}): AprobacionWeb {
  return {
    id: 'apr-1',
    ownerId: 'user-1',
    jobId: 'job-1',
    connectionId: '99999999-9999-4999-8999-999999999999',
    sesionExternaId: 'ses-1',
    accionTipo: 'financiera',
    descripcion: 'Enviar el formulario de pago por 2,400 MXN a Aeromexico',
    screenshotPath: 'user-1/apr-1.png',
    estado: 'pendiente',
    instruccionRechazo: null,
    decididaPor: null,
    decididaEn: null,
    creadaEn: '2026-07-20T00:00:00.000Z',
    expiraEn: '2026-07-20T00:15:00.000Z',
    ...overrides,
  };
}

/** Fake del repositorio de aprobaciones para el worker (sin base). */
export function makeAprobacionesRepo(
  overrides: Partial<RepositorioAprobacionesParaWorker> = {},
): RepositorioAprobacionesParaWorker {
  return {
    crear: vi.fn(async (input) =>
      makeAprobacion({
        ownerId: input.ownerId,
        jobId: input.jobId,
        connectionId: input.connectionId,
        sesionExternaId: input.sesionExternaId,
        accionTipo: input.accionTipo,
        descripcion: input.descripcion,
        screenshotPath: input.screenshotPath ?? null,
        estado: 'pendiente',
        expiraEn: new Date(input.expiraEn).toISOString(),
      }),
    ),
    guardarScreenshotPath: vi.fn(async () => {}),
    // Por defecto NO hay checkpoint previo: el camino "fresco" de 7.1d.
    obtenerVigentePorJob: vi.fn(async () => null),
    listarPendientesVencidas: vi.fn(async () => []),
    expirar: vi.fn(async () => true),
    reclamarCanceladasParaCerrarSesion: vi.fn(async () => []),
    registrarIntervencion: vi.fn(async () => {}),
    ...overrides,
  };
}
