import { describe, expect, it } from 'vitest';
import {
  buildJobsQuery,
  hasInFlightJobs,
  intervaloRefetchDeLista,
  isJobInFlight,
  jobStatusLabel,
  jobTypeLabel,
  JOBS_LISTA_EN_VUELO_MS,
  JOBS_LISTA_REPOSO_MS,
  type JobActivity,
  type JobStatus,
} from '../src/lib/jobs';

function makeJob(overrides: Partial<JobActivity> = {}): JobActivity {
  return {
    id: 'j1',
    type: 'simple',
    agentId: 'a1',
    status: 'completed',
    attempts: 1,
    lastError: null,
    scheduledFor: null,
    createdAt: '2026-06-30T00:00:00.000Z',
    startedAt: null,
    finishedAt: null,
    ...overrides,
  };
}

describe('jobStatusLabel', () => {
  it('traduce los cinco estados', () => {
    const labels: Record<JobStatus, string> = {
      pending: 'Pendiente',
      running: 'En curso',
      completed: 'Completada',
      failed: 'Fallida',
      pausado: 'Esperando aprobación',
    };
    (Object.keys(labels) as JobStatus[]).forEach((status) => {
      expect(jobStatusLabel(status)).toBe(labels[status]);
    });
  });
});

describe('jobTypeLabel', () => {
  it('recipe -> Receta, simple -> Mensaje, sitio -> Sitio, tarea_web -> Tarea web', () => {
    expect(jobTypeLabel('recipe')).toBe('Receta');
    expect(jobTypeLabel('simple')).toBe('Mensaje');
    expect(jobTypeLabel('sitio')).toBe('Sitio');
    expect(jobTypeLabel('tarea_web')).toBe('Tarea web');
  });
});

describe('isJobInFlight', () => {
  it('pending y running estan en vuelo; completed y failed no', () => {
    expect(isJobInFlight('pending')).toBe(true);
    expect(isJobInFlight('running')).toBe(true);
    expect(isJobInFlight('completed')).toBe(false);
    expect(isJobInFlight('failed')).toBe(false);
  });
});

describe('hasInFlightJobs', () => {
  it('true si algun job esta pending/running', () => {
    expect(hasInFlightJobs([makeJob({ status: 'completed' }), makeJob({ status: 'running' })])).toBe(true);
    expect(hasInFlightJobs([makeJob({ status: 'pending' })])).toBe(true);
  });

  it('false si todos estan en estado terminal o la lista esta vacia', () => {
    expect(hasInFlightJobs([makeJob({ status: 'completed' }), makeJob({ status: 'failed' })])).toBe(false);
    expect(hasInFlightJobs([])).toBe(false);
  });
});

describe('intervaloRefetchDeLista (polling adaptativo de /actividad)', () => {
  it('con algun job en vuelo consulta al ritmo rapido', () => {
    expect(intervaloRefetchDeLista([makeJob({ status: 'running' })])).toBe(JOBS_LISTA_EN_VUELO_MS);
    expect(intervaloRefetchDeLista([makeJob({ status: 'pending' })])).toBe(JOBS_LISTA_EN_VUELO_MS);
  });

  it('con todo terminal (o lista vacia) baja al ritmo de reposo, pero NUNCA se apaga: una tarea recien encolada desde otra pantalla debe aparecer sola', () => {
    expect(intervaloRefetchDeLista([makeJob({ status: 'completed' })])).toBe(JOBS_LISTA_REPOSO_MS);
    expect(intervaloRefetchDeLista([])).toBe(JOBS_LISTA_REPOSO_MS);
    expect(JOBS_LISTA_REPOSO_MS).toBeGreaterThan(0);
  });
});

describe('buildJobsQuery', () => {
  it('incluye limit y offset siempre', () => {
    expect(buildJobsQuery({ limit: 20, offset: 0 })).toBe('?limit=20&offset=0');
    expect(buildJobsQuery({ limit: 10, offset: 40 })).toBe('?limit=10&offset=40');
  });

  it("con status 'all' o ausente NO agrega el filtro", () => {
    expect(buildJobsQuery({ limit: 20, offset: 0, status: 'all' })).toBe('?limit=20&offset=0');
    expect(buildJobsQuery({ limit: 20, offset: 0 })).toBe('?limit=20&offset=0');
  });

  it('con un status concreto agrega el filtro', () => {
    expect(buildJobsQuery({ limit: 20, offset: 0, status: 'failed' })).toBe('?limit=20&offset=0&status=failed');
    expect(buildJobsQuery({ limit: 5, offset: 5, status: 'running' })).toBe('?limit=5&offset=5&status=running');
  });
});

