import {
  esAtributoDeIdentidad,
  esDominioDePaso,
  esMarcadorParametro,
  esNombreDeIdentidad,
  MAX_ESPERA_MS,
  MAX_ESTRATEGIAS_POR_PASO,
  MAX_PASOS_RECETA,
  MAX_TEXTO_PASO_CHARS,
  parsearEstrategia,
  type AccionDeReceta,
  type DesempateDeIdentidad,
  type EstrategiaLocalizacion,
  type MarcadorParametro,
  type ValorDePaso,
} from '../recetas/contrato.js';

/**
 * CONTRATO de las PLANTILLAS COMPARTIDAS (V041): la forma de los pasos que se persisten en
 * `plantillas_compartidas.pasos` y la REGLA COMPLETA de que se puede publicar y que no.
 *
 * QUE ES UNA PLANTILLA. El PROCEDIMIENTO de una tarea, sin el usuario. Una receta (V035) dice "en
 * mail.google.com, para la firma 'envia un correo a <destinatario> con asunto <asunto>', haz estos
 * pasos". Una plantilla dice "en mail.google.com, para la intencion 'enviar' con los datos
 * {asunto, destinatario}, haz estos pasos": ni firma, ni descripcion, ni dueno, ni un solo valor.
 *
 * IDENTIDAD DE UNA PLANTILLA: (conjunto de dominios, codigo de intencion, conjunto de marcadores
 * exigidos). Los tres componentes YA EXISTEN en el repo y NINGUNO lo redacta un modelo:
 *  - el conjunto de dominios sale de los dominios de la tarea, ordenados y deduplicados (mismo
 *    criterio que sufijoDeDominios, apps/worker/src/receta-web.ts);
 *  - el codigo de intencion es la FAMILIA del verbo irreversible que el usuario escribio, que asigna
 *    una expresion regular sobre su texto literal (VERBOS_ACCION_BLOQUEADA y detectarVerboBloqueado,
 *    apps/worker/src/prompt-tarea-web.ts);
 *  - el conjunto de marcadores sale de `marcadoresDeParametros` (contrato de recetas), la unica
 *    fuente que no puede divergir de lo que la ejecucion va a pedir de verdad.
 * La firma del objetivo NO es la identidad, a proposito: sigue siendo la frase del usuario, con su
 * idioma y sus palabras, y por tanto un cuasi identificador que no puede viajar a una tabla global.
 *
 * POR QUE EL CONTRATO VIVE EN SHARED, y aqui es mas fuerte que en las recetas: la regla de
 * publicacion (`esPublicable`) corre DOS VECES, en el worker antes de mandar la plantilla y en el
 * repositorio del backend antes del insert. Una sola definicion es lo que hace que las dos puertas
 * sean LA MISMA puerta y no dos que puedan divergir en silencio.
 *
 * LA RANURA, la pieza que hace viable todo esto. Un `esPublicable` estricto publicaria CERO
 * plantillas de correo: el extractor de parametros exige ROTULO Y COMILLAS para declarar un asunto o
 * un cuerpo (patronRotulado, apps/worker/src/parametros-objetivo.ts), y medido sobre el corpus de
 * objetivos del repo casi ningun objetivo real los declara, asi que esos pasos quedan con un LITERAL
 * en la receta. Un literal no se publica JAMAS. La salida es no publicar el valor sino el HUECO: un
 * paso cuyo valor es literal pero cuya CLASE DE ELEMENTO esta corroborada se publica como RANURA
 * VACIA nombrada por la clase, nunca por el valor:
 *
 *     { tipo: 'ranura', clase: 'escribir|rol:textbox|asunto' }
 *
 * El valor lo aporta el consumidor desde SU propio objetivo en tiempo de ejecucion. El mapeo
 * clase -> marcador es una tabla CERRADA y pequena (ver MARCADOR_POR_NOMBRE_DE_CLASE) y falla
 * cerrada: una clase que no mapea a ningun marcador es RECHAZO DE PUBLICACION, no una ranura anonima
 * que el consumidor tendria que adivinar como llenar.
 *
 * POR QUE NO SE AMPLIO extraerParametrosDeclarados en vez de inventar la ranura: ese extractor lo
 * comparten `firmaDeObjetivo`, `descripcionGeneralizada` y la guardia de accion. Ampliarlo
 * DESPLAZARIA las firmas de las recetas ya guardadas, y `buscarActiva` compara la firma por igualdad
 * exacta: toda receta cuya firma se moviera dejaria de encontrarse en silencio, para todos los
 * usuarios. La ranura consigue lo mismo sin tocar nada de eso.
 *
 * Modulo PURO, sin dependencias (shared no tiene zod): la validacion es a mano, mismo estilo que
 * `parsearPasosDeReceta` en recetas/contrato.ts, y con la MISMA politica de rechazo TOTAL.
 */

/**
 * CODIGO DE INTENCION: la familia de accion irreversible que la plantilla lleva a cabo. Es la union
 * `AccionIrreversible` de apps/worker/src/prompt-tarea-web.ts, replicada aqui porque shared no puede
 * importar del worker, y es lo que el CHECK de V041 admite. El worker la mapea con un Record
 * EXHAUSTIVO (`CODIGO_POR_ACCION`, apps/worker/src/plantillas-compartidas.ts), asi que agregar una
 * familia alla sin agregarla aca no compila: las dos listas no pueden divergir en silencio.
 *
 * SOLO INTENCIONES IRREVERSIBLES, y el motivo es de seguridad y no de alcance: cuando el objetivo no
 * contiene ningun verbo de accion bloqueada, la guardia de accion deja pasar todo sin comparar nada
 * contra la pagina, asi que una plantilla reversible ajena correria de punta a punta sin una sola
 * comprobacion. No hay codigo para "reversible" porque no hay plantilla reversible.
 */
