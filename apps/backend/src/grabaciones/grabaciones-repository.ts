import type { PasoGrabado, Sql } from '@ledesma-platform/shared';
import { esMotivoDescarte, parsearPasosGrabados } from '@ledesma-platform/shared';
import type { EstadoGrabacion, MotivoDescarte } from '@ledesma-platform/shared';

/**
 * Acceso a datos de las GRABACIONES DE TAREA (tabla `grabaciones`, V036): la via complementaria con la
 * que el usuario SIEMBRA una receta ensenandole la tarea al sistema una vez. Recibe el cliente sql por
 * inyeccion (testeable), mismo patron que RecetasWebRepository y TrayectoriasWebRepository.
 *
 * Invariantes garantizados a nivel de query:
 *  - TODA lectura y TODA escritura van acotadas por owner_id (RLS es la segunda capa). No existe un
 *    metodo que lea o escriba la grabacion de otro dueno.
 *  - `obtener` NO devuelve nunca los pasos crudos del jsonb: los pasa por `parsearPasosGrabados` y
 *    deja la lista VACIA si no validan. Una grabacion manipulada en la base no llega a convertirse en
 *    una receta ejecutable.
 *  - `terminar` es una transicion CONDICIONADA a que la fila siga 'grabando': el usuario no puede
 *    terminar dos veces, ni terminar una grabacion que el worker ya descarto por contrasena.
 *  - No existe ningun metodo que BORRE el motivo de un descarte ni que devuelva una fila descartada al
 *    estado 'grabando': una grabacion detenida por un campo de contrasena es terminal.
 */

/** Una grabacion tal como la usan el worker y la consola: cabecera + pasos YA VALIDADOS. */
export interface Grabacion {
  id: string;
  ownerId: string;
  connectionId: string;
  dominio: string;
  descripcion: string;
  estado: EstadoGrabacion;
  motivo: MotivoDescarte | null;
  pasos: PasoGrabado[];
  vistaEnVivoUrl: string | null;
  creadaEn: string;
  actualizadaEn: string;
}

/** Lo que hace falta para abrir una grabacion (el backend la crea ANTES de encolar el job). */
export interface NuevaGrabacion {
  ownerId: string;
  connectionId: string;
  dominio: string;
  descripcion: string;
}

interface GrabacionRow {
  id: string;
  owner_id: string;
  connection_id: string;
  dominio: string;
  descripcion: string;
  estado: string;
  motivo: string | null;
  pasos: unknown;
  vista_en_vivo_url: string | null;
  creada_en: Date | string;
  actualizada_en: Date | string;
}

/** ISO 8601 tolerante (mismo criterio que RecetasWebRepository). */
function toIso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

const EPOCH_ISO = new Date(0).toISOString();

/** Estado leido de la base, degradado a 'descartada' si la fila trae algo que no reconocemos. */
function comoEstado(valor: string): EstadoGrabacion {
  return valor === 'grabando' || valor === 'terminada' ? valor : 'descartada';
}

/**
 * Convierte la fila a grabacion VALIDANDO los pasos. Unos pasos que no validan dejan la lista vacia
 * (nunca los crudos): quien promueve exige al menos un paso, asi que una grabacion manipulada no
 * puede convertirse en receta.
 */
function rowToGrabacion(row: GrabacionRow): Grabacion {
  return {
    id: row.id,
    ownerId: row.owner_id,
    connectionId: row.connection_id,
    dominio: row.dominio,
    descripcion: row.descripcion,
    estado: comoEstado(row.estado),
    motivo: esMotivoDescarte(row.motivo) ? row.motivo : null,
    pasos: parsearPasosGrabados(row.pasos) ?? [],
    vistaEnVivoUrl: row.vista_en_vivo_url,
    creadaEn: toIso(row.creada_en) ?? EPOCH_ISO,
    actualizadaEn: toIso(row.actualizada_en) ?? EPOCH_ISO,
  };
}

export class GrabacionesRepository {
  constructor(private readonly sql: Sql) {}

