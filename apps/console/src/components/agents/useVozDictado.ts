import { useEffect, useRef, useState } from 'react';
import {
  MAX_SEGUNDOS_DICTADO,
  mimeDictado,
  soportaDictado,
  type IdiomaDictado,
} from '../../lib/voz';
import { transcribirDictado } from '../../lib/voz-transcribir';

export type FaseDictado = 'inactivo' | 'grabando' | 'transcribiendo';

export interface VozDictado {
  /** false: sin MediaRecorder utilizable o feature apagada (501). El boton no se muestra. */
  soportado: boolean;
  fase: FaseDictado;
  /** Segundos de grabacion transcurridos, para el contador visible. */
  segundos: number;
  /** Clave i18n del error visible, o null. El componente la traduce. */
  errorKey: string | null;
  /** Hay un audio fallido conservado y todavia queda el unico reintento permitido. */
  puedeReintentar: boolean;
  /** Inicia la grabacion o la detiene (y dispara la transcripcion), segun la fase. */
  alternar: () => void;
  reintentar: () => void;
  descartar: () => void;
}

/**
 * HOOK DE DICTADO POR VOZ del Playground. Captura audio con MediaRecorder (opus/webm, o mp4 en
 * Safari), corta solo a los 60 segundos, transcribe via el backend y entrega el texto por
 * `onTexto` para que el llamador lo INSERTE en el input. NUNCA envia nada: el agente ejecuta
 * acciones reales y un dictado mal transcrito no debe dispararse solo.
 *
 * Garantias que este hook sostiene:
 *  - El stream del microfono se libera (todas las tracks) al detener y al desmontar, sin excepcion.
 *  - Si la transcripcion falla por red o error del endpoint, el audio NO se pierde: queda retenido
 *    y se permite UN reintento antes de que el usuario lo descarte.
 *  - Un 501 (VOZ_NO_DISPONIBLE) apaga la feature: soportado pasa a false y el boton desaparece.
 */
export function useVozDictado(opts: {
  idioma: IdiomaDictado;
  onTexto: (texto: string) => void;
}): VozDictado {
  const [soportado, setSoportado] = useState(() => soportaDictado());
  const [fase, setFase] = useState<FaseDictado>('inactivo');
  const [segundos, setSegundos] = useState(0);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  // Audio cuya transcripcion fallo, retenido para el unico reintento o hasta descartarlo.
  const [pendiente, setPendiente] = useState<Blob | null>(null);
  const [reintentado, setReintentado] = useState(false);

  const canceladoRef = useRef(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const intervaloRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const segundosRef = useRef(0);
  // El callback y el idioma se leen via ref para que detener/onstop usen siempre el valor vigente.
  const onTextoRef = useRef(opts.onTexto);
  const idiomaRef = useRef(opts.idioma);
  useEffect(() => {
    onTextoRef.current = opts.onTexto;
    idiomaRef.current = opts.idioma;
  });

  function limpiarIntervalo() {
    if (intervaloRef.current !== null) {
      clearInterval(intervaloRef.current);
      intervaloRef.current = null;
    }
  }

  function liberarStream() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }

  // Al desmontar: cortar el timer, cerrar el recorder y liberar el microfono SIEMPRE.
  useEffect(
    () => () => {
      canceladoRef.current = true;
      limpiarIntervalo();
      const recorder = recorderRef.current;
      if (recorder !== null && recorder.state !== 'inactive') recorder.stop();
      recorderRef.current = null;
      liberarStream();
    },
    [],
  );

  async function transcribir(audio: Blob, duracionMs?: number): Promise<void> {
    setFase('transcribiendo');
    setErrorKey(null);
    try {
      const texto = await transcribirDictado(audio, idiomaRef.current, duracionMs);
      if (canceladoRef.current) return;
      setPendiente(null);
      setReintentado(false);
      setFase('inactivo');
      onTextoRef.current(texto);
    } catch (error) {
      if (canceladoRef.current) return;
      setFase('inactivo');
      // Lectura estructural del status (mismo patron que useTecladoRelay): 501 = feature apagada.
      const status = (error as { status?: number }).status;
      if (status === 501) {
        setSoportado(false);
        setPendiente(null);
        setErrorKey('playground.voz.noDisponible');
        return;
      }
      // Red o endpoint caido: el audio NO se pierde; queda para reintentar o descartar.
      setPendiente(audio);
      setErrorKey('playground.voz.errorTranscripcion');
    }
  }

  function detener() {
    limpiarIntervalo();
    const recorder = recorderRef.current;
    if (recorder !== null && recorder.state !== 'inactive') {
      // onstop libera el stream y dispara la transcripcion con lo grabado.
      recorder.stop();
    } else {
      liberarStream();
    }
  }

  async function iniciar(): Promise<void> {
    setErrorKey(null);
    const mime = mimeDictado();
    if (mime === null) {
      setSoportado(false);
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      if (!canceladoRef.current) setErrorKey('playground.voz.permisoDenegado');
      return;
    }
    if (canceladoRef.current) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    streamRef.current = stream;
    chunksRef.current = [];
    const recorder = new MediaRecorder(stream, { mimeType: mime });
    recorderRef.current = recorder;
    recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      liberarStream();
      limpiarIntervalo();
      recorderRef.current = null;
      const duracionMs = segundosRef.current * 1000;
      const audio = new Blob(chunksRef.current, { type: mime });
      chunksRef.current = [];
      if (canceladoRef.current) return;
      void transcribir(audio, duracionMs);
    };
    recorder.start();
    segundosRef.current = 0;
    setSegundos(0);
    setFase('grabando');
    intervaloRef.current = setInterval(() => {
      segundosRef.current += 1;
      setSegundos(segundosRef.current);
      // Corte automatico al limite: se detiene y se transcribe lo grabado hasta aca.
      if (segundosRef.current >= MAX_SEGUNDOS_DICTADO) detener();
    }, 1000);
  }

  function alternar() {
    if (fase === 'grabando') {
      detener();
    } else if (fase === 'inactivo') {
      void iniciar();
    }
    // En 'transcribiendo' no hay nada que alternar: se espera el resultado.
  }

  function reintentar() {
    const audio = pendiente;
    if (audio === null || reintentado || fase !== 'inactivo') return;
    setReintentado(true);
    void transcribir(audio);
  }

  function descartar() {
    setPendiente(null);
    setErrorKey(null);
    setReintentado(false);
  }

  return {
    soportado,
    fase,
    segundos,
    errorKey,
    puedeReintentar: pendiente !== null && !reintentado,
    alternar,
    reintentar,
    descartar,
  };
}