export type CodigoDeIntencion =
  | 'enviar'
  | 'publicar'
  | 'borrar'
  | 'pagar'
  | 'transferir'
  | 'comprar'
  | 'firmar'
  | 'cancelarSuscripcion';

/** Los ocho codigos, en el orden en que los lista el CHECK de V041. */
export const CODIGOS_DE_INTENCION: readonly CodigoDeIntencion[] = [
  'enviar',
  'publicar',
  'borrar',
  'pagar',
  'transferir',
  'comprar',
  'firmar',
  'cancelarSuscripcion',
];

/** ¿Es `valor` uno de los ocho codigos de intencion? */
export function esCodigoDeIntencion(valor: unknown): valor is CodigoDeIntencion {
  return typeof valor === 'string' && CODIGOS_DE_INTENCION.includes(valor as CodigoDeIntencion);
}

/**
 * Lo que un paso de escritura de una PLANTILLA teclea. Dos formas y NINGUNA lleva un valor:
 *  - `parametro`: el marcador que la receta ya guardaba porque el objetivo declaro ese dato. Se
 *    resuelve en cada corrida con los parametros del objetivo de ESA corrida, igual que en la receta.
 *  - `ranura`: el hueco de un campo cuyo valor la receta guardaba como LITERAL (el objetivo no lo
 *    declaro con rotulo y comillas). Viaja nombrado por la CLASE DE ELEMENTO del campo, y el
 *    consumidor decide con que llenarlo mirando su propio objetivo.
 *
 * NO EXISTE la variante `literal`, y esa ausencia es el mecanismo: no hay forma de representar un
 * valor de usuario dentro de una plantilla, igual que no hay columna donde guardarlo.
 */
export type ValorPublicable =
  | { tipo: 'parametro'; parametro: MarcadorParametro }
  | { tipo: 'ranura'; clase: string };

/**
 * Forma de volver a encontrar el elemento de un paso de plantilla. Son las tres ESTRUCTURALES del
 * contrato de recetas; el `xpath` queda FUERA a proposito, con el mismo criterio que el atlas
 * (V040): es la ruta del DOM de UNA sesion concreta, no describe el sitio para nadie mas y llevarla
 * a una tabla global seria publicar la forma del arbol de la pagina de un usuario.
 *
 * En `atributo`, SOLO `aria-label` y `data-*`. Quedan fuera `id` y `name` aunque el contrato de
 * recetas los admita, y es la misma exclusion que hace `esAtributoDeAtlas`: son justamente los que
 * llevan identificadores por cuenta o por sesion (el caso Gmail que motivo V038: ids como :u3, :q9),
 * y el identificador de la fila de un usuario no tiene nada que hacer en una tabla global.
 *
 * El `desempate` del rol viaja con el paso porque la clase que la plantilla DECLARA se recalcula de
 * estas mismas estrategias al consumirla (`plantillaAplicable`): sin el, el consumidor derivaria la
 * clase sin segundo eje y la plantilla no aplicaria nunca.
 */
export type EstrategiaPublicable =
  | { tipo: 'rol'; rol: string; nombre: string; desempate?: DesempateDeIdentidad | null }
  | { tipo: 'texto'; texto: string }
  | { tipo: 'atributo'; atributo: string; valor: string };

/** ¿Es un atributo que escribio quien programo el sitio (y no un id por cuenta o por sesion)? */
export function esAtributoPublicable(atributo: string): boolean {
  return atributo === 'aria-label' || /^data-[a-z0-9-]{1,40}$/.test(atributo);
}

/**
 * Lo que un paso de plantilla HACE. Es `AccionDeReceta` MENOS `navegar`: una navegacion existe solo
 * para llevar una RUTA, y una ruta puede llevar dentro el identificador de una cuenta, de un pedido o
 * de un mensaje. Una plantilla no lleva rutas.
 */
export type AccionPublicable = 'click' | 'escribir' | 'teclas' | 'esperar' | 'verificar';

const ACCIONES_PUBLICABLES: readonly AccionPublicable[] = [
  'click',
  'escribir',
  'teclas',
  'esperar',
  'verificar',
];

/** Las acciones que ACTUAN SOBRE UN ELEMENTO y por tanto tienen clase (y exigen tenerla). */
const ACCIONES_CON_ELEMENTO: ReadonlySet<AccionPublicable> = new Set<AccionPublicable>([
  'click',
  'escribir',
]);

/** ¿Esta accion de plantilla actua sobre un elemento del DOM? */
export function actuaSobreElemento(accion: AccionPublicable): boolean {
  return ACCIONES_CON_ELEMENTO.has(accion);
}

/**
 * UN paso publicable. Es un paso de receta con TRES EXCLUSIONES (sin `navegar`, sin `xpath`, sin
 * literal) y UNA EXIGENCIA que la receta no tiene: la CLASE DE ELEMENTO.
 *
 * POR QUE LA CLASE ES OBLIGATORIA aqui y opcional alla: es lo que la BARRERA DE IDENTIDAD DEL
 * ELEMENTO compara antes de actuar (barrera-identidad.ts). Una receta propia puede permitirse un paso
 * sin identidad estructural porque su dueno la aprendio de su propia corrida; un procedimiento AJENO
 * que va a mover el navegador de otra persona no puede: sin clase no hay nada que comparar contra lo
 * que el DOM realmente tiene, y actuar seria actuar a ciegas.
 *
 * "Obligatoria" quiere decir obligatoria PARA LO QUE LA BARRERA COMPARA, o sea para las acciones con
 * elemento (`click` y `escribir`). En `teclas`, `esperar` y `verificar` es NULL y tiene que serlo: no
 * hay elemento del que hablar (un paso `verificar` no toca la pagina y por contrato no lleva ni una
 * estrategia), asi que una clase ahi seria una afirmacion falsa. Exigirla en los cinco casos
 * rechazaria el 100 % de las plantillas, porque toda plantilla de intencion irreversible lleva por
 * construccion su paso `verificar`.
 *
 * `dominio` es NO NULO, al contrario que en la receta: una receta resuelve el paso sin dominio contra
 * `recetas_web.dominio`, pero una plantilla no tiene una columna de dominio propio contra la que
 * resolver (solo el CONJUNTO de la identidad). Cada paso dice donde corre y la plantilla se explica
 * sola.
 */
