// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import type { TareaEnsenada } from '../src/lib/tareas-ensenadas';

/**
 * TAREAS QUE YA SABE HACER: la pantalla. Lo que estos tests fijan:
 *  - se ve QUE hace cada tarea, cuando se enseno, cuantas veces se uso y que datos hay que darle;
 *  - NINGUN texto visible usa vocabulario tecnico (ni receta, ni firma, ni selector, ni parametro);
 *  - borrar PREGUNTA antes, y solo despues de confirmar llama al backend;
 *  - una tarea que el sistema aprendio solo (sin texto del usuario) igual se puede leer y borrar.
 *
 * La query y la mutacion se mockean: aqui se prueba la pantalla, no la red.
 */

const useTareasEnsenadas = vi.fn();
const mutate = vi.fn();
const useOlvidarTareaEnsenada = vi.fn(() => ({ mutate, isPending: false, isError: false }));

vi.mock('../src/lib/queries', () => ({
  useTareasEnsenadas: () => useTareasEnsenadas() as unknown,
}));
vi.mock('../src/lib/mutations', () => ({
  useOlvidarTareaEnsenada: () => useOlvidarTareaEnsenada() as unknown,
}));

const { TareasEnsenadasPage } = await import('../src/pages/TareasEnsenadasPage');

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  useOlvidarTareaEnsenada.mockReturnValue({ mutate, isPending: false, isError: false });
});

function makeTarea(overrides: Partial<TareaEnsenada> = {}): TareaEnsenada {
  return {
    id: 'tar-1',
    dominio: 'correo.ejemplo.com',
    descripcion: 'mandar el reporte semanal a mi jefe',
    ensenadaEn: '2026-07-20T00:00:00.000Z',
    usos: 4,
    ultimoUsoEn: '2026-07-25T00:00:00.000Z',
    datosQueNecesita: ['destinatario', 'asunto'],
    ...overrides,
  };
}

function renderCon(tareas: TareaEnsenada[], estado: Record<string, unknown> = {}) {
  useTareasEnsenadas.mockReturnValue({
    data: tareas,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
    ...estado,
  });
  return render(<TareasEnsenadasPage />);
}

describe('la pantalla de tareas que ya sabe hacer', () => {
  it('muestra por sitio lo que hace, cuando se enseno, cuantas veces y que datos necesita', () => {
    renderCon([makeTarea()]);

    expect(screen.getByRole('heading', { name: 'Tareas que ya sabe hacer' })).toBeInTheDocument();
    expect(screen.getByText('correo.ejemplo.com')).toBeInTheDocument();
    expect(screen.getByText('mandar el reporte semanal a mi jefe')).toBeInTheDocument();
    expect(screen.getByText(/La ha hecho 4 veces/)).toBeInTheDocument();
    expect(screen.getByText('Datos que le tienes que dar')).toBeInTheDocument();
    expect(screen.getByText('Para quién es')).toBeInTheDocument();
    expect(screen.getByText('El asunto')).toBeInTheDocument();
  });

  it('NINGUN texto visible usa vocabulario tecnico', () => {
    const { container } = renderCon([makeTarea(), makeTarea({ id: 'tar-2', descripcion: null })]);
    const visible = (container.textContent ?? '').toLowerCase();
    for (const palabra of ['receta', 'firma', 'selector', 'parametro', 'xpath', 'determinista']) {
      expect(visible).not.toContain(palabra);
    }
  });

  it('sin ninguna tarea lo dice con todas sus letras y explica como ensenarle una', () => {
    renderCon([]);
    expect(screen.getByText('Todavía no le has enseñado ninguna tarea.')).toBeInTheDocument();
  });

  it('borrar PREGUNTA antes y solo al confirmar llama al backend', () => {
    renderCon([makeTarea()]);

    fireEvent.click(screen.getByRole('button', { name: /Que la olvide/ }));
    expect(mutate).not.toHaveBeenCalled();
    expect(screen.getByText('¿Que olvide esta tarea?')).toBeInTheDocument();

    // El boton de confirmar es el segundo "Que la olvide" (el de la tarjeta desaparecio).
    fireEvent.click(screen.getByRole('button', { name: /Que la olvide/ }));
    expect(mutate).toHaveBeenCalledWith('tar-1');
  });

  it('se puede arrepentir: cancelar cierra la pregunta sin borrar nada', () => {
    renderCon([makeTarea()]);
    fireEvent.click(screen.getByRole('button', { name: /Que la olvide/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Mejor no' }));
    expect(mutate).not.toHaveBeenCalled();
    expect(screen.queryByText('¿Que olvide esta tarea?')).not.toBeInTheDocument();
  });

  it('una tarea que aprendio sola se lee igual, con una frase propia en vez de un texto interno', () => {
    renderCon([makeTarea({ descripcion: null })]);
    expect(screen.getByText('Una tarea que aprendió sola en este sitio')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Que la olvide/ })).toBeInTheDocument();
  });

  it('una tarea que no necesita datos tambien lo dice', () => {
    renderCon([makeTarea({ datosQueNecesita: [] })]);
    expect(screen.getByText('No necesita que le des ningún dato')).toBeInTheDocument();
  });

  it('si la lista no carga, se ofrece reintentar', () => {
    renderCon([], { data: undefined, isError: true });
    expect(screen.getByRole('alert')).toHaveTextContent('No pudimos cargar tus tareas.');
  });
});
