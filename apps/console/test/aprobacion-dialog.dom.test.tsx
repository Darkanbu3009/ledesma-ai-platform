// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

// Se mockea apiFetch para verificar endpoint/body exactos sin red (mismo enfoque que request-upgrade-cta).
const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));
vi.mock('../src/lib/api', () => ({
  apiFetch: apiFetchMock,
  ApiError: class ApiError extends Error {
    constructor(
      public readonly status: number,
      public readonly code: string,
      message: string,
    ) {
      super(message);
    }
  },
}));

import { AprobacionDialog } from '../src/components/aprobaciones/AprobacionDialog';
import type { AprobacionWeb } from '../src/lib/aprobaciones';

afterEach(() => {
  apiFetchMock.mockReset();
  cleanup();
});

function makeAprobacion(overrides: Partial<AprobacionWeb> = {}): AprobacionWeb {
  return {
    id: 'apr-1',
    jobId: 'job-1',
    connectionId: 'con-1',
    accionTipo: 'financiera',
    descripcion: 'Enviar el formulario de pago por 2,400 MXN a Aeromexico',
    // Sin screenshot: el modal debe decidir igual (y el test no toca Supabase Storage).
    screenshotPath: null,
    estado: 'pendiente',
    instruccionRechazo: null,
    decididaEn: null,
    creadaEn: '2026-07-20T00:00:00.000Z',
    expiraEn: '2026-07-20T00:15:00.000Z',
    ...overrides,
  };
}

function renderDialog(onCerrar = vi.fn()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  render(<AprobacionDialog aprobacion={makeAprobacion()} onCerrar={onCerrar} />, {
    wrapper: Wrapper,
  });
  return { onCerrar };
}

describe('AprobacionDialog (checkpoint 7.1e)', () => {
  it('muestra la accion en una linea y los tres botones; el foco arranca en Aprobar', () => {
    renderDialog();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(
      screen.getByText('Enviar el formulario de pago por 2,400 MXN a Aeromexico'),
    ).toBeInTheDocument();
    const aprobar = screen.getByRole('button', { name: 'Aprobar' });
    expect(screen.getByRole('button', { name: 'Rechazar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rechazar con instrucción' })).toBeInTheDocument();
    expect(aprobar).toHaveFocus();
  });

  it('Aprobar en UN tap: POST /aprobar y cierra', async () => {
    apiFetchMock.mockResolvedValue({ aprobacion: makeAprobacion({ estado: 'aprobada' }), jobReanudado: true });
    const { onCerrar } = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Aprobar' }));
    await waitFor(() => expect(onCerrar).toHaveBeenCalledTimes(1));
    expect(apiFetchMock).toHaveBeenCalledWith('/v1/aprobaciones/apr-1/aprobar', { method: 'POST' });
  });

  it('Rechazar en UN tap: POST /rechazar sin instruccion', async () => {
    apiFetchMock.mockResolvedValue({ aprobacion: makeAprobacion({ estado: 'rechazada' }), jobReanudado: true });
    const { onCerrar } = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Rechazar' }));
    await waitFor(() => expect(onCerrar).toHaveBeenCalledTimes(1));
    expect(apiFetchMock).toHaveBeenCalledWith('/v1/aprobaciones/apr-1/rechazar', {
      method: 'POST',
      body: JSON.stringify({}),
    });
  });

  it('Rechazar con instruccion: abre el campo, exige texto y lo envia en el body', async () => {
    apiFetchMock.mockResolvedValue({ aprobacion: makeAprobacion({ estado: 'rechazada' }), jobReanudado: true });
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Rechazar con instrucción' }));
    const enviar = screen.getByRole('button', { name: 'Rechazar y enviar instrucción' });
    expect(enviar).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Instrucción para el agente'), {
      target: { value: 'mejor el vuelo de las 9 am' },
    });
    expect(enviar).toBeEnabled();
    fireEvent.click(enviar);
    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith('/v1/aprobaciones/apr-1/rechazar', {
        method: 'POST',
        body: JSON.stringify({ instruccion: 'mejor el vuelo de las 9 am' }),
      }),
    );
  });

  it('cerrar SIN decidir no llama a ningun endpoint (la aprobacion sigue pendiente)', () => {
    const { onCerrar } = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar la aprobación (queda pendiente)' }));
    expect(onCerrar).toHaveBeenCalledTimes(1);
    expect(apiFetchMock).not.toHaveBeenCalled();
  });
});