export interface PasoPublicable {
  /** Posicion en la plantilla, desde 0 y sin huecos. */
  idx: number;
  accion: AccionPublicable;
  /** Dominio en el que corre el paso. Siempre presente y siempre un hostname. */
  dominio: string;
  /**
   * Identidad estructural del control (`accion|eje|nombre`, ver claseDeElemento en
   * apps/worker/src/atlas-sitios.ts). NOT NULL en `click` y `escribir`; null en el resto.
   */
  claseDeElemento: string | null;
  /** Formas ESTRUCTURALES de localizar el elemento, en orden de intento. */
  estrategias: EstrategiaPublicable[];
  /** Solo 'escribir': el marcador de parametro o la ranura vacia. Jamas un valor. */
  valor: ValorPublicable | null;
  /** Solo 'teclas': combinacion a pulsar. */
  teclas: string | null;
  /** Solo 'esperar': milisegundos, acotados por MAX_ESPERA_MS. */
  esperaMs: number | null;
}

/**
 * Tope de longitud de una clase de elemento (`accion|eje|nombre`, con el nombre acotado a 60). El eje
 * puede llevar un SEGUNDO EJE (`rol:button@data-testid=...`), que suma el nombre del atributo mas su
 * valor: sin este margen, la clase de un control homonimo con un `data-*` largo pasaria de este tope
 * y su plantilla se rechazaria por una razon que no tiene nada que ver con lo que declara.
 */
export const MAX_CLASE_CHARS = 280;

/**
 * MAPEO CLASE -> MARCADOR de las ranuras. Tabla CERRADA y deliberadamente pequena: es la unica pieza
 * de este contrato que hace una AFIRMACION SEMANTICA ("este campo es el asunto"), asi que se
 * mantiene corta, revisable de un vistazo y sembrada de las clases que la plataforma ya vio de
 * verdad, no de las que se pueden imaginar.
 *
 * COMO SE SEMBRO. De los nombres accesibles de mail.google.com que el propio repo documenta como
 * medidos en produccion, no de fixtures de test:
 *  - "Cuerpo del mensaje" / "Message Body" (receta-web.ts, corrida del 28 jul 2026; verificacion.ts;
 *    promover-trayectoria.ts) -> cuerpo;
 *  - "Destinatarios en Para" (percepcion.ts y localizacion.ts, las dos citando evidencia de
 *    produccion) -> destinatario;
 *  - "Asunto" (prompt-tarea-web.ts, corrida medida del 25 jul 2026: "escribir destinatario, asunto y
 *    cuerpo") -> asunto.
 * Las variantes en ingles y los otros cuatro marcadores se siembran de los MISMOS vocabularios que ya
 * usan la verificacion determinista (CONTEXTO_ASUNTO, CONTEXTO_CUERPO, CONTEXTO_DESTINATARIO,
 * CONTEXTO_MONTO, CONTEXTO_CANTIDAD en verificacion.ts) y la tabla de campos equivalentes de la
 * percepcion (CAMPOS_EQUIVALENTES en percepcion.ts). Reusar esos vocabularios, y no inventar otro, es
 * lo que evita que el campo que la plantilla llama "asunto" sea uno distinto del que la verificacion
 * compara como asunto.
 *
 * COMO SE COMPARA: por PREFIJO sobre el nombre de la clase, que es el mismo criterio de la barrera de
 * identidad (barrera-identidad.ts) y por el mismo motivo: el nombre real lleva sufijos que la clase
 * no puede tener ("Destinatarios en Para" cuando el campo se llama "destinatario", "Enviar
 * (Ctrl-Enter)" cuando el boton se llama "Enviar"). El ORDEN IMPORTA: gana el primer patron que
 * matchea, asi que los mas especificos van antes ("cantidad a pagar" es un monto, no una cantidad).
 */
