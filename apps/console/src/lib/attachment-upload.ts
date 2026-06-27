import { subirAdjunto, type AttachmentRef } from './attachments';

/**
 * Maximo de adjuntos por turno. Coincide con el limite del backend
 * (AGENT_LIMITS.maxAttachments = 5): no tiene sentido dejar adjuntar mas de lo que aceptara.
 */
export const MAX_ADJUNTOS = 5;

/** Texto por defecto cuando se envian adjuntos sin escribir nada: el modelo necesita una instruccion. */
export const TEXTO_SOLO_ADJUNTOS = 'Analiza los archivos adjuntos.';

export interface SubirArchivosDeps {
  /** Funcion de subida; por defecto `subirAdjunto`. Se inyecta en los tests. */
  subir?: (file: File) => Promise<AttachmentRef>;
  /** Se invoca por cada archivo subido con exito, con su referencia lista para el envio. */
  onSubido: (ref: AttachmentRef) => void;
  /** Se invoca con un mensaje claro cuando un archivo falla o cuando se excede el maximo. */
  onError: (mensaje: string) => void;
}

/**
 * Sube una lista de archivos respetando el maximo de adjuntos por turno.
 *
 * Por cada archivo que cabe: lo sube y, si va bien, lo entrega por `onSubido`. Si la subida
 * lanza, el adjunto NO se agrega y el motivo se entrega por `onError`. Si la seleccion excede los
 * cupos libres (MAX_ADJUNTOS - yaCargados), avisa por `onError` y sube solo los que caben.
 *
 * Es logica pura de orquestacion (sin React) para poder testearla sin un E2E del componente.
 */
export async function subirArchivos(
  files: File[],
  yaCargados: number,
  deps: SubirArchivosDeps,
): Promise<void> {
  const subir = deps.subir ?? subirAdjunto;
  const cupos = Math.max(0, MAX_ADJUNTOS - yaCargados);

  if (files.length > cupos) {
    deps.onError(`Solo puedes adjuntar hasta ${MAX_ADJUNTOS} archivos por mensaje`);
  }

  for (const file of files.slice(0, cupos)) {
    try {
      deps.onSubido(await subir(file));
    } catch (error) {
      deps.onError(error instanceof Error ? error.message : 'No se pudo subir el archivo');
    }
  }
}

export interface EstadoEnvio {
  draft: string;
  adjuntos: AttachmentRef[];
}

export interface PlanEnvio {
  /** Lo que se manda en el turno: texto (o el default si solo hay adjuntos) + sus adjuntos. */
  envio: { texto: string; attachments: AttachmentRef[] };
  /** Estado del input tras enviar: vacio. El componente lo aplica para limpiar draft y adjuntos. */
  siguiente: EstadoEnvio;
}

/**
 * Decide que enviar a partir del borrador y los adjuntos pendientes, y cual es el estado limpio
 * resultante. Devuelve null cuando no hay nada que enviar (sin texto y sin adjuntos).
 *
 * Reglas: solo-texto, texto + adjuntos, o adjuntos solos (con TEXTO_SOLO_ADJUNTOS por defecto).
 * El estado siguiente SIEMPRE queda vacio: por eso enviar limpia los adjuntos pendientes.
 */
export function planificarEnvio(estado: EstadoEnvio): PlanEnvio | null {
  const content = estado.draft.trim();
  if (content === '' && estado.adjuntos.length === 0) return null;
  return {
    envio: {
      texto: content !== '' ? content : TEXTO_SOLO_ADJUNTOS,
      attachments: estado.adjuntos,
    },
    siguiente: { draft: '', adjuntos: [] },
  };
}
