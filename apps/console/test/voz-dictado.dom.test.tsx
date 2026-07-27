// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

/**
 * DICTADO POR VOZ del Playground. Lo que protegen estos tests:
 *
 *  1. Sin MediaRecorder utilizable el boton NO se muestra (la feature desaparece, no falla).
 *  2. El flujo feliz pasa por los estados grabando -> transcribiendo y el texto se INSERTA en el
 *     borrador CONCATENANDO a lo que ya habia; jamas se envia solo.
 *  3. El stream del microfono se libera (todas las tracks) al detener y al desmontar.
 *  4. La grabacion se corta sola al llegar al limite de 60 segundos y se transcribe lo grabado.
 *  5. Si la transcripcion falla por red, el audio NO se pierde: se permite UN reintento con el
 *     MISMO audio y despues solo queda descartar.
 *  6. Un 501 (VOZ_NO_DISPONIBLE) oculta el boton y muestra el aviso: feature apagada.
 */

const { mockTranscribir } = vi.hoisted(() => ({ mockTranscribir: vi.fn() }));

// Solo se mockea la llamada de red; la logica pura de lib/voz (soporte, mime, concatenacion) se
// ejercita real. La separacion en dos modulos existe para esto: no arrastrar supabase al arbol.
vi.mock('../src/lib/voz-transcribir', () => ({
  transcribirDictado: (...args: unknown[]) => mockTranscribir(...args) as Promise<string>,
}));

import { concatenarDictado } from '../src/lib/voz';
import { VozDictado } from '../src/components/agents/VozDictado';

class FakeMediaRecorder {
  static instancias: FakeMediaRecorder[] = [];
  static isTypeSupported = (tipo: string) => tipo === 'audio/webm;codecs=opus';
  state: 'inactive' | 'recording' = 'inactive';
  ondataavailable: ((evento: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  opciones: { mimeType?: string };
  constructor(_stream: MediaStream, opciones: { mimeType?: string } = {}) {
    this.opciones = opciones;
    FakeMediaRecorder.instancias.push(this);
  }
  start() {
    this.state = 'recording';
  }
  stop() {
    if (this.state === 'inactive') return;
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['pcm'], { type: this.opciones.mimeType }) });
    this.onstop?.();
  }
}

const mockGetUserMedia = vi.fn();
let trackStop: ReturnType<typeof vi.fn>;

function streamFalso() {
  trackStop = vi.fn();
  return { getTracks: () => [{ stop: trackStop }] } as unknown as MediaStream;
}

