import type { PasoDeReceta, Sql } from '@ledesma-platform/shared';
import { parsearPasosDeReceta } from '@ledesma-platform/shared';

/**
 * Acceso a datos de las RECETAS DE TAREA WEB (tabla `recetas_web`, V035, Fase F paso 2): el
 * procedimiento aprendido de una trayectoria exitosa que se vuelve a ejecutar SIN llamar al modelo.
 * Recibe el cliente sql por inyeccion (testeable), mismo patron que TrayectoriasWebRepository.
 *
 * ESTE REPOSITORIO NO TOCA `recipes` (V013). Ver la cabecera de la migracion: son dos cosas distintas
 * con nombres distintos a proposito.
 *
 * Invariantes garantizados a nivel de query:
 *  - TODA lectura y TODA escritura van acotadas por owner_id (RLS es la segunda capa). No existe un
 *    metodo que lea o escriba la receta de otro dueno.
 *  - `buscarActiva` NO devuelve nunca los pasos crudos del jsonb: los pasa por
 *    `parsearPasosDeReceta` y devuelve null si no validan. Una receta manipulada en la base no llega
 *    al ejecutor: la tarea corre por el camino normal, que es el estado seguro.
 *  - `promover` es ATOMICO: marcar obsoleta la activa anterior y crear la nueva ocurren en la misma
 *    transaccion, para que el unique parcial de V035 nunca vea dos activas de la misma firma.
 */

export type EstadoReceta = 'activa' | 'obsoleta';

/**
 * DE DONDE salio la receta (V036/V041): 'automatica' = promovida sola desde una trayectoria exitosa
 * del agente; 'grabacion' = sembrada por el usuario ensenandole la tarea al sistema una vez;
 * 'plantilla_compartida' = copiada de una plantilla que descubrio OTRO origen, despues de que su dueno
 * la aprobara en un checkpoint y de que corriera con el efecto confirmado en su propia cuenta.
 *
 * Sirve para DISTINGUIRLAS, no para tratarlas distinto: una receta grabada o copiada se ejecuta con la
 * MISMA verificacion determinista de parametros y la MISMA politica del usuario que cualquier otra.
 * Que el usuario haya grabado los pasos, o que vengan de una plantilla, no autoriza a ejecutar con
 * datos que no coinciden con lo pedido.
 *
 * El CHECK de la columna admite los tres desde V041.
 */
export type OrigenReceta = 'automatica' | 'grabacion' | 'plantilla_compartida';

/** Los valores que el CHECK de `recetas_web.origen` admite (V041). Cualquier otro se lee como el default. */
const ORIGENES: readonly OrigenReceta[] = ['automatica', 'grabacion', 'plantilla_compartida'];

/** Una receta tal como la usa el worker: cabecera + pasos YA VALIDADOS. */
export interface RecetaWeb {
  id: string;
  ownerId: string;
  dominio: string;
  firmaObjetivo: string;
  /**
   * Lo que el usuario escribio, en sus palabras, al ensenar la tarea (V037). null en las recetas
   * que se aprendieron solas de una corrida exitosa y en toda receta anterior a esa migracion: ahi
   * lo unico que hay es la firma. Es lo que la consola muestra y lo que permite RECONOCER la tarea
   * cuando el usuario la pide con otras palabras; no interviene en la ejecucion.
   */
  descripcion: string | null;
  version: number;
  estado: EstadoReceta;
  origen: OrigenReceta;
  pasos: PasoDeReceta[];
  creadaDesdeTrayectoria: string | null;
  ejecucionesExitosas: number;
  ejecucionesFallidas: number;
  /**
   * Cuantas veces la AUTO REPARACION promovio a primaria una estrategia de fallback (V038). Es lo
   * que la consola muestra como "Se ajusto sola N veces". 0 en toda receta anterior a la migracion.
   */
  ajustesAutomaticos: number;
  ultimaEjecucionEn: string | null;
  creadaEn: string;
  actualizadaEn: string;
}

/** Lo que hace falta para promover una trayectoria exitosa a receta activa. */
export interface NuevaRecetaWeb {
  ownerId: string;
  dominio: string;
  firmaObjetivo: string;
  pasos: PasoDeReceta[];
  creadaDesdeTrayectoria: string | null;
  /** De donde salio. Ausente = 'automatica' (la promocion desde una trayectoria exitosa). */
  origen?: OrigenReceta;
  /** Lo que el usuario escribio al ensenarla. Ausente/null = no hay texto suyo que copiar. */
  descripcion?: string | null;
}

