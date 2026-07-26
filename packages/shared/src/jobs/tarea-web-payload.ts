/**
 * SHAPE del payload del JOB DE TAREA WEB (Fase 7.1d): un agente de navegacion por IA ejecuta un
 * OBJETIVO en lenguaje natural DENTRO de la sesion que el usuario ya establecio en un sitio
 * conectado (7.1a-7.1c). A diferencia de los jobs de sitios (7.1b), aca SI corre un modelo, pero
 * con las mismas lineas rojas: el login JAMAS se automatiza (una pantalla de login ABORTA la
 * tarea), la salida de red es la pineada o ninguna, y el payload NUNCA lleva credenciales.
 *
 * Vive en packages/shared (junto a sitio-payload.ts) porque lo consumen DOS workspaces: el backend
 * (la tool del agente que encola) y el worker (que ejecuta). Tipos PUROS con validadores SIN
 * dependencias (ni Zod), igual que recipe-payload.ts y sitio-payload.ts.
 *
 * DISCRIMINADOR: mismo esquema que kind:'recipe' (V013) y los kinds de sitios (7.1b). El owner de
 * la operacion es SIEMPRE jobs.owner_id (V008); el payload no lo duplica.
 */

/** Discriminador del job que ejecuta una tarea en lenguaje natural dentro de un sitio conectado. */
export const TAREA_WEB_JOB_KIND = 'tarea_web';

/** Tope de largo del objetivo (caracteres): una tarea legitima cabe holgada; un abuso no. */
export const TAREA_WEB_OBJETIVO_MAX_CHARS = 4_000;

/** Payload del job de tarea web: que hacer (objetivo) y en que conexion (connectionId). */
export interface TareaWebJobPayload {
  kind: typeof TAREA_WEB_JOB_KIND;
  /** Id de la fila de sitios_conectados (V024) sobre cuya sesion activa se ejecuta. */
  connectionId: string;
  /** La tarea en lenguaje natural, tal como la REDACTO el modelo al llamar a su tool. */
  objetivo: string;
  /**
   * TEXTO LITERAL del ultimo mensaje del usuario en la conversacion, adjuntado POR CODIGO en el
   * backend (jamas pedido al modelo). ACOMPANA al objetivo, no lo sustituye: el objetivo sigue
   * siendo lo unico que viaja al motor de navegacion como instruccion.
   *
   * Existe porque `objetivo` lo escribe el modelo conversacional y en produccion lo PARAFRASEO: los
   * rotulos y las comillas que el usuario habia escrito ("con asunto \"X\"") desaparecieron, y la
   * extraccion determinista de parametros -- que exige justamente rotulo y comillas para no adivinar
   * nada -- saco 1 de los 3 datos declarados. Con menos parametros, la verificacion previa compara
   * menos de lo que el usuario pidio. El worker extrae los parametros de ESTE campo cuando llega.
   *
   * Opcional: los jobs encolados antes de este cambio no lo traen y el worker cae al objetivo.
   */
  textoUsuario?: string;
}

/** Resultado de validar un payload de tarea web (estilo safeParse, sin lanzar). */
export type TareaWebJobPayloadParseResult =
  | { success: true; data: TareaWebJobPayload }
  | { success: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * DISCRIMINADOR barato: ¿este payload AFIRMA ser una tarea web (kind === 'tarea_web')? No valida la
 * forma completa (para eso esta parseTareaWebJobPayload); es el check con que el worker RAMIFICA,
 * igual que isSitioJobPayload. false para jobs simples, recetas, jobs de sitios y basura.
 */
export function isTareaWebJobPayload(value: unknown): boolean {
  return isRecord(value) && value.kind === TAREA_WEB_JOB_KIND;
}

/**
 * Valida COMPLETAMENTE un payload de tarea web: connectionId string no vacio y objetivo string no
 * vacio acotado a TAREA_WEB_OBJETIVO_MAX_CHARS. Devuelve { success, data } o { success, error }.
 */
export function parseTareaWebJobPayload(value: unknown): TareaWebJobPayloadParseResult {
  if (!isRecord(value) || value.kind !== TAREA_WEB_JOB_KIND) {
    return { success: false, error: 'kind no corresponde a un job de tarea web' };
  }
  if (typeof value.connectionId !== 'string' || value.connectionId.length === 0) {
    return { success: false, error: 'connectionId debe ser un string no vacio' };
  }
  if (typeof value.objetivo !== 'string' || value.objetivo.trim().length === 0) {
    return { success: false, error: 'objetivo debe ser un string no vacio' };
  }
  if (value.objetivo.length > TAREA_WEB_OBJETIVO_MAX_CHARS) {
    return {
      success: false,
      error: `objetivo supera el tope de ${TAREA_WEB_OBJETIVO_MAX_CHARS} caracteres`,
    };
  }
  // textoUsuario es OPCIONAL y su ausencia (o su forma invalida) NO invalida el job: sin el, el
  // worker cae al objetivo, que es el comportamiento de siempre. Fallar el payload entero por un
  // campo auxiliar dejaria sin ejecutar tareas que antes corrian.
  const textoUsuario =
    typeof value.textoUsuario === 'string' &&
    value.textoUsuario.trim().length > 0 &&
    value.textoUsuario.length <= TAREA_WEB_OBJETIVO_MAX_CHARS
      ? value.textoUsuario
      : undefined;
  return {
    success: true,
    data: {
      kind: TAREA_WEB_JOB_KIND,
      connectionId: value.connectionId,
      objetivo: value.objetivo,
      ...(textoUsuario !== undefined ? { textoUsuario } : {}),
    },
  };
}
