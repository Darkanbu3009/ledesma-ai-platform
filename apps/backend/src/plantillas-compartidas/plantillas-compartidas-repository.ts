import type { MotivoDeFallaDePlantilla, PasoPublicable, Sql } from '@ledesma-platform/shared';
import {
  dominiosDePasosPublicables,
  esCodigoDeIntencion,
  esMotivoDeFallaDePlantilla,
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
 * CUATRO OPERACIONES: `publicar` (upsert anonimo), `buscarServible` (la lectura del CONSUMO, por la
 * clave de tres columnas de la identidad), `diagnosticarMiss` (donde se corto esa lectura cuando no
 * devolvio nada, y SOLO despues de un miss) y `registrarEjecucion` (los contadores de como le fue).
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

/**
 * UMBRAL DE CORROBORACION (D3): con al menos estos ORIGENES distintos y estos CONSUMIDORES distintos
 * con exito, una 'candidata' pasa a 'corroborada'. Sin checkpoint humano, corroborada es una senal de
 * CALIDAD (desempate y badge), no una autorizacion: el flujo de ejecucion no cambia.
 */
export const UMBRAL_DE_CORROBORACION = 2;

/**
 * FALLOS IMPUTABLES CONSECUTIVOS que retiran una plantilla (D4). Sin humano en el circuito, el retiro
 * es la UNICA defensa contra plantillas rotas: al tercero seguido, la fila pasa a 'retirada' y deja
 * de servirse sola ('retirada' esta fuera de ESTADOS_SERVIBLES). Aplica igual a 'corroborada'.
 */
export const FALLOS_PARA_RETIRO = 3;

/**
 * LOS MOTIVOS IMPUTABLES A LA PLANTILLA (D4): la barrera bloqueo un paso (la fila apunta a otro
 * control) o corrio entera sin efecto (el procedimiento ya no funciona). 'abandonada' y 'sesion'
 * suman `ejecuciones_fallidas` pero NO `fallos_consecutivos`: cortan la racha de retiro, porque hablan
 * del sitio o de la sesion de ese consumidor, no del procedimiento.
 */
const MOTIVOS_IMPUTABLES: ReadonlySet<MotivoDeFallaDePlantilla> = new Set<MotivoDeFallaDePlantilla>([
  'barrera_bloqueada',
  'sin_efecto',
]);

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
       * ORIGENES DISTINTOS que la plantilla acumula DESPUES de este upsert. Es un CONTEO: 1 significa
       * "solo la produjo este origen", que es exactamente lo que el consumo va a tener que mirar. No
       * devuelve la fila ni sus pasos.
       */
      origenes: number;
      /**
       * REHABILITACION (D5): la identidad ya existia como fila 'retirada' y esta publicacion nueva
       * del motor libre la regreso a 'candidata' (con la racha de fallos y los consumidores en cero;
       * los origenes se conservan). Para el log del worker, que nombra la identidad y nunca un hash.
       */
      rehabilitada: boolean;
    }
  | { publicada: false; motivo: string };

interface FilaDeConteo {
  origenes: number | string | null;
  estado_previo?: string | null;
}

/**
 * LO QUE DEVUELVE `registrarEjecucion`: el estado ANTES y DESPUES del update (para que el worker
 * loguee las transiciones) y la IDENTIDAD de la fila (dominios, intencion, marcadores), que es lo
 * unico con lo que se permite loguear: jamas un hash. null cuando la fila no existe.
 */
export interface RegistroDeEjecucion {
  estado: string;
  estadoPrevio: string;
  dominiosClave: string;
  codigoDeIntencion: string;
  marcadoresClave: string;
}

interface FilaDeRegistro {
  estado: string;
  estado_previo: string | null;
  dominios_clave: string;
  codigo_de_intencion: string;
  marcadores_clave: string;
}

/**
 * ESTADOS que se pueden servir: 'retirada' no sale nunca de la base, y sin checkpoint humano ese es
 * el UNICO freno automatico contra plantillas rotas (D4). 'corroborada' no cambia el flujo: es senal
 * de calidad, gana el desempate y se muestra como badge.
 */