interface RecetaRow {
  id: string;
  owner_id: string;
  dominio: string;
  firma_objetivo: string;
  descripcion: string | null;
  version: number;
  estado: string;
  origen: string | null;
  pasos: unknown;
  creada_desde_trayectoria: string | null;
  ejecuciones_exitosas: number;
  ejecuciones_fallidas: number;
  ajustes_automaticos?: number | null;
  ultima_ejecucion_en: Date | string | null;
  creada_en: Date | string;
  actualizada_en: Date | string;
}

/** ISO 8601 tolerante (mismo criterio que TrayectoriasWebRepository). */
function toIso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

const EPOCH_ISO = new Date(0).toISOString();

/**
 * Convierte la fila a receta VALIDANDO los pasos. Devuelve null si el jsonb no valida: el llamador
 * trata la receta como inexistente y la tarea corre por el camino normal (falla cerrada).
 */
function rowToReceta(row: RecetaRow): RecetaWeb | null {
  const pasos = parsearPasosDeReceta(row.pasos);
  if (pasos === null) return null;
  return {
    id: row.id,
    ownerId: row.owner_id,
    dominio: row.dominio,
    firmaObjetivo: row.firma_objetivo,
    // Una fila anterior a V037 no tiene la columna: no hay texto del usuario que mostrar.
    descripcion: typeof row.descripcion === 'string' && row.descripcion.trim() !== ''
      ? row.descripcion.trim()
      : null,
    version: Number(row.version ?? 1),
    estado: row.estado === 'obsoleta' ? 'obsoleta' : 'activa',
    // Una fila anterior a V036 no tiene la columna: cuenta como 'automatica', que es lo que era.
    origen: ORIGENES.find((origen) => origen === row.origen) ?? 'automatica',
    pasos,
    creadaDesdeTrayectoria: row.creada_desde_trayectoria,
    ejecucionesExitosas: Number(row.ejecuciones_exitosas ?? 0),
    ejecucionesFallidas: Number(row.ejecuciones_fallidas ?? 0),
    ajustesAutomaticos: Number(row.ajustes_automaticos ?? 0),
    ultimaEjecucionEn: toIso(row.ultima_ejecucion_en),
    creadaEn: toIso(row.creada_en) ?? EPOCH_ISO,
    actualizadaEn: toIso(row.actualizada_en) ?? EPOCH_ISO,
  };
}

export class RecetasWebRepository {
  constructor(private readonly sql: Sql) {}

  /**
   * La receta ACTIVA de un owner para un dominio y una firma de objetivo, o null si no hay ninguna o
   * si sus pasos no validan. Es la consulta que decide el camino de ejecucion de cada tarea web.
   */
  async buscarActiva(
    ownerId: string,
    dominio: string,
    firmaObjetivo: string,
  ): Promise<RecetaWeb | null> {
    const rows = await this.sql<RecetaRow[]>`
      select id, owner_id, dominio, firma_objetivo, descripcion, version, estado, origen, pasos,
        creada_desde_trayectoria, ejecuciones_exitosas, ejecuciones_fallidas, ajustes_automaticos,
        ultima_ejecucion_en, creada_en, actualizada_en
      from recetas_web
      where owner_id = ${ownerId} and dominio = ${dominio} and firma_objetivo = ${firmaObjetivo}
        and estado = 'activa'
    `;
    const row = rows[0];
    return row ? rowToReceta(row) : null;
  }

  /**
   * TODAS las recetas ACTIVAS del owner en los dominios indicados. Es lo que el worker le ofrece al
   * modelo para que RECONOZCA la tarea que el usuario acaba de pedir cuando la firma exacta no
   * coincide, y lo que la consola lista (sin filtro de dominio) como "tareas que ya sabe hacer".
   *
   * Las filas cuyos pasos NO validan se DESCARTAN de la lista (no invalidan las demas): una receta
   * manipulada en la base ni se ofrece ni se muestra, y la tarea corre por el camino normal.
   * `dominios` vacio devuelve lista vacia sin consultar: pedir "en ninguno" no puede leer todo.
   */
  async listarActivas(ownerId: string, dominios?: readonly string[]): Promise<RecetaWeb[]> {
    if (dominios !== undefined && dominios.length === 0) return [];
    const rows =
      dominios === undefined
        ? await this.sql<RecetaRow[]>`
            select id, owner_id, dominio, firma_objetivo, descripcion, version, estado, origen, pasos,
              creada_desde_trayectoria, ejecuciones_exitosas, ejecuciones_fallidas, ajustes_automaticos,
              ultima_ejecucion_en, creada_en, actualizada_en
            from recetas_web
            where owner_id = ${ownerId} and estado = 'activa'
            order by creada_en desc
          `
        : await this.sql<RecetaRow[]>`
            select id, owner_id, dominio, firma_objetivo, descripcion, version, estado, origen, pasos,
              creada_desde_trayectoria, ejecuciones_exitosas, ejecuciones_fallidas, ajustes_automaticos,
              ultima_ejecucion_en, creada_en, actualizada_en
            from recetas_web
            where owner_id = ${ownerId} and estado = 'activa'
              and dominio in ${this.sql([...dominios])}
            order by creada_en desc
          `;
    const recetas: RecetaWeb[] = [];
    for (const row of rows) {
      const receta = rowToReceta(row);
      if (receta !== null) recetas.push(receta);
    }
    return recetas;
  }