const MARCADOR_POR_NOMBRE_DE_CLASE: ReadonlyArray<{
  patron: RegExp;
  marcador: MarcadorParametro;
}> = [
  // Mas especificos primero: nombran dinero aunque empiecen con la palabra de otro marcador.
  { patron: /^cantidad a pagar\b/, marcador: 'monto' },
  { patron: /^monto\b/, marcador: 'monto' },
  { patron: /^importe\b/, marcador: 'monto' },
  { patron: /^amount\b/, marcador: 'monto' },
  // ASUNTO. "titulo" queda FUERA con el mismo criterio que PATRON_ASUNTO en parametros-objetivo.ts:
  // en un objetivo de compra nombra al producto.
  { patron: /^asunto\b/, marcador: 'asunto' },
  { patron: /^subject/, marcador: 'asunto' },
  // CUERPO del mensaje. "Cuerpo del mensaje" y "Message Body" son los dos nombres reales de Gmail.
  { patron: /^cuerpo\b/, marcador: 'cuerpo' },
  { patron: /^message body\b/, marcador: 'cuerpo' },
  { patron: /^body\b/, marcador: 'cuerpo' },
  { patron: /^mensaje\b/, marcador: 'cuerpo' },
  // DESTINATARIO. "Destinatarios en Para" es el nombre real del campo Para de Gmail.
  { patron: /^destinatarios?\b/, marcador: 'destinatario' },
  { patron: /^recipients?\b/, marcador: 'destinatario' },
  { patron: /^para\b/, marcador: 'destinatario' },
  { patron: /^to\b/, marcador: 'destinatario' },
  // CANTIDAD de unidades.
  { patron: /^cantidad\b/, marcador: 'cantidad' },
  { patron: /^quantity\b/, marcador: 'cantidad' },
  { patron: /^qty\b/, marcador: 'cantidad' },
  // PRODUCTO.
  { patron: /^producto\b/, marcador: 'producto' },
  { patron: /^product\b/, marcador: 'producto' },
  { patron: /^articulo\b/, marcador: 'producto' },
  // Los TRES marcadores de la interpretacion natural (D3a). Entran por aqui (el nombre de clase de la
  // ranura) y por la interpretacion del objetivo; el extractor determinista no los conoce y no debe
  // conocerlos. Los nombres llegan normalizados (minusculas, sin acentos) porque asi los construye
  // `claseDeElemento`.
  { patron: /^fecha\b/, marcador: 'fecha' },
  { patron: /^date\b/, marcador: 'fecha' },
  { patron: /^lugar\b/, marcador: 'lugar' },
  { patron: /^ubicacion\b/, marcador: 'lugar' },
  { patron: /^location\b/, marcador: 'lugar' },
  { patron: /^nombre\b/, marcador: 'nombre' },
  { patron: /^name\b/, marcador: 'nombre' },
];

/**
 * El NOMBRE de una clase de elemento: lo que sigue al SEGUNDO separador de `accion|eje|nombre`. Misma
 * lectura que nombreDeLaClase en apps/worker/src/barrera-identidad.ts. Devuelve null si la cadena no
 * tiene la forma de una clase.
 */
export function nombreDeLaClase(clase: string): string | null {
  const primero = clase.indexOf('|');
  if (primero < 0) return null;
  const segundo = clase.indexOf('|', primero + 1);
  if (segundo < 0) return null;
  const nombre = clase.slice(segundo + 1);
  return nombre === '' ? null : nombre;
}

/**
 * A QUE MARCADOR corresponde la ranura de esta clase, o null si a ninguno. FALLA CERRADA: null es
 * RECHAZO DE PUBLICACION en `esPublicable`, no una ranura anonima. Publicar un hueco que el
 * consumidor no sabe con que llenar produciria una plantilla que se planta a mitad de camino o, peor,
 * que teclea el dato equivocado en el campo equivocado.
 */
export function marcadorDeRanura(clase: string): MarcadorParametro | null {
  const nombre = nombreDeLaClase(clase);
  if (nombre === null) return null;
  for (const { patron, marcador } of MARCADOR_POR_NOMBRE_DE_CLASE) {
    if (patron.test(nombre)) return marcador;
  }
  return null;
}

/** Texto no vacio y acotado, o null. Mismo criterio que comoTextoAcotado del contrato de recetas. */
function comoTextoAcotado(valor: unknown, tope: number = MAX_TEXTO_PASO_CHARS): string | null {
  if (typeof valor !== 'string') return null;
  const limpio = valor.trim();
  if (limpio === '' || limpio.length > tope) return null;
  return limpio;
}

/**
 * Valida UNA estrategia de plantilla. Devuelve null ante cualquier cosa que no sea exactamente una de
 * las TRES formas estructurales con sus campos completos; en particular, un `xpath` (que el contrato
 * de recetas si admite) devuelve null y con eso el llamador rechaza la plantilla ENTERA.
 */
export function parsearEstrategiaPublicable(crudo: unknown): EstrategiaPublicable | null {
  // La MISMA regla de admision de identidad que aplica el atlas a la otra tabla global: un nombre
  // accesible, un texto visible o el valor de un atributo que lleve un dato o un identificador
  // dentro no se publica, aunque el tipo de estrategia sea de los admitidos.
  const estrategia = parsearEstrategia(crudo);
  if (estrategia === null || estrategia.tipo === 'xpath') return null;
  switch (estrategia.tipo) {
    case 'atributo': {
      if (!esAtributoPublicable(estrategia.atributo)) return null;
      if (!esAtributoDeIdentidad(estrategia.atributo, estrategia.valor)) return null;
      return { tipo: 'atributo', atributo: estrategia.atributo, valor: estrategia.valor };
    }
    case 'rol': {
      if (!esNombreDeIdentidad(estrategia.nombre)) return null;
      const { rol, nombre, desempate } = estrategia;
      if (desempate === undefined) return { tipo: 'rol', rol, nombre };
      return { tipo: 'rol', rol, nombre, desempate };
    }
    case 'texto':
      return esNombreDeIdentidad(estrategia.texto) ? { tipo: 'texto', texto: estrategia.texto } : null;
  }
}

/** Valida el `valor` de un paso de escritura publicable (marcador de parametro o ranura). */
function parsearValorPublicable(crudo: unknown): ValorPublicable | null {
  if (typeof crudo !== 'object' || crudo === null) return null;
  const objeto = crudo as Record<string, unknown>;
  if (objeto.tipo === 'parametro' && esMarcadorParametro(objeto.parametro)) {
    return { tipo: 'parametro', parametro: objeto.parametro };
  }
  if (objeto.tipo === 'ranura') {
    const clase = comoTextoAcotado(objeto.clase, MAX_CLASE_CHARS);
    // Una ranura sin marcador al que atarla NO es un paso valido: el consumidor no sabria con que
    // llenarla. Se rechaza aqui ademas de en esPublicable (las dos puertas, el mismo criterio).
    if (clase === null || marcadorDeRanura(clase) === null) return null;
    return { tipo: 'ranura', clase };
  }
  // 'literal' cae aqui: no existe en este contrato y su presencia invalida la plantilla entera.
  return null;
}

