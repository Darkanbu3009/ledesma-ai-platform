/**
 * LOGICA PURA del dictado por voz: deteccion de soporte, formato de captura e insercion del texto.
 * La llamada de red al backend vive en voz-transcribir.ts, separada A PROPOSITO para que los tests
 * DOM puedan mockear solo la transcripcion sin arrastrar lib/api ni supabase al arbol de imports
 * (mismo criterio que el relay de teclado).
 */

/** Idioma del hint de transcripcion: los dos idiomas de la consola. */
export type IdiomaDictado = 'es' | 'en';

/** Limite de grabacion por dictado. Al llegar, se corta solo y se transcribe lo grabado. */
export const MAX_SEGUNDOS_DICTADO = 60;

/**
 * Formato de captura preferido: opus en webm donde este soportado (Chrome, Firefox, Edge) y
 * audio/mp4 como caida para Safari, que no graba webm. Null cuando MediaRecorder no existe o no
 * soporta ninguno de los dos: en ese caso el boton de dictado no se muestra.
 */
export function mimeDictado(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) return 'audio/webm;codecs=opus';
  if (MediaRecorder.isTypeSupported('audio/mp4')) return 'audio/mp4';
  return null;
}

/** Si el navegador puede dictar: microfono accesible y un formato de grabacion soportado. */
export function soportaDictado(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    navigator.mediaDevices?.getUserMedia !== undefined &&
    mimeDictado() !== null
  );
}

/** Nombre del archivo segun el mime: la API de OpenAI detecta el formato por la extension. */
export function nombreArchivoDictado(mime: string): string {
  return mime.startsWith('audio/mp4') ? 'dictado.mp4' : 'dictado.webm';
}

/**
 * Inserta el texto transcrito CONCATENANDO a lo que ya haya en el input. Nunca reemplaza: el
 * usuario puede dictar en tandas y revisar el total antes de enviar.
 */
export function concatenarDictado(previo: string, texto: string): string {
  const limpio = texto.trim();
  if (limpio === '') return previo;
  if (previo === '') return limpio;
  return previo.endsWith(' ') || previo.endsWith('\n') ? `${previo}${limpio}` : `${previo} ${limpio}`;
}
