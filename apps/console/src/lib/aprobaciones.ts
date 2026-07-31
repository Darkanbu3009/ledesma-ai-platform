/**
 * Tipos y logica PURA de los CHECKPOINTS DE APROBACION HUMANA (7.1e) en la consola. Espeja el DTO
 * camelCase de GET /v1/aprobaciones (apps/backend/src/routes/aprobaciones.ts). Sin React: igual que
 * jobs.ts / sitios.ts, lo consultable se testea como funciones puras y los hooks solo consumen.
 *
 * Cuando una tarea web llega a una accion irreversible o financiera, el worker la PAUSA y crea una
 * aprobacion 'pendiente'; aqui el usuario ve exactamente que va a pasar (screenshot + descripcion en
 * una linea) y decide. La accion NO se ejecuta hasta que la aprobacion quede 'aprobada'.
 */

export type AprobacionEstado = 'pendiente' | 'aprobada' | 'rechazada' | 'expirada';
export type AccionTipo = 'irreversible' | 'financiera';

export interface AprobacionWeb {
  id: string;
  jobId: string;
  connectionId: string;
  accionTipo: AccionTipo;
  descripcion: string;
  /** Path del screenshot en el bucket privado 'aprobaciones-web'. null = no se pudo capturar. */
  screenshotPath: string | null;
  estado: AprobacionEstado;
  instruccionRechazo: string | null;
  decididaEn: string | null;
  creadaEn: string;
  expiraEn: string;
}

/**
 * OFRECIMIENTO DE UN PROCEDIMIENTO COMPARTIDO (V041, consumo): el MOTIVO NUEVO de un checkpoint. Su
 * `descripcion` no es una frase sino un CODIGO CERRADO que la plataforma genero
 * (`plantilla_compartida:<intencion>:<marcadores>:<dominio>`, ver
 * apps/worker/src/plantillas-compartidas.ts). La frase la redacta ESTA capa, en el idioma del usuario,
 * desde ese codigo.
 *
 * POR QUE UN CODIGO Y NO UNA FRASE: el procedimiento lo descubrio OTRA cuenta y vive en una tabla
 * global. Que el texto del checkpoint se derive de un vocabulario cerrado de la plataforma -- ocho
 * intenciones, seis datos y un dominio que el propio usuario conecto -- es lo que garantiza que por
 * aqui no pueda pasar ni un caracter de esa tabla.
 */
export const INTENCIONES = [
  'enviar',
  'publicar',
  'borrar',
  'pagar',
  'transferir',
  'comprar',
  'firmar',
  'cancelarSuscripcion',
] as const;

export const DATOS = [
  'destinatario',
  'monto',
  'producto',
  'cantidad',
  'asunto',
  'cuerpo',
] as const;

export type IntencionDePlantilla = (typeof INTENCIONES)[number];
export type DatoDePlantilla = (typeof DATOS)[number];

export interface OfrecimientoDePlantilla {
  intencion: IntencionDePlantilla;
  datos: DatoDePlantilla[];
  dominio: string;
}

/** Prefijo del motivo. Espeja MOTIVO_PLANTILLA_COMPARTIDA del worker. */
const MOTIVO_PLANTILLA = 'plantilla_compartida';

/**
 * LEE la descripcion de una aprobacion y dice si es un ofrecimiento de procedimiento compartido.
 * Devuelve null ante cualquier otra cosa -- incluido un codigo a medias o con un valor que no este en
 * las dos listas cerradas -- y con eso el modal muestra la descripcion tal cual, como siempre.
 */
export function parsearOfrecimiento(descripcion: string): OfrecimientoDePlantilla | null {
  const partes = descripcion.split(':');
  if (partes.length !== 4 || partes[0] !== MOTIVO_PLANTILLA) return null;
  const intencion = INTENCIONES.find((valor) => valor === partes[1]);
  if (intencion === undefined) return null;
  const crudos = (partes[2] ?? '').split('+').filter((dato) => dato !== '');
  const datos: DatoDePlantilla[] = [];
  for (const crudo of crudos) {
    const dato = DATOS.find((valor) => valor === crudo);
    if (dato === undefined) return null;
    datos.push(dato);
  }
  const dominio = (partes[3] ?? '').trim();
  if (dominio === '') return null;
  return { intencion, datos, dominio };
}

/**
 * Intervalo del polling de aprobaciones pendientes (ms). Corre siempre que la consola esta visible
 * (mismo patron refetchInterval de V017, sin useEffect): una aprobacion expira en minutos y puede
 * aparecer en cualquier momento; la consulta es un select indexado y barato.
 */
export const APROBACIONES_REFETCH_MS = 10_000;

/** TTL de la signed URL del screenshot (s). Corta: la evidencia se mira al decidir, no se comparte. */
const SCREENSHOT_URL_TTL = 300;

/** Tope del campo de instruccion al rechazar (espejo del backend). */
export const MAX_INSTRUCCION_CHARS = 2_000;

/**
 * Crea una signed URL de vida corta para el screenshot del checkpoint, con la SESION DEL USUARIO
 * (la RLS del bucket solo deja leer la carpeta propia). null si no hay screenshot o si la firma
 * fallo: el modal muestra la descripcion igual (la decision nunca depende de la imagen).
 */
export async function obtenerScreenshotUrl(path: string | null): Promise<string | null> {
  if (path === null) return null;
  // Import dinamico a proposito: este modulo lo importan queries.ts/mutations.ts, y cargar el
  // cliente de Supabase al evaluar el modulo exigiria su env en todo consumidor (tests incluidos);
  // la firma solo se necesita cuando de verdad hay un screenshot que mostrar.
  const { supabase } = await import('./supabase');
  const { data, error } = await supabase.storage
    .from('aprobaciones-web')
    .createSignedUrl(path, SCREENSHOT_URL_TTL);
  if (error || !data) return null;
  return data.signedUrl;
}