  /** Abre una grabacion en estado 'grabando', sin pasos y sin vista en vivo (la publica el worker). */
  async crear(input: NuevaGrabacion): Promise<Grabacion> {
    const rows = await this.sql<GrabacionRow[]>`
      insert into grabaciones (owner_id, connection_id, dominio, descripcion)
      values (${input.ownerId}, ${input.connectionId}, ${input.dominio}, ${input.descripcion})
      returning id, owner_id, connection_id, dominio, descripcion, estado, motivo, pasos,
        vista_en_vivo_url, creada_en, actualizada_en
    `;
    const row = rows[0];
    if (!row) throw new Error('no se pudo crear la grabacion');
    return rowToGrabacion(row);
  }

  /** UNA grabacion del owner por su id. null si no existe o no es suya (no se distingue). */
  async obtener(id: string, ownerId: string): Promise<Grabacion | null> {
    const rows = await this.sql<GrabacionRow[]>`
      select id, owner_id, connection_id, dominio, descripcion, estado, motivo, pasos,
        vista_en_vivo_url, creada_en, actualizada_en
      from grabaciones where id = ${id} and owner_id = ${ownerId}
    `;
    const row = rows[0];
    return row ? rowToGrabacion(row) : null;
  }

  /** Publica la vista en vivo de una grabacion que sigue 'grabando' (la escribe el worker). */
  async publicarVistaEnVivo(id: string, ownerId: string, vistaEnVivoUrl: string): Promise<void> {
    await this.sql`
      update grabaciones set vista_en_vivo_url = ${vistaEnVivoUrl}, actualizada_en = now()
      where id = ${id} and owner_id = ${ownerId} and estado = 'grabando'
    `;
  }

  /**
   * El usuario dijo "ya termine". Transicion CONDICIONADA a 'grabando': devuelve true solo si esta
   * llamada fue la que la termino. El worker lo detecta en su siguiente sondeo y cierra la captura.
   */
  async terminar(id: string, ownerId: string): Promise<boolean> {
    const rows = await this.sql<Array<{ id: string }>>`
      update grabaciones set estado = 'terminada', actualizada_en = now()
      where id = ${id} and owner_id = ${ownerId} and estado = 'grabando'
      returning id
    `;
    return rows.length > 0;
  }

  /** ¿La grabacion sigue en curso? Es el sondeo con el que el worker sabe cuando dejar de capturar. */
  async sigueGrabando(id: string, ownerId: string): Promise<boolean> {
    const rows = await this.sql<Array<{ estado: string }>>`
      select estado from grabaciones where id = ${id} and owner_id = ${ownerId}
    `;
    return rows[0]?.estado === 'grabando';
  }

  /**
   * Guarda los pasos capturados y limpia la vista en vivo (la sesion ya se cerro). NO cambia el
   * estado: quien termino la grabacion fue el usuario. Si la fila quedo 'descartada' entre medio (un
   * campo de contrasena), la condicion de estado impide que los pasos entren igual.
   */
  async guardarPasos(id: string, ownerId: string, pasos: PasoGrabado[]): Promise<void> {
    await this.sql`
      update grabaciones set
        pasos = ${this.sql.json(pasos as unknown as Parameters<Sql['json']>[0])},
        vista_en_vivo_url = null,
        actualizada_en = now()
      where id = ${id} and owner_id = ${ownerId} and estado = 'terminada'
    `;
  }

  /**
   * DESCARTA la grabacion: estado 'descartada', motivo, pasos VACIOS y sin vista en vivo. Es el
   * camino del invariante innegociable (motivo 'contrasena'): lo capturado se tira, no se guarda nada.
   * Idempotente y sin condicion de estado: descartar siempre debe poder completarse.
   */
  async descartar(id: string, ownerId: string, motivo: MotivoDescarte): Promise<void> {
    await this.sql`
      update grabaciones set
        estado = 'descartada',
        motivo = ${motivo},
        pasos = '[]'::jsonb,
        vista_en_vivo_url = null,
        actualizada_en = now()
      where id = ${id} and owner_id = ${ownerId}
    `;
  }
}
