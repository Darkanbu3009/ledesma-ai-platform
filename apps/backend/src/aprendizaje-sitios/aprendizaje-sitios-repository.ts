import type { Sql } from '@ledesma-platform/shared';

/**
 * Acceso a datos del ATLAS DE SITIOS (tabla `aprendizaje_sitios`, V040): la estructura de cada
 * dominio agregada a partir de las estrategias que GANARON en ejecuciones exitosas de cualquier
 * usuario. Recibe el cliente sql por inyeccion (testeable), mismo patron que RecetasWebRepository.
 *
 * INVARIANTES A NIVEL DE QUERY, y son el mecanismo del anonimato, no una promesa:
 *  - Ninguna query de este repositorio nombra `owner_id`, ni un id de trayectoria, de receta o de job,
 *    ni un valor tecleado: la tabla NO tiene esas columnas (ver V040) y aqui no se inventan.
 *  - NO EXISTE un metodo que lea o escriba acotado por dueno, porque una entrada del atlas no tiene
 *    dueno. La unica dimension es el DOMINIO.
 *  - Lo unico que vincula una fila con quien la produjo es `origenes_hash`, HMAC no reversible cuyo
 *    secreto vive solo en el worker. Este repositorio lo trata como una lista opaca de cadenas.
 *
 * DONDE VIVE LA REGLA DE CORROBORACION: en el worker (apps/worker/src/atlas-sitios.ts), no aqui.
 * Mismo criterio que `leerAutoReparacion` de RecetasWebRepository (V038), que devuelve el historial de
 * ganadoras crudo para que lo interprete promocion-estrategias.ts: el repositorio es acceso a datos y
 * la decision de producto se lee y se testea en un modulo puro.
 */

/** Una entrada del atlas tal como vuelve de la base, sin interpretar. */
export interface EntradaDeAtlasCruda {
  claseDeElemento: string;
  /** Lista rankeada de estrategias. `unknown`: lo valida el worker contra el contrato de recetas. */
  estrategias: unknown;
  corroboraciones: number;
  /** Lista de HMAC de origen. `unknown`: su LARGO es el umbral y lo aplica el worker. */
  origenesHash: unknown;
}

/** Lo que el agregador escribe tras una ejecucion exitosa con efecto confirmado. */
export interface ObservacionDeAtlas {
  dominio: string;
  claseDeElemento: string;
  /** Estrategias YA filtradas y truncadas por el worker (jamas valores del usuario). */
  estrategias: unknown;
  /** HMAC del origen de ESTA corrida. Opaco para el repositorio. */
  origenHash: string;
}

interface FilaDeAtlas {
  clase_de_elemento: string;
  estrategias: unknown;
  corroboraciones: number | string | null;
  origenes_hash: unknown;
}

/** Tope de entradas que una lectura por dominio devuelve. Un dominio real no tiene mil controles. */
export const MAX_ENTRADAS_POR_DOMINIO = 200;

export class AprendizajeSitiosRepository {
  constructor(private readonly sql: Sql) {}

  /**
   * Todas las entradas conocidas de un dominio, las mas corroboradas primero. NO filtra por umbral:
   * devuelve `origenesHash` y `corroboraciones` para que el worker aplique la regla (y para que esa
   * regla se pueda testear sin base). Un dominio vacio devuelve lista vacia sin consultar.
   */
  async listarPorDominio(
    dominio: string,
    limite: number = MAX_ENTRADAS_POR_DOMINIO,
  ): Promise<EntradaDeAtlasCruda[]> {
    if (dominio === '') return [];
    const filas = await this.sql<FilaDeAtlas[]>`
      select clase_de_elemento, estrategias, corroboraciones, origenes_hash
      from aprendizaje_sitios
      where dominio = ${dominio}
      order by corroboraciones desc, actualizada_en desc
      limit ${limite}
    `;
    return filas.map((fila) => ({
      claseDeElemento: fila.clase_de_elemento,
      estrategias: fila.estrategias,
      corroboraciones: Number(fila.corroboraciones ?? 0),
      origenesHash: fila.origenes_hash,
    }));
  }

  /**
   * UPSERT de una estructura observada. Estructura NUEVA: fila con `corroboraciones` 1 y el hash de
   * origen. Estructura YA CONOCIDA: sube `corroboraciones` y agrega el hash SOLO si es nuevo (el
   * `@>` de jsonb decide la pertenencia dentro del mismo statement, sin leer antes: dos corridas
   * simultaneas no pueden duplicar un origen).
   *
   * Las estrategias se REEMPLAZAN por las de la ultima observacion exitosa a proposito: el atlas
   * describe como se localiza el elemento HOY, no un historico. Un sitio que renombra su boton deja
   * de servir el nombre viejo en la siguiente corrida exitosa, sin necesidad de purgar nada.
   *
   * `primera_vez_en` no se toca nunca en el update: es la fecha en que el dominio revelo esa
   * estructura por primera vez.
   */
  async registrarObservacion(observacion: ObservacionDeAtlas): Promise<void> {
    const estrategias = this.sql.json(observacion.estrategias as Parameters<Sql['json']>[0]);
    const origen = this.sql.json([observacion.origenHash] as Parameters<Sql['json']>[0]);
    await this.sql`
      insert into aprendizaje_sitios
        (dominio, clase_de_elemento, estrategias, corroboraciones, origenes_hash)
      values
        (${observacion.dominio}, ${observacion.claseDeElemento}, ${estrategias}, 1, ${origen})
      on conflict (dominio, clase_de_elemento) do update set
        estrategias = excluded.estrategias,
        corroboraciones = aprendizaje_sitios.corroboraciones + 1,
        origenes_hash = case
          when aprendizaje_sitios.origenes_hash @> excluded.origenes_hash
            then aprendizaje_sitios.origenes_hash
          else aprendizaje_sitios.origenes_hash || excluded.origenes_hash
        end,
        actualizada_en = now()
    `;
  }

  /**
   * PURGA todo lo aprendido de un dominio (administracion). Devuelve cuantas entradas se borraron,
   * para que la ruta distinga "no habia nada" de "listo". Es un DELETE de verdad: lo que se pide es
   * que la plataforma OLVIDE la estructura de ese sitio.
   */
  async purgarDominio(dominio: string): Promise<number> {
    if (dominio === '') return 0;
    const borradas = await this.sql<Array<{ id: string }>>`
      delete from aprendizaje_sitios where dominio = ${dominio} returning id
    `;
    return borradas.length;
  }
}