  /**
   * BORRA una receta ("que la olvide"). Acotada por owner: el id que llega del cliente NUNCA alcanza
   * para tocar la fila de otro dueno. Devuelve si borro algo, para que la ruta distinga "no era tuya
   * o no existe" de "listo". Idempotente: borrar dos veces no es un error, la segunda devuelve false.
   *
   * Es un DELETE de verdad y no un cambio de estado: lo que el usuario pide es que el sistema OLVIDE
   * la tarea, y dejar la fila 'obsoleta' la conservaria con sus pasos.
   */
  async borrar(id: string, ownerId: string): Promise<boolean> {
    const borradas = await this.sql<Array<{ id: string }>>`
      delete from recetas_web where id = ${id} and owner_id = ${ownerId} returning id
    `;
    return borradas.length > 0;
  }

  /**
   * PROMUEVE una trayectoria exitosa a receta activa (D4). Si ya habia una activa para esa firma, la
   * marca 'obsoleta' y crea la nueva con `version` incrementada: la historia de lo que el sitio
   * rompio se conserva y el unique parcial de V035 nunca ve dos activas a la vez.
   *
   * Todo dentro de UNA transaccion: sin ella, un fallo entre el update y el insert dejaria al owner
   * sin receta activa para una firma que si tenia uno.
   */
  async promover(input: NuevaRecetaWeb): Promise<RecetaWeb | null> {
    const row = await this.sql.begin(async (tx) => {
      const anteriores = await tx<Array<{ version: number }>>`
        update recetas_web set estado = 'obsoleta', actualizada_en = now()
        where owner_id = ${input.ownerId} and dominio = ${input.dominio}
          and firma_objetivo = ${input.firmaObjetivo} and estado = 'activa'
        returning version
      `;
      const version = Number(anteriores[0]?.version ?? 0) + 1;
      const creadas = await tx<RecetaRow[]>`
        insert into recetas_web
          (owner_id, dominio, firma_objetivo, descripcion, version, estado, origen, pasos,
           creada_desde_trayectoria)
        values
          (${input.ownerId}, ${input.dominio}, ${input.firmaObjetivo}, ${input.descripcion ?? null},
           ${version}, 'activa',
           ${input.origen ?? 'automatica'},
           ${tx.json(input.pasos as unknown as Parameters<Sql['json']>[0])},
           ${input.creadaDesdeTrayectoria})
        returning id, owner_id, dominio, firma_objetivo, descripcion, version, estado, origen, pasos,
          creada_desde_trayectoria, ejecuciones_exitosas, ejecuciones_fallidas, ajustes_automaticos,
          ultima_ejecucion_en, creada_en, actualizada_en
      `;
      return creadas[0] ?? null;
    });
    return row ? rowToReceta(row as RecetaRow) : null;
  }

  /**
   * Marca una receta como OBSOLETA (D6: mas de la mitad de sus pasos hubo que escalarlos al motor).
   * Acotada por owner. Idempotente: marcar dos veces la misma receta no es un error.
   */
  async marcarObsoleta(id: string, ownerId: string): Promise<void> {
    await this.sql`
      update recetas_web set estado = 'obsoleta', actualizada_en = now()
      where id = ${id} and owner_id = ${ownerId}
    `;
  }

  /**
   * REEMPLAZA los pasos de una receta activa tras la AUTO REPARACION de un selector (D5), subiendo
   * `version`. Acotada por owner y por estado 'activa': una receta que quedo obsoleta a mitad de la
   * corrida no se repara (ya no se va a usar).
   */
  async reemplazarPasos(id: string, ownerId: string, pasos: PasoDeReceta[]): Promise<void> {
    await this.sql`
      update recetas_web set
        pasos = ${this.sql.json(pasos as unknown as Parameters<Sql['json']>[0])},
        version = version + 1,
        actualizada_en = now()
      where id = ${id} and owner_id = ${ownerId} and estado = 'activa'
    `;
  }

