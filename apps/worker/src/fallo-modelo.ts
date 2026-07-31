import { PermanentExecutionError } from './errores.js';

/**
 * FALLO DE ACCESO AL MODELO: la llave del proveedor no tiene saldo, no es valida o no tiene permiso.
 *
 * POR QUE EXISTE (evidencia de produccion, 31 jul 2026). Un fallo de credito agotado
 * ("Your credit balance is too low to access the Anthropic API") es PERMANENTE por naturaleza:
 * reintentarlo no puede tener otro desenlace, y cada reintento cuesta una sesion de navegador con su
 * proxy mas los minutos de reloj del backoff. handleFailure (execution.ts) trataba ese fallo como uno
 * transitorio cualquiera porque, al llegar a el, el error ya no conserva ni el codigo HTTP ni el tipo
 * del proveedor.
 *
 * CONSERVADOR A PROPOSITO. Solo se clasifica lo que se puede afirmar con certeza. Un 429 de LIMITE DE
 * TASA, un 5xx, un timeout o un corte de red siguen siendo transitorios y se reintentan como hoy: un
 * falso positivo que corte una corrida recuperable es peor que un reintento de mas. Del 429 solo se
 * clasifica el de CUOTA AGOTADA (insufficient_quota / billing), que es el que jamas se resuelve solo.
 */

/**
 * Que fallo exactamente. Las dos clases comparten el mismo mensaje para el usuario (la accion es la
 * misma: revisar la cuenta del proveedor); se distinguen para el diagnostico interno.
 */
export type ClaseDeFalloDeModelo =
  /** Saldo/creditos agotados o cuota consumida en el proveedor. */
  | 'saldo'
  /** Llave invalida, revocada o sin permiso para el modelo pedido. */
  | 'credenciales';

/**
 * Nombre-prefijo ESTABLE del cierre por falta de acceso al modelo. Mismo mecanismo que
 * PREFIJO_ACCION_SIN_EFECTO_CONFIRMADO (errores.ts): describeError arma el last_error como
 * `${name}: ${message}`, asi que usar este texto como `name` deja el last_error empezando
 * EXACTAMENTE con `MODELO_SIN_ACCESO:`, que es el prefijo con el que la consola muestra el mensaje
 * traducido en vez del fallo generico. Espeja MODELO_SIN_ACCESO_PREFIX de shared: nunca cambiar uno
 * sin el otro.
 */
export const PREFIJO_MODELO_SIN_ACCESO = 'MODELO_SIN_ACCESO';

/**
 * MARCA que viaja DENTRO del texto del mensaje. Existe porque el motor de navegacion NO propaga el
 * error crudo: `agent.execute` de Stagehand atrapa todo fallo que no sea un abort y devuelve un
 * resultado sin exito cuyo unico rastro es un string (`Failed to execute task: ...`, v3AgentHandler).
 * Por ese canal no sobreviven ni el status HTTP ni el tipo del proveedor, asi que el middleware de
 * modelo (normalizador-elementid.ts / stagehand.ts) planta esta marca en el mensaje al detectar el
 * fallo, y es lo UNICO que se acepta como evidencia cuando lo que se clasifica es un texto suelto.
 */
export const MARCA_MODELO_SIN_ACCESO = '[MODELO_SIN_ACCESO]';

/** La marca con su clase, tal como la planta el middleware: `[MODELO_SIN_ACCESO:saldo]`. */
export function marcaDeFalloDeModelo(clase: ClaseDeFalloDeModelo): string {
  return `[${PREFIJO_MODELO_SIN_ACCESO}:${clase}]`;
}

/** Diagnostico interno (sin i18n): el texto que queda en el last_error y en los logs del worker. */
export function describirFalloDeModelo(clase: ClaseDeFalloDeModelo): string {
  return clase === 'saldo'
    ? 'la llave del modelo no tiene saldo o agoto su cuota en el proveedor; la corrida se corto en el ' +
        'acto y NO se reintenta: ningun reintento puede cambiar el resultado'
    : 'la llave del modelo no es valida o no tiene permiso para este modelo; la corrida se corto en el ' +
        'acto y NO se reintenta: ningun reintento puede cambiar el resultado';
}

/**
 * Fallo PERMANENTE por falta de acceso al modelo. Subclase de PermanentExecutionError para que
 * execution.ts lo cierre igual (markFailed directo, sin reencolar); lo unico que cambia es el
 * prefijo estable del last_error.
 */
export class FalloDeAccesoAlModeloError extends PermanentExecutionError {
  readonly clase: ClaseDeFalloDeModelo;

  constructor(clase: ClaseDeFalloDeModelo, detalle?: string) {
    super(
      detalle === undefined
        ? describirFalloDeModelo(clase)
        : `${describirFalloDeModelo(clase)} (detalle: ${detalle})`,
    );
    this.name = PREFIJO_MODELO_SIN_ACCESO;
    this.clase = clase;
  }
}

/** Profundidad maxima de la cadena de `cause` que se recorre (no recorrer una cadena circular). */
const MAX_PROFUNDIDAD = 3;

/**
 * Marcas de texto de SALDO/CUOTA agotados. Frases literales de los proveedores, deliberadamente
 * especificas: nada generico como "quota" o "billing" a secas, que aparecen en errores recuperables.
 */