const ESTADOS_SERVIBLES: readonly string[] = ['candidata', 'corroborada'];

/**
 * UNA plantilla tal como se le sirve a un consumidor. Deliberadamente MINIMA: el procedimiento, su
 * estado y cuantos origenes distintos la avalan. No devuelve `origenes_hash` -- ni siquiera al worker,
 * que es quien tiene la clave -- porque para decidir solo hace falta el CONTEO, y devolver la lista
 * permitiria comparar hashes fuera de la unica query que tiene que hacerlo (la de exclusion de abajo).
 */
export interface PlantillaServible {
  id: string;
  estado: string;
  /** Pasos CRUDOS del jsonb. El worker los parsea contra el contrato antes de mirarlos. */
  pasos: unknown;
  origenes: number;
}

interface FilaServible {
  id: string;
  estado: string;
  pasos: unknown;
  origenes: number | string | null;
}

/**
 * DONDE SE CORTO la lectura del consumo cuando no devolvio nada. Conjunto CERRADO de cuatro, uno por
 * cada filtro de `buscarServible` y en el orden en que la consulta los aplica.
 *
 * POR QUE EXISTE: el veredicto 'sin_plantilla' no decia nada, y averiguar la causa costo TRES
 * investigaciones read-only completas (el origen propio que excluia para siempre, la igualdad exacta
 * de marcadores y la divergencia entre los textos de los dos lados). Con este campo, la cuarta se
 * responde mirando el resultado del job.
 *
 * ES VOCABULARIO CERRADO, igual que los motivos del worker: ni un dato del usuario, del sitio ni de la
 * tabla. Y el diagnostico NO mira el hash de nadie -- ni siquiera para decir `origen_propio`, que es el
 * corte RESIDUAL: si hay una fila con esta identidad, con los marcadores contenidos y en estado
 * servible, y aun asi la lectura no la devolvio, el unico filtro que queda es el del origen.
 */
export type CorteDelConsumo =
  /** No hay ninguna fila para este conjunto de dominios y esta intencion. */
  | 'sin_identidad_en_tabla'
  /** Las hay, pero ninguna pide un subconjunto de los marcadores que el consumidor declara. */
  | 'marcadores_no_contenidos'
  /** La fila existe y su clave casa, pero su estado no se sirve ('retirada'). */
  | 'estado_no_servible'
  /** La fila existe, casa y es servible: el unico origen que la avala es el del consumidor. */
  | 'origen_propio';

export interface DiagnosticoDelMiss {
  corte: CorteDelConsumo;
  /** Cuantos origenes tiene la fila que SI matcheo la clave, o null si ninguna la matcheo. */
  origenes: number | null;
}

interface FilaDeDiagnostico {
  marcadores_clave: string;
  estado: string;
  origenes: number | string | null;
}

/**
 * TOPE de filas del diagnostico. No es un limite arbitrario: con una identidad de dominios y una
 * intencion fijas, el indice unico de V041 deja como mucho UNA fila por conjunto de marcadores, y los
 * conjuntos posibles son los subconjuntos de los seis marcadores del contrato. 2^6 = 64.
 */
export const MAX_FILAS_DE_DIAGNOSTICO = 64;

/** Cuantos marcadores exige una clave ('' = ninguno). El MISMO conteo que hace el `order by`. */
function marcadoresDeLaClave(clave: string): number {
  return clave === '' ? 0 : clave.split('+').length;
}

/**
 * EL MISMO DESEMPATE del `order by` de `buscarServible`, en TypeScript: la mas especifica primero,
 * despues 'corroborada' sobre 'candidata' (D3: a igualdad de marcadores gana la que ya demostro
 * calidad) y despues la mas corroborada por origenes. Existe para que "la fila que si matcheo la
 * clave" del diagnostico sea la MISMA que la consulta habria elegido, y no otra cualquiera.
 */