/** Combinacion de teclas admitida. Mismo patron que el contrato de recetas. */
const PATRON_TECLAS = /^[A-Za-z0-9]+(?:\+[A-Za-z0-9]+)*$/;

/** Valida UN paso publicable completo, con las exigencias propias de cada accion. */
function parsearPasoPublicable(crudo: unknown, idxEsperado: number): PasoPublicable | null {
  if (typeof crudo !== 'object' || crudo === null) return null;
  const objeto = crudo as Record<string, unknown>;
  if (objeto.idx !== idxEsperado) return null;
  const accion = objeto.accion;
  if (typeof accion !== 'string' || !ACCIONES_PUBLICABLES.includes(accion as AccionPublicable)) {
    return null;
  }
  // Una 'navegar' colada llega aqui y muere aqui: no esta en ACCIONES_PUBLICABLES.
  const accionPublicable = accion as AccionPublicable;

  // Un paso de plantilla SIEMPRE dice en que dominio corre (ver PasoPublicable.dominio).
  const dominio = comoTextoAcotado(objeto.dominio)?.toLowerCase();
  if (dominio === undefined || !esDominioDePaso(dominio)) return null;

  // Ni rastro de RUTA: el campo no existe en este contrato, asi que un paso que lo traiga esta
  // afirmando algo que una plantilla no puede llevar y la invalida entera.
  if (objeto.ruta !== undefined && objeto.ruta !== null) return null;

  const estrategiasCrudas = objeto.estrategias;
  if (!Array.isArray(estrategiasCrudas) || estrategiasCrudas.length > MAX_ESTRATEGIAS_POR_PASO) {
    return null;
  }
  const estrategias: EstrategiaPublicable[] = [];
  for (const estrategiaCruda of estrategiasCrudas) {
    const estrategia = parsearEstrategiaPublicable(estrategiaCruda);
    if (estrategia === null) return null;
    estrategias.push(estrategia);
  }

  // LA CLASE. Obligatoria y no nula en las acciones con elemento; obligatoriamente NULA en el resto,
  // donde no hay elemento del que hablar y declarar una clase seria una afirmacion falsa.
  const claseCruda = objeto.claseDeElemento;
  let claseDeElemento: string | null = null;
  if (actuaSobreElemento(accionPublicable)) {
    const clase = comoTextoAcotado(claseCruda, MAX_CLASE_CHARS);
    if (clase === null || nombreDeLaClase(clase) === null) return null;
    claseDeElemento = clase;
  } else if (claseCruda !== undefined && claseCruda !== null) {
    return null;
  }

  const paso: PasoPublicable = {
    idx: idxEsperado,
    accion: accionPublicable,
    dominio,
    claseDeElemento,
    estrategias,
    valor: null,
    teclas: null,
    esperaMs: null,
  };

  switch (accionPublicable) {
    case 'click':
      if (estrategias.length === 0) return null;
      return paso;
    case 'escribir': {
      if (estrategias.length === 0) return null;
      const valor = parsearValorPublicable(objeto.valor);
      if (valor === null) return null;
      return { ...paso, valor };
    }
    case 'teclas': {
      const teclas = comoTextoAcotado(objeto.teclas);
      if (teclas === null || !PATRON_TECLAS.test(teclas)) return null;
      // No actua sobre un elemento (el ejecutor pulsa sobre el foco): las estrategias sobran y se
      // descartan, mismo criterio que 'navegar' en el contrato de recetas.
      return { ...paso, estrategias: [], teclas };
    }
    case 'esperar': {
      const ms = objeto.esperaMs;
      if (typeof ms !== 'number' || !Number.isInteger(ms) || ms <= 0 || ms > MAX_ESPERA_MS) {
        return null;
      }
      return { ...paso, estrategias: [], esperaMs: ms };
    }
    case 'verificar':
      // No lleva ningun dato, igual que en la receta: lo que se verifica sale del objetivo de la
      // corrida y del DOM de ese momento, jamas de la plantilla.
      return { ...paso, estrategias: [] };
  }
}

/**
 * Lee los pasos de una plantilla tal como vuelven (o van a) el jsonb. Devuelve null (PLANTILLA
 * INVALIDA, no se guarda ni se sirve) si no es un arreglo, si esta vacio, si excede el tope, o si
 * CUALQUIER paso no valida.
 *
 * El rechazo es TOTAL con el mismo argumento que `parsearPasosDeReceta`, y aqui pesa mas: ejecutar
 * una plantilla AJENA a la que se le saltaron los pasos que no validaron seria ejecutar, en el
 * navegador de alguien, un procedimiento distinto del que nadie corroboro.
 */
export function parsearPasosPublicables(crudo: unknown): PasoPublicable[] | null {
  if (!Array.isArray(crudo) || crudo.length === 0 || crudo.length > MAX_PASOS_RECETA) return null;
  const pasos: PasoPublicable[] = [];
  for (let idx = 0; idx < crudo.length; idx++) {
    const paso = parsearPasoPublicable(crudo[idx], idx);
    if (paso === null) return null;
    pasos.push(paso);
  }
  return pasos;
}

/**
 * Los marcadores DISTINTOS que los pasos de una plantilla exigen del objetivo del consumidor:
 * solo los de valor `parametro`. Las RANURAS no entran: su dato lo decide el consumidor mirando su
 * propio objetivo en tiempo de ejecucion, y son justamente los campos que el extractor determinista
 * no declara, asi que no pueden formar parte de una clave que el consumidor tiene que poder calcular
 * antes de tener la plantilla en la mano.
 *
 * Devuelve la lista ORDENADA (el mismo orden que `marcadoresClave` usa), para que dos lecturas de la
 * misma plantilla den siempre lo mismo.
 */