const MARCAS_DE_SALDO = [
  'credit balance is too low',
  'insufficient credits',
  'insufficient_quota',
  'exceeded your current quota',
  'billing hard limit',
  'payment required',
];

/** Marcas de texto de CREDENCIAL invalida o sin permiso. Mismo criterio de especificidad. */
const MARCAS_DE_CREDENCIALES = [
  'invalid x-api-key',
  'invalid api key',
  'incorrect api key',
  'authentication_error',
  'permission_error',
  'could not resolve authentication method',
];

/** Lee una propiedad string de un objeto (vacia si no es string). */
function textoDe(valor: unknown, clave: string): string {
  if (typeof valor !== 'object' || valor === null) return '';
  const contenido = (valor as Record<string, unknown>)[clave];
  return typeof contenido === 'string' ? contenido : '';
}

/** Lee una propiedad numerica de un objeto (undefined si no es numero finito). */
function numeroDe(valor: unknown, clave: string): number | undefined {
  if (typeof valor !== 'object' || valor === null) return undefined;
  const contenido = (valor as Record<string, unknown>)[clave];
  return typeof contenido === 'number' && Number.isFinite(contenido) ? contenido : undefined;
}

/** Clasifica por el TEXTO (mensaje del proveedor, cuerpo de la respuesta, tipo de error). */
function clasificarTexto(texto: string): ClaseDeFalloDeModelo | null {
  const minusculas = texto.toLowerCase();
  if (MARCAS_DE_SALDO.some((marca) => minusculas.includes(marca))) return 'saldo';
  if (MARCAS_DE_CREDENCIALES.some((marca) => minusculas.includes(marca))) return 'credenciales';
  return null;
}

/**
 * Clasifica por el CODIGO DE ESTADO HTTP, y SOLO los que no admiten otra lectura:
 *  - 401 / 403: la llave no vale o no tiene permiso. No se arregla reintentando.
 *  - 402: pago requerido.
 * 400 NO entra: un 400 puede ser una peticion mal formada (recuperable al siguiente paso), y el 400
 * de credito agotado de Anthropic se reconoce por su texto, no por su status. 429 y 5xx tampoco: son
 * el limite de tasa y la indisponibilidad temporal, que es justo lo que SI se resuelve reintentando.
 */
function clasificarStatus(status: number | undefined): ClaseDeFalloDeModelo | null {
  if (status === 401 || status === 403) return 'credenciales';
  if (status === 402) return 'saldo';
  return null;
}

/**
 * La MARCA plantada por el middleware dentro de un texto, con su clase. null si no esta. Es lo unico
 * que se acepta cuando lo que se clasifica es un string suelto (el mensaje final del motor puede
 * arrastrar contenido de la pagina, y una pagina cualquiera no debe poder cortar una corrida).
 */
export function claseDeLaMarca(texto: string): ClaseDeFalloDeModelo | null {
  if (texto.includes(marcaDeFalloDeModelo('saldo'))) return 'saldo';
  if (texto.includes(marcaDeFalloDeModelo('credenciales'))) return 'credenciales';
  return null;
}

/**
 * CLASIFICADOR. Devuelve la clase del fallo cuando se puede afirmar con CERTEZA que ningun reintento
 * lo resolveria, y null en cualquier otro caso (ahi el comportamiento no cambia: sigue siendo un
 * fallo transitorio y se reintenta como hoy).
 *
 * Fuentes, de la mas estructurada a la mas debil, recorriendo tambien la cadena de `cause` (el AI SDK
 * y los SDK de proveedor envuelven el error original):
 *  1. La MARCA del middleware (`[MODELO_SIN_ACCESO:clase]`), que es la unica evidencia que sobrevive
 *     al canal de solo-texto del motor de navegacion.
 *  2. El codigo de estado HTTP: `status` (SDK de Anthropic/OpenAI y ProviderError del backend) o
 *     `statusCode` (APICallError del AI SDK).
 *  3. El tipo/codigo del proveedor (`type`, `code`) y el cuerpo de la respuesta (`responseBody`).
 *  4. El mensaje.
 *
 * Un STRING se clasifica SOLO por la marca (ver claseDeLaMarca).
 */
export function clasificarFalloDeAccesoAlModelo(
  error: unknown,
  profundidad = 0,
): ClaseDeFalloDeModelo | null {
  if (typeof error === 'string') return claseDeLaMarca(error);
  if (typeof error !== 'object' || error === null || profundidad > MAX_PROFUNDIDAD) return null;

  const mensaje = textoDe(error, 'message');
  const porMarca = claseDeLaMarca(mensaje);
  if (porMarca !== null) return porMarca;

  const porStatus = clasificarStatus(numeroDe(error, 'status') ?? numeroDe(error, 'statusCode'));
  if (porStatus !== null) return porStatus;

  // `error` anidado: los SDK de proveedor devuelven `{ error: { type, message } }` en el cuerpo.
  const anidado = (error as { error?: unknown }).error;
  const partes = [
    textoDe(error, 'type'),
    textoDe(error, 'code'),
    textoDe(error, 'responseBody'),
    textoDe(anidado, 'type'),
    textoDe(anidado, 'code'),
    textoDe(anidado, 'message'),
    mensaje,
  ];
  const porTexto = clasificarTexto(partes.join(' '));
  if (porTexto !== null) return porTexto;

  return clasificarFalloDeAccesoAlModelo(
    (error as { cause?: unknown }).cause,
    profundidad + 1,
  );
}
