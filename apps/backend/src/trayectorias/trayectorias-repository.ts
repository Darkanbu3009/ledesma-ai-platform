import type { Sql } from '@ledesma-platform/shared';

/**
 * Acceso a datos de las TRAYECTORIAS DE TAREAS WEB (tablas `trayectorias_web` y `pasos_trayectoria`,
 * V030, Fase F paso 1): el registro de que acciones ejecuto el motor de navegacion en cada tarea web,
 * para poder promoverlas despues a recetas deterministas (paso 2, PR futuro). Recibe el cliente sql
 * por inyeccion (testeable), mismo patron que AprobacionesWebRepository.
 *
 * Invariantes garantizados a nivel de query:
 *  - Toda LECTURA va acotada por WHERE owner_id (RLS es la segunda capa).
 *  - La ESCRITURA (crear) es ATOMICA: cabecera + pasos en una transaccion; una trayectoria jamas
 *    queda con pasos a medias.
 *  - Este repositorio SOLO recibe pasos YA CENSURADOS (el worker aplica censura.ts/trayectoria.ts
 *    antes de llamar): aqui no hay valores sensibles que proteger porque nunca llegan.
 */

export type TrayectoriaEstado = 'exitosa' | 'fallida' | 'pausada';

export interface PasoTrayectoria {
  id: string;
  idx: number;
  /** Objeto censurado por whitelist: { tipo, instruccion, metodo, argumentos }. */
  accion: unknown;
  selector: string | null;
  valorCensurado: string | null;
  url: string | null;
  exito: boolean | null;
  creadoEn: string;
}

export interface TrayectoriaWeb {
  id: string;
  ownerId: string;
  jobId: string;
  connectionId: string;
  dominio: string;
  objetivo: string;
  estado: TrayectoriaEstado;
  iniciadaEn: string;
  terminadaEn: string;
  duracionMs: number;
  tokensIn: number | null;
  tokensOut: number | null;
  creadaEn: string;
}

export interface TrayectoriaConPasos extends TrayectoriaWeb {
  pasos: PasoTrayectoria[];
}

export interface NuevoPasoTrayectoria {
  idx: number;
  accion: unknown;
  selector: string | null;
  valorCensurado: string | null;
  url: string | null;
  exito: boolean | null;
}

export interface NuevaTrayectoria {
  ownerId: string;
  jobId: string;
  connectionId: string;
  dominio: string;
  objetivo: string;
  estado: TrayectoriaEstado;
  iniciadaEn: Date | string;
  terminadaEn: Date | string;
  duracionMs: number;
  tokensIn: number | null;
  tokensOut: number | null;
  pasos: NuevoPasoTrayectoria[];
}

interface TrayectoriaRow {
  id: string;
  owner_id: string;
  job_id: string;
  connection_id: string;
  dominio: string;
  objetivo: string;
  estado: string;
  iniciada_en: Date | string;
  terminada_en: Date | string;
  duracion_ms: number;
  tokens_in: number | null;
  tokens_out: number | null;
  creada_en: Date | string;
}

interface PasoRow {
  id: string;
  trayectoria_id: string;
  idx: number;
  accion: unknown;
  selector: string | null;
  valor_censurado: string | null;
  url: string | null;
  exito: boolean | null;
  creado_en: Date | string;
}

/** ISO 8601 tolerante (mismo criterio que JobsRepository / AprobacionesWebRepository). */
function toIso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

const EPOCH_ISO = new Date(0).toISOString();

function rowToTrayectoria(row: TrayectoriaRow): TrayectoriaWeb {
  return {
    id: row.id,
    ownerId: row.owner_id,
    jobId: row.job_id,
    connectionId: row.connection_id,
    dominio: row.dominio,
    objetivo: row.objetivo,
    estado: row.estado as TrayectoriaEstado,
    iniciadaEn: toIso(row.iniciada_en) ?? EPOCH_ISO,
    terminadaEn: toIso(row.terminada_en) ?? EPOCH_ISO,
    duracionMs: Number(row.duracion_ms ?? 0),
    tokensIn: row.tokens_in,
    tokensOut: row.tokens_out,
    creadaEn: toIso(row.creada_en) ?? EPOCH_ISO,
  };
}