export function marcadoresDePasosPublicables(
  pasos: readonly PasoPublicable[],
): MarcadorParametro[] {
  const presentes = new Set<MarcadorParametro>();
  for (const paso of pasos) {
    const valor = paso.valor;
    if (paso.accion === 'escribir' && valor !== null && valor.tipo === 'parametro') {
      presentes.add(valor.parametro);
    }
  }
  return [...presentes].sort();
}

/**
 * Los DOMINIOS distintos que los pasos de una plantilla nombran. Sirve para comprobar que la
 * plantilla no dice operar en un dominio que su propia identidad no declara.
 */
export function dominiosDePasosPublicables(pasos: readonly PasoPublicable[]): string[] {
  return [...new Set(pasos.map((paso) => paso.dominio))].sort();
}

/**
 * `dominios_clave`: el CONJUNTO de dominios de la tarea en minusculas, deduplicado, ORDENADO y unido
 * con '+'. Ordenado y deduplicado para que {tienda, correo} y {correo, tienda} sean la MISMA
 * plantilla; mismo criterio que sufijoDeDominios (apps/worker/src/receta-web.ts), que es lo que ya
 * agrupa las firmas de las recetas multisitio.
 *
 * A diferencia de sufijoDeDominios, NO se vacia con un solo dominio: aqui el conjunto es una columna
 * de la identidad, no un sufijo opcional de una firma, y una plantilla de un sitio tiene que decir de
 * cual. Devuelve '' solo si no se le da ningun dominio, que el llamador trata como no publicable.
 */
export function dominiosClave(dominios: readonly string[]): string {
  return [
    ...new Set(
      dominios.map((dominio) => dominio.trim().toLowerCase()).filter((dominio) => dominio !== ''),
    ),
  ]
    .sort()
    .join('+');
}

/**
 * `marcadores_clave`: el CONJUNTO de marcadores exigidos, deduplicado, ORDENADO ALFABETICAMENTE y
 * unido con '+'. Alfabetico y no en el orden canonico de MARCADORES a proposito: la clave tiene que
 * poder reconstruirse desde un conjunto de nombres suelto (que es lo unico que tendra el consumidor)
 * sin conocer ninguna tabla de orden.
 *
 * Devuelve '' cuando la plantilla no exige ningun dato, que es un valor legitimo de la columna (por
 * eso es NOT NULL DEFAULT '' en V041: en Postgres dos NULL no colisionan y el indice unico dejaria de
 * agrupar).
 */
export function marcadoresClave(marcadores: readonly MarcadorParametro[]): string {
  return [...new Set(marcadores)].sort().join('+');
}

/**
 * MOTIVO del ULTIMO FALLO de una plantilla (columna `ultima_falla_motivo`, V042). Vocabulario
 * CERRADO, compartido entre el worker (que lo deriva del desenlace de la ejecucion) y el repositorio
 * del backend (que lo valida antes del update, ademas del CHECK de la columna):
 *  - barrera_bloqueada: la barrera de identidad bloqueo un paso y la plantilla se abandono;
 *  - sin_efecto: corrio entera y el sitio no mostro que la accion surtiera efecto;
 *  - abandonada: un paso no se pudo ejecutar de forma determinista (sin escalada por este camino);
 *  - sesion: la sesion de navegador dejo de responder a mitad de la ejecucion.
 *  - desajuste_de_interfaz (V044): la SONDA DE RECONOCIMIENTO previa detecto que la pagina ya no
 *    tiene las clases de elemento observables que el procedimiento declara, y NO SE EJECUTO NI UN
 *    PASO. Es evidencia ESTRUCTURAL, no un fallo de ejecucion: alimenta su propio contador
 *    (`desajustes_hash`, distintos por consumidor) y no toca `fallos_consecutivos`.
 * Los contadores de V041 no cambian de semantica: esto solo dice POR QUE fue el ultimo fallo, que es
 * el insumo del retiro. Un exito lo limpia, igual que limpia `fallos_consecutivos`.
 */
export const MOTIVOS_DE_FALLA_DE_PLANTILLA = [
  'barrera_bloqueada',
  'sin_efecto',
  'abandonada',
  'sesion',
  'desajuste_de_interfaz',
] as const;

export type MotivoDeFallaDePlantilla = (typeof MOTIVOS_DE_FALLA_DE_PLANTILLA)[number];

/** ¿Es `valor` uno de los motivos de falla del vocabulario? Falla cerrada: lo demas no se persiste. */
export function esMotivoDeFallaDePlantilla(valor: unknown): valor is MotivoDeFallaDePlantilla {
  return (
    typeof valor === 'string' &&
    MOTIVOS_DE_FALLA_DE_PLANTILLA.includes(valor as MotivoDeFallaDePlantilla)
  );
}

/**
 * POR QUE una plantilla NO se puede publicar. Los siete motivos son un conjunto CERRADO y cada uno
 * rechaza la plantilla COMPLETA. Se devuelven para el log del worker; no se le muestran al usuario ni
 * viajan a la base.
 */
export type MotivoDeNoPublicable =
  /** Un paso teclea un LITERAL y su clase no permite convertirlo en ranura. */
  | 'literal_sin_marcador'
  /** Un paso DEPENDIA del `xpath` para encontrarse: la ruta del DOM de UNA sesion. */
  | 'localizador_de_sesion'
  /** Un paso DEPENDIA de un atributo que no es aria-label ni data-* (o sea: de un id o un name). */
  | 'atributo_no_estructural'
  /** Un paso que actua sobre un elemento no declara clase: no hay identidad que comparar. */
  | 'sin_identidad_estructural'
  /** La clase de un paso no esta corroborada en el dominio por origenes independientes. */
  | 'clase_no_corroborada'
  /** Un paso lleva una RUTA (o es una navegacion que no sea el punto de entrada del sitio). */
  | 'ruta_con_identificador'
  /** Una ranura ya armada nombra una clase que no mapea a ningun marcador. */
  | 'ranura_sin_marcador';

