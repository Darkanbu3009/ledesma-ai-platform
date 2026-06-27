import { supabase } from './supabase';

/** Categoria del adjunto, derivada del mimeType. El backend (PR1) la espera tal cual. */
export type AttachmentKind = 'image' | 'pdf' | 'excel' | 'word';

/** Referencia que el backend espera en cada item de `attachments`. */
export interface AttachmentRef {
  kind: AttachmentKind;
  url: string;
  mimeType: string;
  name: string;
}

/** Bucket privado de Supabase Storage con RLS por usuario (primera carpeta = auth.uid()). */
const BUCKET = 'adjuntos-chat';

/** Limite de tamano por archivo: 10 MB. */
const LIMITE_BYTES = 10 * 1024 * 1024;

/** TTL de la signed url en segundos (10 min, suficiente para que el modelo la lea). */
const SIGNED_URL_TTL = 600;

/** Mapa de mimeType permitido -> kind. Tambien es la lista blanca de validacion. */
const TIPOS_PERMITIDOS: Record<string, AttachmentKind> = {
  'image/png': 'image',
  'image/jpeg': 'image',
  'image/webp': 'image',
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'excel',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'word',
};

/**
 * Sanitiza el nombre del archivo para que sea seguro dentro del path:
 * sin espacios, sin slashes y sin caracteres raros que rompan el path.
 * Lo no alfanumerico se reemplaza por guion y se conserva la extension.
 */
function sanitizarNombre(nombre: string): string {
  const punto = nombre.lastIndexOf('.');
  const tieneExt = punto > 0 && punto < nombre.length - 1;
  const base = tieneExt ? nombre.slice(0, punto) : nombre;
  const ext = tieneExt ? nombre.slice(punto + 1) : '';

  const limpiar = (valor: string): string =>
    valor
      .normalize('NFKD')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase();

  const baseSegura = limpiar(base) || 'archivo';
  const extSegura = limpiar(ext);
  return extSegura ? `${baseSegura}.${extSegura}` : baseSegura;
}

/**
 * Sube un archivo al bucket privado `adjuntos-chat` y devuelve la referencia
 * con la forma exacta que el backend espera en cada item de `attachments`.
 *
 * El path se construye como `${userId}/${uuid}-${nombreSeguro}`: el userId
 * (auth.uid() de la sesion) DEBE ser la primera carpeta o la RLS rechaza la subida.
 *
 * @throws Error con mensaje claro si el tipo no esta permitido, el archivo
 * supera 10 MB, no hay sesion activa, o falla la subida / la signed url.
 */
export async function subirAdjunto(file: File): Promise<AttachmentRef> {
  // 1. Validacion de tipo.
  const kind = TIPOS_PERMITIDOS[file.type];
  if (!kind) {
    throw new Error(
      `Tipo de archivo no permitido: ${file.type || 'desconocido'}. ` +
        'Solo se permiten imagenes (PNG, JPEG, WebP), PDF, Excel (.xlsx) o Word (.docx).',
    );
  }

  // 2. Validacion de tamano.
  if (file.size > LIMITE_BYTES) {
    throw new Error('El archivo supera el limite de 10 MB');
  }

  // 3. User id de la sesion actual (auth.uid()).
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user.id;
  if (!userId) {
    throw new Error('Debes iniciar sesion para adjuntar archivos');
  }

  // 4. Path: el userId DEBE ser la primera carpeta para que calce con la RLS.
  const path = `${userId}/${crypto.randomUUID()}-${sanitizarNombre(file.name)}`;

  // 5. Subida con el cliente autenticado. upsert: true lo cubre la RLS de UPDATE.
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { upsert: true, contentType: file.type });
  if (uploadError) {
    throw new Error(`No se pudo subir el archivo: ${uploadError.message}`);
  }

  // 6. Signed url con TTL corto para que el modelo pueda leer el archivo.
  const { data: signedData, error: signedError } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL);
  if (signedError || !signedData) {
    throw new Error(
      `No se pudo generar el enlace del archivo: ${signedError?.message ?? 'error desconocido'}`,
    );
  }

  // 7 y 8. Retorno con la forma exacta que espera el backend.
  return {
    kind,
    url: signedData.signedUrl,
    mimeType: file.type,
    name: file.name,
  };
}
