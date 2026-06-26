import { extractText } from 'unpdf';
import * as XLSX from 'xlsx';
import mammoth from 'mammoth';
import { AGENT_LIMITS } from '../agent/limits.js';

/**
 * Extraccion de texto de documentos adjuntos por referencia (URL).
 *
 * El agente recibe documentos por URL; este modulo los descarga y extrae su TEXTO segun tipo
 * para inyectarlo al modelo (las imagenes NO pasan por aqui: van como ImageBlock a la vision
 * nativa del proveedor). Librerias 100% JS, sin binarios nativos:
 *  - PDF   -> unpdf (build serverless de pdf.js; mantenido, sin nativos).
 *  - Excel -> SheetJS (xlsx): cada hoja serializada a CSV legible.
 *  - Word  -> mammoth: texto plano.
 *
 * Nota de alcance (PR1): la confianza/SSRF de las URLs y el storage propio son responsabilidad de
 * PR2; aqui la descarga solo se acota con timeout y tamano maximo.
 */

export type DocumentKind = 'pdf' | 'excel' | 'word';

export interface DocumentAttachment {
  kind: DocumentKind;
  url: string;
  mimeType: string;
  name: string;
}

/**
 * Error controlado de extraccion. El endpoint lo captura y degrada el adjunto a una nota de texto:
 * un documento corrupto o no soportado NUNCA tumba el run completo.
 */
export class AttachmentExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AttachmentExtractionError';
  }
}

const TRUNCATION_NOTICE = '\n\n[contenido truncado]';

/** Cota de bytes a descargar por adjunto (defensa anti-payload abusivo). */
const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;
/** Timeout de descarga por adjunto. */
const FETCH_TIMEOUT_MS = 15_000;

export interface ExtractOptions {
  /** Maximo de caracteres del texto devuelto; si excede, trunca con marca. */
  maxChars?: number;
  /** Inyectable para tests (por defecto el fetch global). */
  fetchImpl?: typeof fetch;
}

/**
 * Trunca el texto a maxChars dejando la marca de truncado cuando se recorta.
 * Garantia dura: el resultado NUNCA excede maxChars (ni siquiera cuando maxChars es menor que la
 * marca, o <= 0). Esto sostiene el presupuesto de caracteres del endpoint.
 */
export function truncateText(text: string, maxChars: number): string {
  if (maxChars <= 0) return '';
  if (text.length <= maxChars) return text;
  // Sin espacio para la marca completa: recorte duro al limite.
  if (maxChars <= TRUNCATION_NOTICE.length) return text.slice(0, maxChars);
  return text.slice(0, maxChars - TRUNCATION_NOTICE.length) + TRUNCATION_NOTICE;
}

/**
 * Lee el cuerpo de la respuesta acotando el tamano. En produccion (fetch real) consume el stream
 * con corte temprano para no bufferizar respuestas gigantes cuando el content-length esta ausente
 * o miente. Si no hay stream (fakes de test), cae a arrayBuffer() y acota por tamano final.
 */
async function readBodyBounded(res: Response): Promise<Buffer> {
  const body = res.body as ReadableStream<Uint8Array> | null | undefined;
  if (!body || typeof body.getReader !== 'function') {
    const arrayBuffer = await res.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_DOWNLOAD_BYTES) {
      throw new AttachmentExtractionError('el adjunto excede el tamano maximo permitido');
    }
    return Buffer.from(arrayBuffer);
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > MAX_DOWNLOAD_BYTES) {
      await reader.cancel();
      throw new AttachmentExtractionError('el adjunto excede el tamano maximo permitido');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

async function downloadDocument(url: string, fetchImpl: typeof fetch): Promise<Buffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, { signal: controller.signal });
    if (!res.ok) {
      throw new AttachmentExtractionError(`no se pudo descargar el adjunto (HTTP ${res.status})`);
    }
    // Rechazo temprano si el content-length declarado ya supera el limite (cuando esta presente).
    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_DOWNLOAD_BYTES) {
      throw new AttachmentExtractionError('el adjunto excede el tamano maximo permitido');
    }
    return await readBodyBounded(res);
  } catch (error) {
    if (error instanceof AttachmentExtractionError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new AttachmentExtractionError('la descarga del adjunto excedio el tiempo limite');
    }
    throw new AttachmentExtractionError(
      `fallo la descarga del adjunto: ${error instanceof Error ? error.message : 'error desconocido'}`,
    );
  } finally {
    clearTimeout(timer);
  }
}

async function extractPdf(buffer: Buffer): Promise<string> {
  try {
    const { text } = await extractText(new Uint8Array(buffer), { mergePages: true });
    return text;
  } catch (error) {
    throw new AttachmentExtractionError(
      `no se pudo leer el PDF (posible archivo corrupto): ${error instanceof Error ? error.message : 'error desconocido'}`,
    );
  }
}

function extractExcel(buffer: Buffer): string {
  try {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const parts: string[] = [];
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) continue;
      const csv = XLSX.utils.sheet_to_csv(sheet);
      parts.push(`# Hoja: ${sheetName}\n${csv}`);
    }
    return parts.join('\n\n');
  } catch (error) {
    throw new AttachmentExtractionError(
      `no se pudo leer el Excel (posible archivo corrupto): ${error instanceof Error ? error.message : 'error desconocido'}`,
    );
  }
}

async function extractWord(buffer: Buffer): Promise<string> {
  try {
    const { value } = await mammoth.extractRawText({ buffer });
    return value;
  } catch (error) {
    throw new AttachmentExtractionError(
      `no se pudo leer el Word (posible archivo corrupto): ${error instanceof Error ? error.message : 'error desconocido'}`,
    );
  }
}

/**
 * Descarga el documento y extrae su texto segun el tipo. Devuelve el texto (recortado a maxChars
 * con marca de truncado si excede). Lanza AttachmentExtractionError con mensaje claro ante un tipo
 * no soportado, descarga fallida o archivo corrupto; nunca crashea de forma no controlada.
 */
export async function extractDocumentText(
  attachment: DocumentAttachment,
  options: ExtractOptions = {},
): Promise<string> {
  const maxChars = options.maxChars ?? AGENT_LIMITS.maxTotalContentChars;
  const fetchImpl = options.fetchImpl ?? fetch;

  const buffer = await downloadDocument(attachment.url, fetchImpl);

  let text: string;
  switch (attachment.kind) {
    case 'pdf':
      text = await extractPdf(buffer);
      break;
    case 'excel':
      text = extractExcel(buffer);
      break;
    case 'word':
      text = await extractWord(buffer);
      break;
    default:
      throw new AttachmentExtractionError(
        `tipo de adjunto no soportado: ${String((attachment as { kind?: unknown }).kind)}`,
      );
  }

  return truncateText(text.trim(), maxChars);
}