export interface PlantillaPublicable {
  publicable: true;
  pasos: PasoPublicable[];
}

export interface PlantillaNoPublicable {
  publicable: false;
  motivo: MotivoDeNoPublicable;
  /** `idx` del paso que la rechazo, o -1 cuando el rechazo es de la plantilla en su conjunto. */
  idx: number;
}

export type ResultadoDePublicable = PlantillaPublicable | PlantillaNoPublicable;

/**
 * UN paso tal como llega a `esPublicable`. Deliberadamente laxo para aceptar LAS DOS entradas con las
 * que la funcion corre, que es lo que le permite ser LA MISMA puerta en los dos lados:
 *  - en el WORKER, un `PasoDeReceta` recien promovido y anotado con su clase: puede traer `navegar`,
 *    `xpath`, `ruta` y valores `literal`, y es precisamente eso lo que hay que filtrar;
 *  - en el BACKEND, un `PasoPublicable` ya parseado: no puede traer nada de eso, y volver a pasarlo
 *    por la misma funcion es lo que convierte el segundo control en un control de verdad y no en un
 *    comentario.
 */
export interface PasoParaPublicar {
  idx: number;
  accion: AccionDeReceta;
  dominio?: string | null;
  claseDeElemento?: string | null;
  estrategias: readonly EstrategiaLocalizacion[];
  valor: ValorDePaso | ValorPublicable | null;
  teclas: string | null;
  ruta?: string | null;
  esperaMs: number | null;
}

/** Rechazo de un paso concreto. */
function rechazar(motivo: MotivoDeNoPublicable, idx: number): PlantillaNoPublicable {
  return { publicable: false, motivo, idx };
}

/**
 * LA REGLA DE PUBLICACION, completa y en un solo lugar. FALLA CERRADA: rechaza la plantilla ENTERA
 * ante cualquiera de los siete motivos, y NUNCA se salta el paso raro para publicar el resto. Una
 * plantilla a la que le falta un paso hace una tarea DISTINTA de la que alguien corroboro, y esa
 * tarea la va a correr el navegador de un tercero.
 *
 * `clasesCorroboradas` son las clases que el dominio tiene avaladas por ORIGENES INDEPENDIENTES (no
 * las servibles al propio origen). El umbral mas duro es deliberado: la clase de un elemento acaba
 * ESCRITA dentro de la plantilla, en el nombre de sus ranuras, asi que publicarla con un solo origen
 * seria revelar en una tabla global un nombre accesible con un aval MENOR del que el propio atlas
 * exige para servirlo.
 *
 * CORRE DOS VECES, cinturon y tirantes: en el worker antes de mandar la plantilla al backend, y en el
 * repositorio del backend antes del insert.
 *
 * EL UNICO PASO QUE SE DESCARTA en vez de rechazar es la navegacion INICIAL al punto de entrada del
 * sitio (`navegar` con ruta '/' en la primera posicion). No es "saltarse el paso raro": la raiz del
 * dominio es donde cualquier consumidor arranca por su cuenta, asi que quitarla no cambia en nada el
 * procedimiento, y sin esta excepcion casi toda corrida del motor libre quedaria sin publicar por su
 * primer paso. Una navegacion en CUALQUIER otra posicion (o con cualquier otra ruta) SI rechaza: ahi
 * el cambio de pagina es parte del procedimiento y una plantilla no tiene forma de representarlo.
 */