function rowToPaso(row: PasoRow): PasoTrayectoria {
  return {
    id: row.id,
    idx: Number(row.idx),
    accion: row.accion,
    selector: row.selector,
    valorCensurado: row.valor_censurado,
    url: row.url,
    exito: row.exito,
    creadoEn: toIso(row.creado_en) ?? EPOCH_ISO,
  };
}

export class TrayectoriasWebRepository {
  constructor(private readonly sql: Sql) {}

  /**
   * Persiste una trayectoria completa (cabecera + pasos) en UNA transaccion: todo o nada. Los pasos
   * se insertan en SERIE (dentro de la transaccion el sql usa una sola conexion, mismo criterio que
   * AccountDeletionRepository). Devuelve el id de la cabecera.
   */
  async crear(input: NuevaTrayectoria): Promise<string> {
    return this.sql.begin(async (tx) => {
      const rows = await tx<Array<{ id: string }>>`
        insert into trayectorias_web
          (owner_id, job_id, connection_id, dominio, objetivo, estado, iniciada_en, terminada_en,
           duracion_ms, tokens_in, tokens_out)
        values
          (${input.ownerId}, ${input.jobId}, ${input.connectionId}, ${input.dominio},
           ${input.objetivo}, ${input.estado}, ${input.iniciadaEn}, ${input.terminadaEn},
           ${input.duracionMs}, ${input.tokensIn}, ${input.tokensOut})
        returning id
      `;
      const trayectoriaId = (rows[0] as { id: string }).id;
      for (const paso of input.pasos) {
        await tx`
          insert into pasos_trayectoria (trayectoria_id, idx, accion, selector, valor_censurado, url, exito)
          values
            (${trayectoriaId}, ${paso.idx}, ${tx.json(paso.accion as Parameters<Sql['json']>[0])},
             ${paso.selector}, ${paso.valorCensurado}, ${paso.url}, ${paso.exito})
        `;
      }
      return trayectoriaId;
    }) as Promise<string>;
  }

  /**
   * Trayectorias de UN job del owner (mas viejas primero: el orden natural de lectura es la corrida
   * inicial y despues la reanudacion), cada una con sus pasos ordenados por idx. Un job ajeno o sin
   * trayectorias devuelve lista vacia.
   */
  async listarPorJobConPasos(jobId: string, ownerId: string): Promise<TrayectoriaConPasos[]> {
    const cabeceras = await this.sql<TrayectoriaRow[]>`
      select id, owner_id, job_id, connection_id, dominio, objetivo, estado, iniciada_en,
        terminada_en, duracion_ms, tokens_in, tokens_out, creada_en
      from trayectorias_web
      where job_id = ${jobId} and owner_id = ${ownerId}
      order by iniciada_en asc
    `;
    if (cabeceras.length === 0) return [];

    const ids = cabeceras.map((c) => c.id);
    const pasos = await this.sql<PasoRow[]>`
      select id, trayectoria_id, idx, accion, selector, valor_censurado, url, exito, creado_en
      from pasos_trayectoria
      where trayectoria_id in ${this.sql(ids)}
      order by idx asc
    `;

    const porTrayectoria = new Map<string, PasoTrayectoria[]>();
    for (const paso of pasos) {
      const lista = porTrayectoria.get(paso.trayectoria_id) ?? [];
      lista.push(rowToPaso(paso));
      porTrayectoria.set(paso.trayectoria_id, lista);
    }
    return cabeceras.map((c) => ({
      ...rowToTrayectoria(c),
      pasos: porTrayectoria.get(c.id) ?? [],
    }));
  }
}