function porElDesempate(a: FilaDeDiagnostico, b: FilaDeDiagnostico): number {
  const rango = (fila: FilaDeDiagnostico): number => (fila.estado === 'corroborada' ? 1 : 0);
  return (
    marcadoresDeLaClave(b.marcadores_clave) - marcadoresDeLaClave(a.marcadores_clave) ||
    rango(b) - rango(a) ||
    Number(b.origenes ?? 0) - Number(a.origenes ?? 0)
  );
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
   * LA LECTURA DEL CONSUMO: la plantilla de esta IDENTIDAD que se le puede servir a un consumidor.
   *
   * ES UN WHERE DE TRES COLUMNAS mas dos filtros, y no hay un LIKE ni un orden por popularidad. Cero
   * texto libre entra a esta query.
   *
   * LA CONTENCION, y es la unica diferencia con una igualdad de tres columnas: `marcadores_clave` se
   * compara contra el conjunto que el consumidor declara Y CONTRA TODOS SUS SUBCONJUNTOS, que el
   * worker genera antes de llamar (`clavesDeMarcadoresContenidos`, apps/worker). La plantilla aplica
   * si lo que ELLA exige esta contenido en lo que el consumidor trae; con la igualdad exacta, un dato
   * de mas del consumidor la volvia inencontrable. Sigue siendo IGUALDAD contra una lista, o sea las
   * mismas tres columnas del indice unico de V041 y en el mismo orden: sin migracion, sin columna
   * nueva y sin un segundo indice. La lista tiene 64 cadenas como maximo (2^6, los subconjuntos de los
   * seis marcadores del contrato).
   *
   * EL DESEMPATE, porque con contencion pueden calificar varias filas y elegir al azar significaria
   * que la misma tarea corre un procedimiento distinto en cada corrida:
   *  1. LA MAS ESPECIFICA: la que exige mas marcadores. Es la que mas cerca esta de lo que el usuario
   *     pidio, y la que deja menos campos sin llenar.
   *  2. LA MAS CORROBORADA: mas origenes distintos y despues mas ejecuciones exitosas.
   *  3. EL `id`, que es UNICO. No es un criterio de calidad: es lo que convierte un orden parcial en
   *     TOTAL, para que dos corridas con los mismos datos elijan siempre la misma fila.
   *
   * LOS DOS FILTROS:
   *  - `estado`: 'retirada' no se sirve nunca.
   *  - EL ORIGEN PROPIO: no se sirve la plantilla cuyo UNICO origen es el consumidor. La produjo el
   *    mismo, asi que ya la tiene por sus propias recetas y ofrecersela como descubrimiento de otra
   *    cuenta seria falso. BASTA CON QUE QUEDE UN ORIGEN DISTINTO del suyo, y la diferencia no es
   *    teorica: el predicado anterior decia "cualquier plantilla a la que yo haya contribuido alguna
   *    vez", asi que una fila con DOS origenes reales quedaba fuera del alcance de LAS DOS cuentas
   *    para siempre, pese a que cada una tenia el aval de la otra. El lazo tampoco se recuperaba
   *    solo: la consulta fallaba, la tarea caia al motor libre, el exito volvia a publicar, el `on
   *    conflict` deduplicaba el origen y la corrida siguiente volvia a fallar igual.
   *    La comparacion sigue ocurriendo DENTRO del propio statement: el hash no sale de la base ni se
   *    compara en el worker.
   *
   * El hash es OPACO para este repositorio, igual que en `publicar`: no lo deriva, no lo guarda y no
   * puede volver de el al usuario.
   */
  async buscarServible(clave: {
    dominiosClave: string;
    codigoDeIntencion: string;
    /** El conjunto de marcadores del consumidor y todos sus subconjuntos, ya en formato de clave. */
    marcadoresPosibles: readonly string[];
    /** HMAC del origen del CONSUMIDOR, con la clave de plantillas del worker. */
    origenHash: string;
  }): Promise<PlantillaServible | null> {
    // Un consumidor siempre trae al menos la clave vacia (el subconjunto vacio). Sin ninguna no hay
    // nada que preguntar, y un `in ()` no seria una consulta valida.
    if (clave.marcadoresPosibles.length === 0) return null;
    const filas = await this.sql<FilaServible[]>`
      select id, estado, pasos, jsonb_array_length(origenes_hash) as origenes
      from plantillas_compartidas
      where dominios_clave = ${clave.dominiosClave}
        and codigo_de_intencion = ${clave.codigoDeIntencion}
        and marcadores_clave in ${this.sql([...clave.marcadoresPosibles])}
        and estado in ${this.sql([...ESTADOS_SERVIBLES])}
        and exists (
          select 1
          from jsonb_array_elements_text(origenes_hash) as origen(hash)
          where origen.hash <> ${clave.origenHash}
        )
      order by
        case
          when marcadores_clave = '' then 0
          else length(marcadores_clave) - length(replace(marcadores_clave, '+', '')) + 1
        end desc,
        -- D3: a igualdad de marcadores, 'corroborada' gana a 'candidata'. Va por ENCIMA de los
        -- desempates de corroboracion cruda porque el estado ya resume esa evidencia (origenes Y
        -- consumidores distintos), y por debajo de la especificidad: la plantilla que mas se parece
        -- a lo pedido sigue mandando.
        case when estado = 'corroborada' then 1 else 0 end desc,
        origenes desc,
        ejecuciones_exitosas desc,
        id asc
      limit 1
    `;
    const fila = filas[0];
    if (fila === undefined) return null;
    return {
      id: fila.id,
      estado: fila.estado,
      pasos: fila.pasos,
      origenes: Number(fila.origenes ?? 0),
    };
  }

  /**
   * DONDE SE CORTO la busqueda cuando `buscarServible` no devolvio nada (ver `CorteDelConsumo`).
   *
   * SOLO CORRE DESPUES DE UN MISS, nunca en el camino feliz: es una consulta mas, y el consumo no
   * puede pagarla cuando ya encontro lo que buscaba. El llamador la trata como best-effort.
   *
   * ES LA MISMA IDENTIDAD SIN EL FILTRO DE MARCADORES: se traen las filas de este conjunto de dominios
   * y esta intencion (como mucho 64, ver MAX_FILAS_DE_DIAGNOSTICO) y los cuatro cortes se deciden
   * aqui, en orden. NO se le pregunta nada al hash de origen: `origen_propio` es el corte residual, y
   * eso mantiene esta consulta todavia mas anonima que la del consumo.
   */
  async diagnosticarMiss(clave: {
    dominiosClave: string;
    codigoDeIntencion: string;
    /** Las mismas claves con las que se busco: el conjunto declarado y todos sus subconjuntos. */
    marcadoresPosibles: readonly string[];
  }): Promise<DiagnosticoDelMiss> {
    const filas = await this.sql<FilaDeDiagnostico[]>`
      select marcadores_clave, estado, jsonb_array_length(origenes_hash) as origenes
      from plantillas_compartidas
      where dominios_clave = ${clave.dominiosClave}
        and codigo_de_intencion = ${clave.codigoDeIntencion}
      limit ${MAX_FILAS_DE_DIAGNOSTICO}
    `;
    if (filas.length === 0) return { corte: 'sin_identidad_en_tabla', origenes: null };

    const posibles = new Set(clave.marcadoresPosibles);
    const contenidas = filas
      .filter((fila) => posibles.has(fila.marcadores_clave))
      .sort(porElDesempate);
    const mejor = contenidas[0];
    if (mejor === undefined) return { corte: 'marcadores_no_contenidos', origenes: null };

    const servible = contenidas.find((fila) => ESTADOS_SERVIBLES.includes(fila.estado));
    if (servible === undefined) {
      return { corte: 'estado_no_servible', origenes: Number(mejor.origenes ?? 0) };
    }
    return { corte: 'origen_propio', origenes: Number(servible.origenes ?? 0) };
  }

  /**
   * COMO LE FUE a una plantilla en una ejecucion, en AGREGADO y sin decir a quien, MAS las
   * transiciones de `estado` que esa ejecucion dispara. TODO ocurre en UN SOLO statement de update
   * (el CTE `antes` solo lee el estado previo para el log): contadores, evidencia de consumo y
   * transicion son ATOMICOS, y dos corridas simultaneas no pueden dejar la fila a medias.
   *
   * EXITO (D2 y D3):
   *  - suma `ejecuciones_exitosas`, pone `fallos_consecutivos` en 0 y limpia `ultima_falla_motivo`;
   *  - agrega `consumidorHash` a `consumidores_hash` SOLO si es nuevo (misma tecnica `@>` del
   *    on conflict de `origenes_hash`): el mismo consumidor dos veces cuenta UNA;
   *  - si la fila es 'candidata' y queda con origenes >= UMBRAL y consumidores >= UMBRAL (contando el
   *    actual), pasa a 'corroborada'. Es senal de CALIDAD (desempate y badge), no un cambio de flujo.
   *
   * FALLO (D4):
   *  - suma `ejecuciones_fallidas` y persiste el motivo (V042, validado ademas del CHECK);
   *  - `fallos_consecutivos` solo sube con un motivo IMPUTABLE a la plantilla (barrera_bloqueada o
   *    sin_efecto); 'abandonada' y 'sesion' CORTAN la racha (0) sin dejar de contar como fallidas;
   *  - al FALLOS_PARA_RETIRO imputable seguido, la fila pasa a 'retirada' (tambien desde
   *    'corroborada') y deja de servirse sola: 'retirada' esta fuera de ESTADOS_SERVIBLES.
   *  - los fallos NO escriben `consumidores_hash`.
   *
   * Devuelve estado previo y nuevo con la IDENTIDAD de la fila para que el worker loguee las
   * transiciones (dominios, intencion, marcadores: jamas un hash). El llamador lo trata como
   * BEST-EFFORT: el desenlace del job ya esta decidido cuando esto corre.
   */
  async registrarEjecucion(
    id: string,
    exitosa: boolean,
    motivo?: MotivoDeFallaDePlantilla,
    consumidorHash?: string,
  ): Promise<RegistroDeEjecucion | null> {
    if (exitosa) {
      // El hash del consumidor viaja como lista de 0 o 1 elementos: con lista vacia, el `||` y el
      // `@>` son no-ops y el conteo de consumidores queda como estaba (llamador legado sin hash).
      const consumidor = this.sql.json(
        (consumidorHash === undefined ? [] : [consumidorHash]) as unknown as Parameters<
          Sql['json']
        >[0],
      );
      const filas = await this.sql<FilaDeRegistro[]>`
        with antes as (select estado from plantillas_compartidas where id = ${id})
        update plantillas_compartidas set
          ejecuciones_exitosas = ejecuciones_exitosas + 1,
          fallos_consecutivos = 0,
          ultima_falla_motivo = null,
          -- D2: el consumidor se agrega SOLO si es nuevo, con la misma tecnica del on conflict de
          -- origenes_hash. La deduplicacion y el conteo ocurren DENTRO del statement.
          consumidores_hash = case
            when consumidores_hash @> ${consumidor} then consumidores_hash
            else consumidores_hash || ${consumidor}
          end,
          -- D3: candidata -> corroborada cuando las DOS mitades del ciclo tienen evidencia doble:
          -- origenes distintos que la produjeron y consumidores distintos que la ejecutaron con
          -- exito (contando el actual, ya deduplicado por la misma expresion de arriba).
          estado = case
            when estado = 'candidata'
              and jsonb_array_length(origenes_hash) >= ${UMBRAL_DE_CORROBORACION}
              and jsonb_array_length(
                case
                  when consumidores_hash @> ${consumidor} then consumidores_hash
                  else consumidores_hash || ${consumidor}
                end
              ) >= ${UMBRAL_DE_CORROBORACION}
              then 'corroborada'
            else estado
          end,
          ultima_ejecucion_en = now(),
          actualizada_en = now()
        where id = ${id}
        returning estado, (select estado from antes) as estado_previo,
          dominios_clave, codigo_de_intencion, marcadores_clave
      `;
      return this.comoRegistro(filas[0]);
    }

    const motivoValidado = esMotivoDeFallaDePlantilla(motivo) ? motivo : null;
    // D4: solo los motivos imputables a la plantilla mueven la racha de retiro. Un motivo fuera del
    // vocabulario cae en "no imputable" (falla cerrada: no se retira por un motivo que no se entiende).
    const imputable = motivoValidado !== null && MOTIVOS_IMPUTABLES.has(motivoValidado);
    const filas = await this.sql<FilaDeRegistro[]>`
      with antes as (select estado from plantillas_compartidas where id = ${id})
      update plantillas_compartidas set
        ejecuciones_fallidas = ejecuciones_fallidas + 1,
        -- Los fallos SEGUIDOS solo los mueve un motivo imputable; los demas cortan la racha.
        fallos_consecutivos = case when ${imputable} then fallos_consecutivos + 1 else 0 end,
        ultima_falla_motivo = ${motivoValidado},
        -- D4: el retiro, en el MISMO statement que el contador que lo dispara. Aplica igual a
        -- 'corroborada': sin humano en el circuito, una plantilla que falla seguido se retira sola.
        estado = case
          when ${imputable} and fallos_consecutivos + 1 >= ${FALLOS_PARA_RETIRO} then 'retirada'
          else estado
        end,
        ultima_ejecucion_en = now(),
        actualizada_en = now()
      where id = ${id}
      returning estado, (select estado from antes) as estado_previo,
        dominios_clave, codigo_de_intencion, marcadores_clave
    `;
    return this.comoRegistro(filas[0]);
  }

  /** La fila del returning como registro para el log del worker. null si el update no toco nada. */
  private comoRegistro(fila: FilaDeRegistro | undefined): RegistroDeEjecucion | null {
    if (fila === undefined) return null;
    return {
      estado: fila.estado,
      estadoPrevio: fila.estado_previo ?? fila.estado,
      dominiosClave: fila.dominios_clave,
      codigoDeIntencion: fila.codigo_de_intencion,
      marcadoresClave: fila.marcadores_clave,
    };
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

  /**
   * El insert con su `on conflict`. Separado para que `publicar` se lea como la lista de puertas.
   *
   * REHABILITACION (D5): una publicacion NUEVA del motor libre sobre la identidad de una fila
   * 'retirada' la regresa a 'candidata' con la racha de fallos en 0 y los consumidores en '[]' (la
   * evidencia de consumo era del procedimiento que fallaba; la corroboracion se vuelve a ganar).
   * `origenes_hash` SE CONSERVA y se le suma el origen actual si es nuevo, igual que siempre. Todo en
   * el MISMO statement del upsert: la transicion es atomica. El CTE `antes` solo lee el estado previo
   * para que el llamador pueda loguear la rehabilitacion con la identidad de la fila.
   */
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
      with antes as (
        select estado from plantillas_compartidas
        where dominios_clave = ${fila.dominiosClave}
          and codigo_de_intencion = ${fila.codigoDeIntencion}
          and marcadores_clave = ${fila.marcadoresClave}
      )
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
        estado = case
          when plantillas_compartidas.estado = 'retirada' then 'candidata'
          else plantillas_compartidas.estado
        end,
        fallos_consecutivos = case
          when plantillas_compartidas.estado = 'retirada' then 0
          else plantillas_compartidas.fallos_consecutivos
        end,
        consumidores_hash = case
          when plantillas_compartidas.estado = 'retirada' then '[]'::jsonb
          else plantillas_compartidas.consumidores_hash
        end,
        actualizada_en = now()
      returning jsonb_array_length(origenes_hash) as origenes,
        (select estado from antes) as estado_previo
    `;
    return {
      publicada: true,
      origenes: Number(filas[0]?.origenes ?? 1),
      rehabilitada: filas[0]?.estado_previo === 'retirada',
    };
  }
}