  /**
   * Lo que la AUTO REPARACION (V038) necesita leer FRESCO al cerrar una corrida exitosa: la version
   * vigente (el candado optimista del guardado), los pasos vigentes (pudieron cambiar durante la
   * corrida por la reparacion de selectores) y el historial de ganadoras crudo (lo interpreta el
   * worker, promocion-estrategias.ts). Solo de la receta ACTIVA del owner; null si ya no lo es o si
   * sus pasos no validan (misma falla cerrada que buscarActiva).
   */
  async leerAutoReparacion(
    id: string,
    ownerId: string,
  ): Promise<{ version: number; pasos: PasoDeReceta[]; ganadoras: unknown } | null> {
    const rows = await this.sql<Array<{ version: number; pasos: unknown; ganadoras: unknown }>>`
      select version, pasos, ganadoras
      from recetas_web
      where id = ${id} and owner_id = ${ownerId} and estado = 'activa'
    `;
    const row = rows[0];
    if (row === undefined) return null;
    const pasos = parsearPasosDeReceta(row.pasos);
    if (pasos === null) return null;
    return { version: Number(row.version ?? 1), pasos, ganadoras: row.ganadoras };
  }

  /**
   * GUARDA el resultado de la auto reparacion en UN solo UPDATE condicionado por la `version` leida
   * (candado optimista): registra el historial de ganadoras y, si hubo promocion, reemplaza los
   * pasos reordenados subiendo `version` y contando el ajuste. Devuelve si escribio.
   *
   * ATOMICIDAD (decidida): si otra corrida de la misma receta escribio entre la lectura y este
   * update, la version ya no coincide, el update no toca NADA y el llamador solo lo loguea. El shape
   * de `pasos` jamas queda mezclado de dos corridas; gana la que llego primero y la siguiente
   * corrida vuelve a registrar.
   */
  async guardarAutoReparacion(
    id: string,
    ownerId: string,
    version: number,
    ganadoras: unknown,
    pasosPromovidos: PasoDeReceta[] | null,
    promociones: number,
  ): Promise<boolean> {
    const json = this.sql.json(ganadoras as Parameters<Sql['json']>[0]);
    const rows =
      pasosPromovidos === null
        ? await this.sql<Array<{ id: string }>>`
            update recetas_web set
              ganadoras = ${json},
              actualizada_en = now()
            where id = ${id} and owner_id = ${ownerId} and estado = 'activa'
              and version = ${version}
            returning id
          `
        : await this.sql<Array<{ id: string }>>`
            update recetas_web set
              ganadoras = ${json},
              pasos = ${this.sql.json(pasosPromovidos as unknown as Parameters<Sql['json']>[0])},
              version = version + 1,
              ajustes_automaticos = ajustes_automaticos + ${promociones},
              actualizada_en = now()
            where id = ${id} and owner_id = ${ownerId} and estado = 'activa'
              and version = ${version}
            returning id
          `;
    return rows.length > 0;
  }

  /**
   * Id de una receta del owner creada desde ALGUNA de estas trayectorias, o null. Es el chequeo de
   * DOBLE GUARDADO de "guardar como tarea aprendida": la promocion con consentimiento estampa
   * `creada_desde_trayectoria` (la automatica no lo hace), asi que este vinculo dice si ese exito
   * concreto ya se guardo. Acotado por owner; lista vacia devuelve null sin consultar.
   */
  async buscarPorTrayectorias(
    ownerId: string,
    trayectoriaIds: readonly string[],
  ): Promise<string | null> {
    if (trayectoriaIds.length === 0) return null;
    const rows = await this.sql<Array<{ id: string }>>`
      select id from recetas_web
      where owner_id = ${ownerId} and creada_desde_trayectoria in ${this.sql([...trayectoriaIds])}
      limit 1
    `;
    return rows[0]?.id ?? null;
  }

  /** Contabiliza una ejecucion por receta (para poder medir el ahorro y detectar recetas muertas). */
  async registrarEjecucion(id: string, ownerId: string, exitosa: boolean): Promise<void> {
    await this.sql`
      update recetas_web set
        ejecuciones_exitosas = ejecuciones_exitosas + ${exitosa ? 1 : 0},
        ejecuciones_fallidas = ejecuciones_fallidas + ${exitosa ? 0 : 1},
        ultima_ejecucion_en = now(),
        actualizada_en = now()
      where id = ${id} and owner_id = ${ownerId}
    `;
  }
}
