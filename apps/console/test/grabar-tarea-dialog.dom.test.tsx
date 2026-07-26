// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { GrabarTareaDialog } from '../src/components/sitios/GrabarTareaDialog';
import type { Grabacion } from '../src/lib/grabaciones';

/**
 * ENSENARLE UNA TAREA: el dialogo completo. Lo que estos tests fijan:
 *  - los textos son los acordados y NINGUNO usa vocabulario tecnico;
 *  - el usuario ve los datos que escribio y elige cuales cambian cada vez, con tipos en lenguaje llano;
 *  - al guardar solo viajan indices y tipos, jamas el valor;
 *  - si la grabacion se detuvo por un campo de contrasena, se dice con todas sus letras.
 */

afterEach(cleanup);

function makeGrabacion(overrides: Partial<Grabacion> = {}): Grabacion {
  return {
    id: 'gra-1',
    connectionId: 'con-1',
    dominio: 'correo.ejemplo.com',
    descripcion: 'mandar el reporte semanal',
    estado: 'terminada',
    motivo: null,
    vistaEnVivoUrl: null,
    pasos: [
      { idx: 0, accion: 'navegar', valor: null },
      { idx: 1, accion: 'escribir', valor: 'ana@ejemplo.com' },
      { idx: 2, accion: 'click', valor: null },
    ],
    creadaEn: '2026-07-24T00:00:00.000Z',
    actualizadaEn: '2026-07-24T00:05:00.000Z',
    ...overrides,
  };
}

function setup(props: Partial<Parameters<typeof GrabarTareaDialog>[0]> = {}) {
  const handlers = {
    onComenzar: vi.fn(),
    onTerminar: vi.fn(),
    onGuardar: vi.fn(),
    onCerrar: vi.fn(),
  };
  render(
    <GrabarTareaDialog
      dominio="correo.ejemplo.com"
      grabacion={null}
      abriendo={false}
      guardada={false}
      error={null}
      ocupado={false}
      {...handlers}
      {...props}
    />,
  );
  return handlers;
}

describe('momento 1: que le vas a ensenar', () => {
  it('pide la descripcion con la ayuda acordada y sin ningun termino tecnico', () => {
    setup();
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByLabelText('Qué le vas a enseñar')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Haz la tarea como la harías normalmente. Después nos dices qué datos cambian cada vez.',
      ),
    ).toBeInTheDocument();
  });

  it('una descripcion vacia no comienza nada', () => {
    const { onComenzar } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Empezar' }));
    expect(onComenzar).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('con la descripcion escrita comienza la grabacion', () => {
    const { onComenzar } = setup();
    fireEvent.change(screen.getByLabelText('Qué le vas a enseñar'), {
      target: { value: '  mandar el reporte semanal  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Empezar' }));
    expect(onComenzar).toHaveBeenCalledWith('mandar el reporte semanal');
  });
});

describe('momento 2: la vista en vivo', () => {
  it('muestra el navegador seguro y el boton de terminar', () => {
    const { onTerminar } = setup({
      grabacion: makeGrabacion({ estado: 'grabando', vistaEnVivoUrl: 'https://vista-en-vivo' }),
    });
    const marco = screen.getByTitle('Navegador seguro para hacer la tarea en correo.ejemplo.com');
    expect(marco).toHaveAttribute('src', 'https://vista-en-vivo');
    fireEvent.click(screen.getByRole('button', { name: 'Ya terminé' }));
    expect(onTerminar).toHaveBeenCalledTimes(1);
  });

  it('mientras el navegador se abre, avisa sin mostrar el marco todavia', () => {
    setup({ abriendo: true });
    expect(screen.getByRole('status')).toHaveTextContent(/Estamos abriendo correo.ejemplo.com/);
    expect(screen.queryByTitle(/Navegador seguro/)).not.toBeInTheDocument();
  });
});

describe('momento 3: que datos cambian cada vez', () => {
  it('lista SOLO los datos que el usuario escribio, con los tipos en lenguaje llano', () => {
    setup({ grabacion: makeGrabacion() });
    expect(
      screen.getByRole('heading', { name: 'Qué datos cambian cada vez' }),
    ).toBeInTheDocument();
    expect(screen.getByText('ana@ejemplo.com')).toBeInTheDocument();
    const selector = screen.getByRole('combobox');
    const opciones = Array.from(selector.querySelectorAll('option')).map((o) => o.textContent);
    expect(opciones).toEqual([
      'Siempre es el mismo',
      'Para quién es',
      'El asunto',
      'El mensaje',
      'El monto',
      'El producto',
      'La cantidad',
    ]);
  });

  it('al guardar viaja el indice y el tipo, jamas el valor que escribio', () => {
    const { onGuardar } = setup({ grabacion: makeGrabacion() });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'destinatario' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(onGuardar).toHaveBeenCalledWith([{ idx: 1, marcador: 'destinatario' }]);
    expect(JSON.stringify(onGuardar.mock.calls)).not.toContain('ana@ejemplo.com');
  });

  it('un dato que el usuario deja sin marcar no viaja como variable', () => {
    const { onGuardar } = setup({ grabacion: makeGrabacion() });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(onGuardar).toHaveBeenCalledWith([]);
  });

  it('una tarea sin datos escritos lo dice y se puede guardar igual', () => {
    const { onGuardar } = setup({
      grabacion: makeGrabacion({ pasos: [{ idx: 0, accion: 'click', valor: null }] }),
    });
    expect(screen.getByText(/No escribiste ningún dato/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(onGuardar).toHaveBeenCalledWith([]);
  });
});

describe('cierres', () => {
  it('al guardarse muestra el mensaje acordado', () => {
    setup({ grabacion: makeGrabacion(), guardada: true });
    expect(screen.getByText('Listo. La próxima vez la hace sola.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Guardar' })).not.toBeInTheDocument();
  });

  it('EL INVARIANTE: si aparecio un campo de contrasena lo dice y avisa que no se guardo nada', () => {
    setup({ grabacion: makeGrabacion({ estado: 'descartada', motivo: 'contrasena' }) });
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Se detuvo la grabación porque apareció un campo de contraseña. No guardamos nada.',
    );
    expect(screen.queryByRole('button', { name: 'Guardar' })).not.toBeInTheDocument();
  });

  it('un descarte por otra razon usa el mensaje generico, no el de la contrasena', () => {
    setup({ grabacion: makeGrabacion({ estado: 'descartada', motivo: 'vencida' }) });
    expect(screen.getByRole('alert')).toHaveTextContent(/No pudimos guardar lo que hiciste/);
  });

  it('cerrar dispara onCerrar', () => {
    const { onCerrar } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(onCerrar).toHaveBeenCalledTimes(1);
  });
});

describe('vocabulario', () => {
  it('ningun texto visible usa terminos tecnicos', () => {
    setup({ grabacion: makeGrabacion() });
    const texto = (screen.getByRole('dialog').textContent ?? '').toLowerCase();
    for (const prohibido of [
      'receta',
      'selector',
      'xpath',
      'cdp',
      'trayectoria',
      'determinista',
      'modelo',
      'token',
    ]) {
      expect(texto).not.toContain(prohibido);
    }
  });
});
