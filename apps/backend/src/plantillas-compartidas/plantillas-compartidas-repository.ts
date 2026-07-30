import type { PasoPublicable, Sql } from '@ledesma-platform/shared';
import {
  dominiosDePasosPublicables,
  esCodigoDeIntencion,
  esPublicable,
  marcadoresClave,
  marcadoresDePasosPublicables,
  parsearPasosPublicables,
} from '@ledesma-platform/shared';

/**
 * Acceso a datos de las PLANTILLAS COMPARTIDAS (tabla `plantillas_compartidas`, V041): el
 * PROCEDIMIENTO de una tarea de intencion irreversible, sin dueno y sin un solo valor de usuario, que
 * un origen descubrio y que la plataforma podra reusar. Recibe el cliente sql por inyeccion
 * (testeable), mismo patron que AprendizajeSitiosRepository y RecetasWebRepository.
 *
 * EN ESTE COMMIT ESTE REPOSITORIO SOLO ESCRIBE. No tiene ni un metodo que devuelva una plantilla: el
 * consumo es un cambio aparte. Lo unico que lee de la base es `aprendizaje_sitios`, y para nada mas
 * que aplicar la segunda puerta (ver abajo).
 *
 * INVARIANTES A NIVEL DE QUERY, y son el mecanismo del anonimato, no una promesa:
 *  - Ninguna query de este repositorio nombra `owner_id`, ni un id de trayectoria, de receta o de job,
 *    ni una firma, ni una descripcion: la tabla NO tiene esas columnas (ver V041) y aqui no se
 *    inventan.
 *  - NO EXISTE un metodo que lea o escriba acotado por dueno, porque una plantilla no tiene dueno. Las
 *    dimensiones son las tres de su identidad.
 *  - Lo unico que vincula una fila con quien la produjo es `origenes_hash`, HMAC no reversible cuya
 *    clave vive solo en el worker y se deriva con una etiqueta PROPIA, distinta de la del atlas. Este
 *    repositorio lo trata como una lista opaca de cadenas.
 *
 * LA SEGUNDA PUERTA (cinturon y tirantes). `publicar` vuelve a correr la MISMA `esPublicable` que el
 * worker ya corrio antes de llamar, sobre los pasos ya parseados y contra las clases corroboradas que
 * este proceso lee por su cuenta de `aprendizaje_sitios`. No es una comprobacion decorativa: es la
 * unica capa que sigue en pie si un dia otro productor (un backfill, un script, un bug) intenta
 * escribir aqui. Lo que NO puede hacer es recalcular la clase de un elemento a partir de sus
 * estrategias (eso vive en el worker, junto al atlas), asi que un productor que declarara una clase
 * corroborada QUE NO ES la del paso pasaria: la puerta protege contra pasos mal formados y contra
 * clases sin aval, no contra un worker malicioso, que de todas formas es codigo propio.
 */

/** ORIGENES DISTINTOS que hacen falta para que una clase del atlas avale una publicacion. */
export const ORIGENES_PARA_PUBLICAR = 2;

/** Tope de clases que la comprobacion trae por dominio. Un dominio real no tiene mil controles. */
export const MAX_CLASES_POR_DOMINIO = 500;

/**
 * Lo que la publicacion manda. `pasos` viaja como `unknown` a proposito: lo primero que hace este
 * repositorio es parsearlo contra el contrato, y tipar la entrada como ya valida seria fingir que la
 * puerta no hace falta.
 */
export interface PlantillaParaPublicar {
  /** Conjunto de dominios ordenado y unido con '+' (dominiosClave, packages/shared). */
  dominiosClave: string;
  /** Familia del verbo irreversible del objetivo. Se valida contra la lista cerrada de los ocho. */
  codigoDeIntencion: string;
  /** Pasos con la forma de PasoPublicable. Se parsean y se revalidan enteros antes del insert. */
  pasos: unknown;
  /** HMAC del origen de ESTA corrida. Opaco para el repositorio. */
  origenHash: string;
}

/**
 * Desenlace de una publicacion. Un rechazo NO es un error: es la puerta haciendo su trabajo, y el
 * llamador solo lo loguea. Se reserva la excepcion para los fallos reales de base.
 */
export type ResultadoDePublicacion =
  | {
      publicada: true;
      /**
       * ORIGENES DISTINTOS que la plantilla acumula DESPUES de este upsert. Es la unica cosa que la
       * publicacion devuelve, y es un CONTEO: 1 significa "solo la produjo este origen", que es
       * exactamente lo que el consumo va a tener que mirar. No devuelve la fila ni sus pasos: nada
       * lee esta tabla todavia.
       */
      origenes: number;
    }
  | { publicada: false; motivo: string };

interface FilaDeConteo {
  origenes: number | string | null;
}

export class PlantillasCompartidasRepository {
  constructor(private readonly sql: Sql) {}