/** Espejo minimo del cableado de PlaygroundPage: borrador + insercion concatenada del dictado. */
function Harness({ inicial = '' }: { inicial?: string }) {
  const [draft, setDraft] = useState(inicial);
  return (
    <div>
      <textarea aria-label="borrador" value={draft} onChange={(e) => setDraft(e.target.value)} />
      <VozDictado
        idioma="es"
        disabled={false}
        onTexto={(texto) => setDraft((previo) => concatenarDictado(previo, texto))}
      />
    </div>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  FakeMediaRecorder.instancias = [];
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia: mockGetUserMedia },
    configurable: true,
  });
  mockGetUserMedia.mockImplementation(async () => streamFalso());
  mockTranscribir.mockResolvedValue('texto dictado');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('VozDictado', () => {
  it('sin MediaRecorder el boton no se muestra', () => {
    vi.stubGlobal('MediaRecorder', undefined);
    render(<Harness />);
    expect(screen.queryByLabelText('Dictar por voz')).not.toBeInTheDocument();
  });

  it('graba, transcribe, INSERTA concatenando al borrador y libera el stream', async () => {
    render(<Harness inicial="ya escrito" />);

    fireEvent.click(screen.getByLabelText('Dictar por voz'));
    // GRABANDO: el boton cambia de rol y aparece el contador.
    const detener = await screen.findByLabelText('Detener dictado');
    expect(screen.getByText('0:00')).toBeInTheDocument();

    fireEvent.click(detener);
    // El texto queda CONCATENADO a lo ya escrito; nunca se envia solo.
    await waitFor(() =>
      expect(screen.getByLabelText('borrador')).toHaveValue('ya escrito texto dictado'),
    );
    // La transcripcion recibio el audio grabado con el idioma activo como hint.
    expect(mockTranscribir).toHaveBeenCalledTimes(1);
    expect(mockTranscribir.mock.calls[0]?.[0]).toBeInstanceOf(Blob);
    expect(mockTranscribir.mock.calls[0]?.[1]).toBe('es');
    // Todas las tracks del microfono quedaron liberadas al detener.
    expect(trackStop).toHaveBeenCalled();
    // De vuelta al estado inicial: se puede dictar otra vez.
    expect(screen.getByLabelText('Dictar por voz')).toBeInTheDocument();
  });

  it('desmontar durante la grabacion libera el stream del microfono', async () => {
    const { unmount } = render(<Harness />);
    fireEvent.click(screen.getByLabelText('Dictar por voz'));
    await screen.findByLabelText('Detener dictado');

    unmount();
    expect(trackStop).toHaveBeenCalled();
    expect(FakeMediaRecorder.instancias[0]?.state).toBe('inactive');
  });

  it('corta solo a los 60 segundos y transcribe lo grabado', async () => {
    vi.useFakeTimers();
    render(<Harness />);

    fireEvent.click(screen.getByLabelText('Dictar por voz'));
    await act(async () => {});
    expect(screen.getByLabelText('Detener dictado')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(59_000);
    });
    // A los 59 s sigue grabando y el contador lo muestra.
    expect(screen.getByText('0:59')).toBeInTheDocument();
    expect(FakeMediaRecorder.instancias[0]?.state).toBe('recording');

    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    // Al limite: corte automatico, stream liberado y transcripcion disparada con lo grabado.
    expect(FakeMediaRecorder.instancias[0]?.state).toBe('inactive');
    expect(trackStop).toHaveBeenCalled();
    expect(mockTranscribir).toHaveBeenCalledTimes(1);

    await act(async () => {});
    expect(screen.getByLabelText('borrador')).toHaveValue('texto dictado');
  });

  it('fallo de red: el audio NO se pierde y se permite reintentar UNA vez con el mismo audio', async () => {
    mockTranscribir.mockRejectedValue(Object.assign(new Error('offline'), { status: 500 }));
    render(<Harness />);

    fireEvent.click(screen.getByLabelText('Dictar por voz'));
    fireEvent.click(await screen.findByLabelText('Detener dictado'));

    // Error visible y el reintento disponible: el audio sigue retenido.
    expect(await screen.findByText(/No se pudo transcribir/)).toBeInTheDocument();
    const audioOriginal = mockTranscribir.mock.calls[0]?.[0] as Blob;

    fireEvent.click(screen.getByLabelText('Reintentar la transcripcion del dictado'));
    await waitFor(() => expect(mockTranscribir).toHaveBeenCalledTimes(2));
    // El reintento manda EXACTAMENTE el mismo audio, no una regrabacion.
    expect(mockTranscribir.mock.calls[1]?.[0]).toBe(audioOriginal);

    // Segundo fallo: el unico reintento ya se uso; solo queda descartar.
    expect(await screen.findByText(/No se pudo transcribir/)).toBeInTheDocument();
    expect(
      screen.queryByLabelText('Reintentar la transcripcion del dictado'),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Descartar el audio del dictado'));
    expect(screen.queryByText(/No se pudo transcribir/)).not.toBeInTheDocument();
    // El boton de dictar sigue ahi: descartar no apaga la feature.
    expect(screen.getByLabelText('Dictar por voz')).toBeInTheDocument();
  });

  it('reintento exitoso: inserta el texto y limpia el error', async () => {
    mockTranscribir
      .mockRejectedValueOnce(Object.assign(new Error('offline'), { status: 500 }))
      .mockResolvedValueOnce('llego al reintento');
    render(<Harness />);

    fireEvent.click(screen.getByLabelText('Dictar por voz'));
    fireEvent.click(await screen.findByLabelText('Detener dictado'));
    fireEvent.click(await screen.findByLabelText('Reintentar la transcripcion del dictado'));

    await waitFor(() =>
      expect(screen.getByLabelText('borrador')).toHaveValue('llego al reintento'),
    );
    expect(screen.queryByText(/No se pudo transcribir/)).not.toBeInTheDocument();
  });

  it('permiso de microfono denegado: mensaje claro y sin grabacion', async () => {
    mockGetUserMedia.mockRejectedValue(new Error('NotAllowedError'));
    render(<Harness />);

    fireEvent.click(screen.getByLabelText('Dictar por voz'));
    expect(await screen.findByText(/No hay permiso para usar el microfono/)).toBeInTheDocument();
    expect(FakeMediaRecorder.instancias).toHaveLength(0);
    expect(mockTranscribir).not.toHaveBeenCalled();
  });

  it('501 VOZ_NO_DISPONIBLE: oculta el boton y muestra el aviso', async () => {
    mockTranscribir.mockRejectedValue(Object.assign(new Error('api 501'), { status: 501 }));
    render(<Harness />);

    fireEvent.click(screen.getByLabelText('Dictar por voz'));
    fireEvent.click(await screen.findByLabelText('Detener dictado'));

    expect(await screen.findByText(/no esta disponible/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Dictar por voz')).not.toBeInTheDocument();
  });
});

describe('concatenarDictado', () => {
  it('inserta concatenando con un espacio y sin duplicarlo', () => {
    expect(concatenarDictado('', 'hola')).toBe('hola');
    expect(concatenarDictado('previo', 'hola')).toBe('previo hola');
    expect(concatenarDictado('previo ', 'hola')).toBe('previo hola');
    expect(concatenarDictado('previo', '  ')).toBe('previo');
  });
});
