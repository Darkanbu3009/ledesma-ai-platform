import {
  PROMOVER_TRAYECTORIA_JOB_KIND,
  type CreateJobInput,
  type Job,
  type JobSummary,
} from '@ledesma-platform/shared';
import type { TrayectoriaWeb } from '../trayectorias/trayectorias-repository.js';

/**
 * GUARDAR COMO TAREA APRENDIDA (Fase F): el servicio con el que las DOS superficies de consentimiento
 * (el boton de /actividad y la tool platform_guardar_tarea_aprendida del agente conversacional)
 * evaluan y encolan la promocion de una tarea web exitosa del motor libre a receta.
 *
 * UNA sola implementacion a proposito: si la evaluacion del boton y la de la tool divergieran, una
 * superficie ofreceria guardar lo que la otra rechaza. La conversion real corre en el worker (job
 * kind 'promover_trayectoria'); aqui solo se valida pertenencia y estado, y se encola.
 *
 * QUE ES GUARDABLE (todas a la vez):
 *  - el job existe y ES DEL OWNER (toda lectura va acotada por owner_id; ajeno = inexistente);
 *  - es una tarea web COMPLETADA que corrio con el MOTOR (una que corrio por receta no tiene nada
 *    nuevo que guardar: `conLoAprendido`);
 *  - tiene una trayectoria EXITOSA registrada (V030);
 *  - ninguna de sus trayectorias tiene ya una receta creada desde ella (doble guardado).
 */

/** Por que un job NO es guardable (la ruta y la tool mapean cada causa a su respuesta). */
export type MotivoNoGuardable =
  | 'no_encontrado'
  | 'no_es_tarea_web_exitosa'
  | 'corrio_por_receta'
  | 'sin_trayectoria'
  | 'ya_guardada';

export type EvaluacionDeGuardado =
  | { guardable: true; trayectorias: TrayectoriaWeb[] }
  | { guardable: false; motivo: MotivoNoGuardable };

/** Puertos minimos a la base (faciles de fakear en tests, mismo criterio que sitio-tools). */
export interface GuardarTareaAprendidaDeps {
  jobs: {
    getSummaryForOwner(id: string, ownerId: string): Promise<JobSummary | null>;
    createJob(input: CreateJobInput): Promise<Job>;
    /** Job de promocion pending/running del owner para este job de origen, o null. */
    buscarPromocionEnVuelo(ownerId: string, jobOrigenId: string): Promise<string | null>;
  };
  trayectorias: {
    listarPorJob(jobId: string, ownerId: string): Promise<TrayectoriaWeb[]>;
  };
  recetas: {
    buscarPorTrayectorias(ownerId: string, trayectoriaIds: readonly string[]): Promise<string | null>;
  };
}

/** Evalua si el exito de un job se puede guardar como tarea aprendida. No escribe nada. */
export async function evaluarGuardadoDeJob(
  deps: GuardarTareaAprendidaDeps,
  ownerId: string,
  jobId: string,
): Promise<EvaluacionDeGuardado> {
  const job = await deps.jobs.getSummaryForOwner(jobId, ownerId);
  if (job === null) return { guardable: false, motivo: 'no_encontrado' };
  if (job.type !== 'tarea_web' || job.status !== 'completed') {
    return { guardable: false, motivo: 'no_es_tarea_web_exitosa' };
  }
  if (job.conLoAprendido === true) return { guardable: false, motivo: 'corrio_por_receta' };

  const trayectorias = await deps.trayectorias.listarPorJob(jobId, ownerId);
  const ultima = trayectorias[trayectorias.length - 1];
  if (ultima === undefined || ultima.estado !== 'exitosa') {
    return { guardable: false, motivo: 'sin_trayectoria' };
  }

  const yaGuardada = await deps.recetas.buscarPorTrayectorias(
    ownerId,
    trayectorias.map((t) => t.id),
  );
  if (yaGuardada !== null) return { guardable: false, motivo: 'ya_guardada' };
  return { guardable: true, trayectorias };
}

export type ResultadoDeEncolado =
  | { encolado: true; jobId: string }
  | { encolado: false; motivo: MotivoNoGuardable };

/**
 * Evalua y, si el job es guardable, ENCOLA el job de promocion (kind 'promover_trayectoria', sin
 * agente ni credencial: no ejecuta ningun modelo). El worker re-verifica el doble guardado antes de
 * escribir (segunda capa, para la carrera entre dos encolados).
 *
 * IDEMPOTENTE ante el doble click: si ya hay un job de promocion EN VUELO para este mismo job de
 * origen, se devuelve ese en lugar de encolar otro (un segundo POST no produce un segundo job).
 */
export async function encolarGuardadoDeJob(
  deps: GuardarTareaAprendidaDeps,
  ownerId: string,
  jobId: string,
): Promise<ResultadoDeEncolado> {
  const evaluacion = await evaluarGuardadoDeJob(deps, ownerId, jobId);
  if (!evaluacion.guardable) return { encolado: false, motivo: evaluacion.motivo };
  const enVuelo = await deps.jobs.buscarPromocionEnVuelo(ownerId, jobId);
  if (enVuelo !== null) return { encolado: true, jobId: enVuelo };
  const job = await deps.jobs.createJob({
    agentId: null,
    ownerId,
    credentialId: null,
    payload: { kind: PROMOVER_TRAYECTORIA_JOB_KIND, jobId },
  });
  return { encolado: true, jobId: job.id };
}
