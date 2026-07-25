import type { PoliticaDeEjecucion, Sql } from '@ledesma-platform/shared';

export { POLITICA_EJECUCION_DEFAULT } from '@ledesma-platform/shared';

/**
 * Acceso a datos de la POLITICA DE EJECUCION del usuario (tabla `politicas_ejecucion`, V034): los
 * tres ajustes que el dueno configura UNA sola vez y que deciden si una accion que no se puede
 * deshacer se ejecuta o se detiene. Recibe el cliente sql por inyeccion (testeable), mismo patron
 * que AprobacionesWebRepository / SitiosConectadosRepository.
 *
 * Invariantes que garantiza a nivel de query:
 *  - TODA lectura y TODA escritura van acotadas por owner_id (RLS es la segunda capa). No existe un
 *    metodo que lea o escriba la politica de otro dueno: el owner es siempre un parametro explicito
 *    que los endpoints toman del JWT, nunca del body.
 *  - La AUSENCIA de fila es un estado valido: obtenerPorOwner devuelve null y NO crea nada. Los
 *    defaults viven en el consumidor (worker y endpoint), no en un insert perezoso: crear filas al
 *    leer convertiria un GET en una escritura y ensuciaria la base de usuarios que nunca configuraron.
 */

/** Los tres ajustes que el usuario configura (sin metadatos): lo que acepta el PUT. La forma y los
 *  defaults viven en shared (contrato de verificacion), compartidos con el worker y la consola. */
export type PoliticaEjecucionInput = PoliticaDeEjecucion;

/** La politica vigente de un owner: los tres ajustes mas la metadata de la fila. */
export interface PoliticaEjecucion extends PoliticaDeEjecucion {
  ownerId: string;
  creadaEn: string;
  actualizadaEn: string;
}

interface PoliticaRow {
  owner_id: string;
  ejecutar_acciones_irreversibles: boolean;
  tope_monto_sin_confirmacion: string | number;
  sitios_excluidos: string[] | null;
  creada_en: Date | string;
  actualizada_en: Date | string;
}

/** ISO 8601 tolerante (mismo criterio que AprobacionesWebRepository). */
function toIso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

const EPOCH_ISO = new Date(0).toISOString();

/**
 * numeric de Postgres llega como STRING por el driver (postgres.js no lo convierte para no perder
 * precision). Un valor no numerico cae al default conservador (0): jamas se interpreta como "sin
 * limite" un dato que no se pudo leer.
 */
function toMonto(value: string | number): number {
  const numero = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numero) && numero >= 0 ? numero : 0;
}

function rowToPolitica(row: PoliticaRow): PoliticaEjecucion {
  return {
    ownerId: row.owner_id,
    ejecutarAccionesIrreversibles: row.ejecutar_acciones_irreversibles === true,
    topeMontoSinConfirmacion: toMonto(row.tope_monto_sin_confirmacion),
    sitiosExcluidos: Array.isArray(row.sitios_excluidos) ? row.sitios_excluidos : [],
    creadaEn: toIso(row.creada_en) ?? EPOCH_ISO,
    actualizadaEn: toIso(row.actualizada_en) ?? EPOCH_ISO,
  };
}

export class PoliticasEjecucionRepository {
  constructor(private readonly sql: Sql) {}

  /**
   * La politica del owner, o null si nunca la configuro. NO crea la fila: el llamador aplica
   * POLITICA_EJECUCION_DEFAULT. Lo consumen el GET del endpoint y el worker al iniciar cada tarea web.
   */
  async obtenerPorOwner(ownerId: string): Promise<PoliticaEjecucion | null> {
    const rows = await this.sql<PoliticaRow[]>`
      select owner_id, ejecutar_acciones_irreversibles, tope_monto_sin_confirmacion, sitios_excluidos,
        creada_en, actualizada_en
      from politicas_ejecucion
      where owner_id = ${ownerId}
    `;
    const row = rows[0];
    return row ? rowToPolitica(row) : null;
  }

  /**
   * Guarda (crea o reemplaza) la politica del owner. UPSERT por owner_id: la configuracion es un
   * ajuste de "una sola vez" que el usuario puede editar, no un historial. El owner SIEMPRE viene
   * del JWT en el endpoint; este metodo no acepta ninguna otra via de identidad.
   */
  async guardar(ownerId: string, input: PoliticaEjecucionInput): Promise<PoliticaEjecucion> {
    const rows = await this.sql<PoliticaRow[]>`
      insert into politicas_ejecucion
        (owner_id, ejecutar_acciones_irreversibles, tope_monto_sin_confirmacion, sitios_excluidos)
      values
        (${ownerId}, ${input.ejecutarAccionesIrreversibles}, ${input.topeMontoSinConfirmacion},
         ${input.sitiosExcluidos})
      on conflict (owner_id) do update set
        ejecutar_acciones_irreversibles = excluded.ejecutar_acciones_irreversibles,
        tope_monto_sin_confirmacion = excluded.tope_monto_sin_confirmacion,
        sitios_excluidos = excluded.sitios_excluidos,
        actualizada_en = now()
      returning owner_id, ejecutar_acciones_irreversibles, tope_monto_sin_confirmacion,
        sitios_excluidos, creada_en, actualizada_en
    `;
    return rowToPolitica(rows[0] as PoliticaRow);
  }
}