export function esPublicable(
  pasos: readonly PasoParaPublicar[],
  dominio: string,
  clasesCorroboradas: ReadonlySet<string>,
): ResultadoDePublicable {
  const base = dominio.trim().toLowerCase();
  // Sin un dominio base valido no hay a que atribuir los pasos que no declaran uno propio.
  if (!esDominioDePaso(base)) return rechazar('sin_identidad_estructural', -1);

  const publicables: PasoPublicable[] = [];
  for (let posicion = 0; posicion < pasos.length; posicion++) {
    const paso = pasos[posicion];
    if (paso === undefined) return rechazar('sin_identidad_estructural', -1);
    const ruta = paso.ruta ?? null;

    // 6. RUTAS. Primero la navegacion, porque es la unica accion que existe para llevar una.
    if (paso.accion === 'navegar') {
      if (posicion === 0 && ruta === '/') continue;
      return rechazar('ruta_con_identificador', paso.idx);
    }
    // Un paso que no navega y trae ruta afirma algo que su accion no puede llevar.
    if (ruta !== null) return rechazar('ruta_con_identificador', paso.idx);

    const accion = paso.accion as AccionPublicable;
    if (!ACCIONES_PUBLICABLES.includes(accion)) {
      // Ninguna accion del contrato de recetas cae aqui (navegar ya se trato arriba); es la red ante
      // un paso con una accion que este contrato no conoce.
      return rechazar('sin_identidad_estructural', paso.idx);
    }

    // 2 y 3. LOCALIZADORES. Se PARTEN en estructurales y no estructurales. Los no estructurales
    // (xpath, id, name, cualquier otro atributo) NO SE PUBLICAN NUNCA -- ni siquiera cuando el paso
    // tiene otros que si sirven -- y si un paso con elemento se queda SIN ninguno estructural, la
    // plantilla se rechaza nombrando de que dependia.
    //
    // POR QUE SE DESCARTAN Y NO RECHAZAN POR SU SOLA PRESENCIA, que es lo que un primer diseno pedia:
    // la lectura del DOM que alimenta toda receta AGREGA SIEMPRE un xpath (ATRIBUTOS_A_LEER y el
    // `estrategias.push({ tipo: 'xpath', ... })` final de apps/worker/src/localizacion.ts) y lee
    // ademas `id` y `name`, igual que `derivarEstrategiasDeSelector`. Con la regla estricta, TODO paso
    // de TODA receta traeria un xpath y no se publicaria JAMAS una sola plantilla: la puerta no seria
    // conservadora, seria un tapon.
    //
    // Descartar una ESTRATEGIA no es descartar un PASO, y la diferencia es exactamente la que hace que
    // esto siga siendo fail-closed: el paso se publica con su misma accion, su misma clase y su mismo
    // valor, asi que el procedimiento es identico; lo unico que se queda fuera es la forma de
    // localizar que no describe el sitio para nadie mas. Es el MISMO criterio, palabra por palabra,
    // con el que `estrategiasParaElAtlas` (V040) filtra lo que entra a la otra tabla global.
    const estrategias: EstrategiaPublicable[] = [];
    let teniaXpath = false;
    let teniaAtributoNoEstructural = false;
    for (const estrategia of paso.estrategias) {
      if (estrategia.tipo === 'xpath') {
        teniaXpath = true;
        continue;
      }
      if (estrategia.tipo === 'atributo' && !esAtributoPublicable(estrategia.atributo)) {
        teniaAtributoNoEstructural = true;
        continue;
      }
      // Se DESCARTA igual que el xpath, y por el mismo motivo con el que el atlas la descarta de su
      // tabla: un nombre o un valor con un dato dentro no describe el sitio para nadie mas. Descartar
      // la ESTRATEGIA no descarta el PASO; si al paso no le queda ninguna, mas abajo se rechaza.
      const publicable = parsearEstrategiaPublicable(estrategia);
      if (publicable === null) {
        teniaAtributoNoEstructural = teniaAtributoNoEstructural || estrategia.tipo === 'atributo';
        continue;
      }
      estrategias.push(publicable);
    }

    // 4 y 5. IDENTIDAD ESTRUCTURAL, solo exigible donde hay elemento (ver PasoPublicable).
    const clasePropia = paso.claseDeElemento ?? null;
    let claseDeElemento: string | null = null;
    if (actuaSobreElemento(accion)) {
      if (clasePropia === null || nombreDeLaClase(clasePropia) === null) {
        return rechazar('sin_identidad_estructural', paso.idx);
      }
      if (!clasesCorroboradas.has(clasePropia)) {
        return rechazar('clase_no_corroborada', paso.idx);
      }
      // El paso se quedo sin NINGUNA forma estructural de encontrarse: su localizacion DEPENDIA de lo
      // que no se puede publicar. Se rechaza nombrando de que dependia, que es lo que hace falta para
      // diagnosticarlo (un paso solo-xpath es el caso que el repo ya sigue como `pasosSoloXpath`).
      if (estrategias.length === 0) {
        if (teniaXpath) return rechazar('localizador_de_sesion', paso.idx);
        if (teniaAtributoNoEstructural) return rechazar('atributo_no_estructural', paso.idx);
        return rechazar('sin_identidad_estructural', paso.idx);
      }
      claseDeElemento = clasePropia;
    }

    // 1 y 7. EL VALOR. Un literal se convierte en ranura o rechaza; una ranura ya armada tiene que
    // mapear a un marcador. Ningun camino deja pasar un valor de usuario.
    let valor: ValorPublicable | null = null;
    const valorPropio = paso.valor;
    if (valorPropio !== null && accion === 'escribir') {
      if (valorPropio.tipo === 'parametro') {
        valor = { tipo: 'parametro', parametro: valorPropio.parametro };
      } else if (valorPropio.tipo === 'ranura') {
        if (marcadorDeRanura(valorPropio.clase) === null) {
          return rechazar('ranura_sin_marcador', paso.idx);
        }
        valor = { tipo: 'ranura', clase: valorPropio.clase };
      } else {
        // LITERAL. Se publica como RANURA nombrada por la clase del campo, jamas por el valor, y solo
        // si esa clase mapea a un marcador que el consumidor sepa llenar.
        if (claseDeElemento === null || marcadorDeRanura(claseDeElemento) === null) {
          return rechazar('literal_sin_marcador', paso.idx);
        }
        valor = { tipo: 'ranura', clase: claseDeElemento };
      }
    }
    // Un paso de escritura sin valor no es re-ejecutable: no dice que teclear.
    if (accion === 'escribir' && valor === null) return rechazar('literal_sin_marcador', paso.idx);

    publicables.push({
      // La posicion se RENUMERA desde 0 y sin huecos: la navegacion inicial descartada no puede
      // dejar un hueco que despues invalide el parseo de la propia plantilla.
      idx: publicables.length,
      accion,
      dominio: (paso.dominio ?? base).trim().toLowerCase(),
      claseDeElemento,
      // Un paso que no actua sobre un elemento se publica SIN localizadores, aunque la receta le
      // hubiera heredado los de la escritura anterior: el ejecutor pulsa sobre el foco, asi que son
      // datos que no hacen falta, y lo que no hace falta no se comparte.
      estrategias: actuaSobreElemento(accion) ? estrategias : [],
      valor,
      teclas: accion === 'teclas' ? paso.teclas : null,
      esperaMs: accion === 'esperar' ? paso.esperaMs : null,
    });
  }

  // Una plantilla vacia no tiene ninguna identidad estructural que publicar.
  if (publicables.length === 0) return rechazar('sin_identidad_estructural', -1);
  // Se cierra el circulo: lo que sale de aqui tiene que sobrevivir al parser que lo va a leer de la
  // base. Si no, no se publica (y es un bug de esta funcion, no un dato raro de entrada).
  if (parsearPasosPublicables(publicables) === null) {
    return rechazar('sin_identidad_estructural', -1);
  }
  return { publicable: true, pasos: publicables };
}