  /**
   * UPSERT anonimo de una plantilla. Identidad NUEVA: fila con su procedimiento y el hash de origen.
   * Identidad YA CONOCIDA: agrega el hash SOLO si es nuevo (el `@>` de jsonb decide la pertenencia
   * dentro del mismo statement, sin leer antes: dos corridas simultaneas no pueden duplicar un
   * origen) y NO crea otra fila.
   *
   * LOS PASOS NO SE REEMPLAZAN cuando la identidad ya existe, al contrario que las estrategias del
   * atlas (V040). El atlas describe COMO se localiza un control hoy y la ultima observacion es la
   * mejor; una plantilla es un PROCEDIMIENTO COMPLETO, y dejar que la ultima corrida sobreescriba el
   * de todos permitiria que una variante peor (o una manipulada) desplazara a la que ya tenia aval.
   * Lo que crece con cada publicacion es el numero de origenes, que es lo que mide la corroboracion.
   */
  async publicar(plantilla: PlantillaParaPublicar): Promise<ResultadoDePublicacion> {
    // 1. EL CONTRATO. Sin pasos que validen no hay nada que guardar.
    const pasos = parsearPasosPublicables(plantilla.pasos);
    if (pasos === null) {
      return { publicada: false, motivo: 'los pasos no validan contra el contrato de plantillas' };
    }

    // 2. LA INTENCION. Lista cerrada de ocho, la misma que el CHECK de V041: un codigo que no este
    //    dentro nunca llega a la base, asi que el CHECK no tiene que ser quien lo diga.
    if (!esCodigoDeIntencion(plantilla.codigoDeIntencion)) {
      return { publicada: false, motivo: 'el codigo de intencion no es una de las ocho familias' };
    }

    // 3. LA IDENTIDAD DE DOMINIOS. Tiene que existir y tiene que CONTENER a todos los dominios que
    //    los propios pasos nombran: una plantilla no puede decir que corre donde su clave no declara.
    const dominios = plantilla.dominiosClave.split('+').filter((dominio) => dominio !== '');
    if (dominios.length === 0) {
      return { publicada: false, motivo: 'la plantilla no declara ningun dominio' };
    }
    const declarados = new Set(dominios);
    const usados = dominiosDePasosPublicables(pasos);
    if (usados.some((dominio) => !declarados.has(dominio))) {
      return {
        publicada: false,
        motivo: 'algun paso corre en un dominio que la identidad de la plantilla no declara',
      };
    }

    // 4. LA SEGUNDA PUERTA. La MISMA esPublicable del worker, contra las clases que este proceso lee
    //    por su cuenta. Un dominio del que el atlas no sepa nada deja el conjunto vacio y con eso la
    //    plantilla se rechaza, que es el estado seguro.
    const corroboradas = await this.clasesCorroboradas(dominios);
    const primerDominio = dominios[0] ?? '';
    const veredicto = esPublicable(pasos, primerDominio, corroboradas);
    if (!veredicto.publicable) {
      return { publicada: false, motivo: `la plantilla no es publicable (${veredicto.motivo})` };
    }

    // 5. LOS MARCADORES se DERIVAN de los pasos, no se reciben: es la unica forma de que la clave de
    //    identidad no pueda contradecir lo que la plantilla va a pedir de verdad al ejecutarse.
    const marcadores = marcadoresClave(marcadoresDePasosPublicables(veredicto.pasos));

    return this.upsert({
      dominiosClave: plantilla.dominiosClave,
      codigoDeIntencion: plantilla.codigoDeIntencion,
      marcadoresClave: marcadores,
      pasos: veredicto.pasos,
      origenHash: plantilla.origenHash,
    });
  }

  /**
   * Las CLASES DE ELEMENTO que el atlas (V040) tiene avaladas por al menos ORIGENES_PARA_PUBLICAR
   * origenes independientes, en los dominios indicados.
   *
   * El umbral se mide sobre `origenes_hash` y NO admite el atajo del propio origen que si usa el
   * servicio de pistas (`esServible`, apps/worker/src/atlas-sitios.ts): ahi el atajo es inocuo porque
   * a un origen se le devuelve lo que el mismo produjo, mientras que aqui la clase acaba ESCRITA en
   * una tabla global, dentro del nombre de las ranuras de la plantilla.
   */
  private async clasesCorroboradas(dominios: readonly string[]): Promise<Set<string>> {
    const filas = await this.sql<Array<{ clase_de_elemento: string }>>`
      select clase_de_elemento
      from aprendizaje_sitios
      where dominio in ${this.sql([...dominios])}
        and jsonb_array_length(origenes_hash) >= ${ORIGENES_PARA_PUBLICAR}
      limit ${MAX_CLASES_POR_DOMINIO * dominios.length}
    `;
    return new Set(filas.map((fila) => fila.clase_de_elemento));
  }

  /** El insert con su `on conflict`. Separado para que `publicar` se lea como la lista de puertas. */
  private async upsert(fila: {
    dominiosClave: string;
    codigoDeIntencion: string;
    marcadoresClave: string;
    pasos: PasoPublicable[];
    origenHash: string;
  }): Promise<ResultadoDePublicacion> {
    const pasos = this.sql.json(fila.pasos as unknown as Parameters<Sql['json']>[0]);
    const origen = this.sql.json([fila.origenHash] as unknown as Parameters<Sql['json']>[0]);
    const filas = await this.sql<FilaDeConteo[]>`
      insert into plantillas_compartidas
        (dominios_clave, codigo_de_intencion, marcadores_clave, pasos, origenes_hash)
      values
        (${fila.dominiosClave}, ${fila.codigoDeIntencion}, ${fila.marcadoresClave}, ${pasos}, ${origen})
      on conflict (dominios_clave, codigo_de_intencion, marcadores_clave) do update set
        origenes_hash = case
          when plantillas_compartidas.origenes_hash @> excluded.origenes_hash
            then plantillas_compartidas.origenes_hash
          else plantillas_compartidas.origenes_hash || excluded.origenes_hash
        end,
        actualizada_en = now()
      returning jsonb_array_length(origenes_hash) as origenes
    `;
    return { publicada: true, origenes: Number(filas[0]?.origenes ?? 1) };
  }
}
