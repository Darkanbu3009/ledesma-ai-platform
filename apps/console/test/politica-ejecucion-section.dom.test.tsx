// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import type { PoliticaEjecucion } from '../src/lib/politicas';

// Mismo aislamiento que el resto de los dom tests: se mockean los hooks con red para renderizar la
// seccion sin QueryClient ni env de Supabase.
const politicaQuery = { data: undefined as PoliticaEjecucion | undefined, isLoading: false, isError: false };
const guardar = vi.fn();

vi.mock('../src/lib/queries', () => ({
  usePoliticaEjecucion: () => politicaQuery,
}));
vi.mock('../src/lib/mutations', () => ({
  useGuardarPoliticaEjecucion: () => ({ isPending: false, mutate: guardar }),
}));

import i18n from '../src/i18n';
import { PoliticaEjecucionSection } from '../src/components/account/PoliticaEjecucionSection';

/**
 * SECCION de limites de acciones que no se pueden deshacer (/configuracion). Se configura UNA vez:
 * lo que estos tests fijan es que la pantalla muestra lo guardado, envia los tres ajustes juntos y
 * habla en lenguaje de persona (ni una palabra de mecanismo).
 */

const POLITICA: PoliticaEjecucion = {
  ejecutarAccionesIrreversibles: true,
  topeMontoSinConfirmacion: 5000,
  sitiosExcluidos: ['banco.com'],
  configurada: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  politicaQuery.data = POLITICA;
  politicaQuery.isLoading = false;
  politicaQuery.isError = false;
});

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage('es');
});

describe('PoliticaEjecucionSection', () => {
  it('muestra los tres ajustes guardados', () => {
    render(<PoliticaEjecucionSection />);
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByDisplayValue('5000')).toBeInTheDocument();
    expect(screen.getByDisplayValue('banco.com')).toBeInTheDocument();
  });

  it('guarda los tres ajustes juntos, con los sitios ya como lista', () => {
    render(<PoliticaEjecucionSection />);
    fireEvent.change(screen.getByDisplayValue('5000'), { target: { value: '1200' } });
    fireEvent.change(screen.getByDisplayValue('banco.com'), {
      target: { value: 'Banco.com, sat.gob.mx' },
    });
    fireEvent.click(screen.getByRole('switch'));
    fireEvent.click(screen.getByRole('button', { name: /guardar/i }));

    expect(guardar).toHaveBeenCalledTimes(1);
    expect(guardar.mock.calls[0]?.[0]).toEqual({
      ejecutarAccionesIrreversibles: false,
      topeMontoSinConfirmacion: 1200,
      sitiosExcluidos: ['banco.com', 'sat.gob.mx'],
    });
  });

  it('sin configurar previamente, muestra los defaults que devuelve el backend', () => {
    politicaQuery.data = {
      ejecutarAccionesIrreversibles: true,
      topeMontoSinConfirmacion: 0,
      sitiosExcluidos: [],
      configurada: false,
    };
    render(<PoliticaEjecucionSection />);
    expect(screen.getByDisplayValue('0')).toBeInTheDocument();
  });

  it('si no se puede cargar, lo dice sin detalle tecnico', () => {
    politicaQuery.data = undefined;
    politicaQuery.isError = true;
    render(<PoliticaEjecucionSection />);
    expect(screen.getByText('No pudimos cargar tus límites.')).toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });

  it('ningun texto visible usa terminos tecnicos', () => {
    const { container } = render(<PoliticaEjecucionSection />);
    const texto = (container.textContent ?? '').toLowerCase();
    for (const termino of ['checkpoint', 'aprobacion', 'aprobación', 'blocklist', 'worker', 'dom', 'selector']) {
      expect(texto).not.toContain(termino);
    }
  });

  it('en ingles muestra los mismos ajustes traducidos', async () => {
    await i18n.changeLanguage('en');
    render(<PoliticaEjecucionSection />);
    expect(screen.getByText('Actions that cannot be undone')).toBeInTheDocument();
  });
});