describe('cierres del cupo irreversible (prefijos estables del worker)', () => {
  it('detecta ACCION_SIN_EFECTO_CONFIRMADO solo en jobs failed', async () => {
    const { esJobSinEfectoConfirmado } = await import('../src/lib/jobs');
    const conPrefijo = makeJob({
      status: 'failed',
      lastError: 'ACCION_SIN_EFECTO_CONFIRMADO: la accion se intento pero no se pudo confirmar',
    });
    expect(esJobSinEfectoConfirmado(conPrefijo)).toBe(true);
    expect(esJobSinEfectoConfirmado(makeJob({ status: 'completed', lastError: conPrefijo.lastError }))).toBe(false);
    expect(
      esJobSinEfectoConfirmado(makeJob({ status: 'failed', lastError: 'PermanentExecutionError: x' })),
    ).toBe(false);
  });

  it('detecta GUARDIA_BLOQUEO_REINTENTOS_IRREVERSIBLES solo en jobs failed', async () => {
    const { esJobBloqueadoPorReintentos } = await import('../src/lib/jobs');
    const conPrefijo = makeJob({
      status: 'failed',
      lastError: 'GUARDIA_BLOQUEO_REINTENTOS_IRREVERSIBLES: la guardia bloqueo dos veces seguidas',
    });
    expect(esJobBloqueadoPorReintentos(conPrefijo)).toBe(true);
    expect(esJobBloqueadoPorReintentos(makeJob({ status: 'failed', lastError: null }))).toBe(false);
  });
});

describe('motivoDeGuardadoNoRepetible (fallo permanente del guardado, por familia)', () => {
  it('clasifica el metodo no re-ejecutable con su nombre', async () => {
    const { motivoDeGuardadoNoRepetible } = await import('../src/lib/jobs');
    const motivo = motivoDeGuardadoNoRepetible(
      new Error('PROMOCION_NO_REPETIBLE: metodo no re-ejecutable: select'),
    );
    expect(motivo).toEqual({ tipo: 'metodo', metodo: 'select' });
  });

  it("el placeholder 'ninguno' del worker cae al generico (no hay nombre util que mostrar)", async () => {
    const { motivoDeGuardadoNoRepetible } = await import('../src/lib/jobs');
    expect(
      motivoDeGuardadoNoRepetible(new Error('PROMOCION_NO_REPETIBLE: metodo no re-ejecutable: ninguno')),
    ).toEqual({ tipo: 'generico' });
  });

  it('clasifica el paso sin estrategia y el dato sin cubrir', async () => {
    const { motivoDeGuardadoNoRepetible } = await import('../src/lib/jobs');
    expect(
      motivoDeGuardadoNoRepetible(
        new Error('PROMOCION_NO_REPETIBLE: paso act sin ninguna estrategia de localizacion'),
      ),
    ).toEqual({ tipo: 'sinEstrategia' });
    // Motivos nuevos del worker (FIX B): nombran indice y descripcion del paso que bloqueo.
    expect(
      motivoDeGuardadoNoRepetible(
        new Error(
          'PROMOCION_NO_REPETIBLE: paso 13: type the message into the body, sin estrategia y sin paso adyacente que cubra el campo',
        ),
      ),
    ).toEqual({ tipo: 'sinEstrategia', paso: '13', descripcion: 'type the message into the body' });
    expect(
      motivoDeGuardadoNoRepetible(
        new Error(
          'PROMOCION_NO_REPETIBLE: el click del paso 19 (click the message body area) quedo sin ninguna estrategia de localizacion y ninguna escritura posterior lo cubre',
        ),
      ),
    ).toEqual({ tipo: 'sinEstrategia', paso: '19', descripcion: 'click the message body area' });
    // Motivo VIGENTE: el paso que SI registro el dato y que ningun otro vuelve a escribir. El worker
    // ya no aborta por una cabecera de llenado vacia, que no escribio nada.
    expect(
      motivoDeGuardadoNoRepetible(
        new Error(
          'PROMOCION_NO_REPETIBLE: el paso con metodo fill llevaba el dato asunto del objetivo y ningun otro paso lo cubre',
        ),
      ),
    ).toEqual({ tipo: 'datoSinCubrir' });
    // Motivo VIEJO: un job fallido antes del cambio conserva su last_error y se sigue reconociendo.
    expect(
      motivoDeGuardadoNoRepetible(
        new Error(
          'PROMOCION_NO_REPETIBLE: paso fillFormVision de llenado sin campos registrados: asunto sin ningun otro paso que lo cubra',
        ),
      ),
    ).toEqual({ tipo: 'datoSinCubrir' });
  });

  it('cualquier otro motivo permanente cae al generico; un error sin prefijo devuelve null', async () => {
    const { motivoDeGuardadoNoRepetible } = await import('../src/lib/jobs');
    expect(
      motivoDeGuardadoNoRepetible(new Error('PROMOCION_NO_REPETIBLE: la ultima trayectoria termino fallida')),
    ).toEqual({ tipo: 'generico' });
    expect(motivoDeGuardadoNoRepetible(new Error('fetch failed'))).toBeNull();
    expect(motivoDeGuardadoNoRepetible('texto suelto')).toBeNull();
  });
});
