// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import type { DataRequest } from '../src/lib/privacy';

// Los hooks de datos y la mutation se mockean para ejercer la pantalla sin red ni react-query.
const { useDataRequestsMock, useCreateDataRequestMock, apiFetchMock } = vi.hoisted(() => ({
  useDataRequestsMock: vi.fn(),
  useCreateDataRequestMock: vi.fn(),
  apiFetchMock: vi.fn(),
}));
vi.mock('../src/lib/queries', () => ({ useDataRequests: useDataRequestsMock }));
vi.mock('../src/lib/mutations', () => ({ useCreateDataRequest: useCreateDataRequestMock }));
vi.mock('../src/lib/api', () => ({ apiFetch: apiFetchMock }));

import { PrivacyRightsPage } from '../src/pages/PrivacyRightsPage';

function renderPage(requests: DataRequest[] = []) {
  useDataRequestsMock.mockReturnValue({
    data: requests,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });
  const mutate = vi.fn();
  useCreateDataRequestMock.mockReturnValue({ mutate, isPending: false, isError: false });
  render(
    <MemoryRouter>
      <PrivacyRightsPage />
    </MemoryRouter>,
  );
  return { mutate };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('PrivacyRightsPage', () => {
  it('muestra encabezado con badge legal, radio group ARCO, descarga y pasos', () => {
    renderPage();

    expect(screen.getByRole('heading', { name: 'Privacidad y tus datos' })).toBeInTheDocument();
    expect(screen.getByText('LFPDPPP · GDPR')).toBeInTheDocument();

    // Radio group con los 4 derechos ARCO (sin supresion en el formulario).
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(4);
    expect(screen.getByRole('radio', { name: /Acceso/ })).toBeChecked();
    expect(screen.getByText('Corregir datos incompletos o inexactos.')).toBeInTheDocument();

    // Nota sin folio (el registro no muestra un identificador al titular).
    expect(screen.getByText('Queda registrada y puedes seguirla abajo.')).toBeInTheDocument();

    // Tarjeta de descarga con el mismo handler self-service.
    expect(screen.getByRole('button', { name: 'Descargar mis datos' })).toBeInTheDocument();

    // Pasos de "Que sigue al enviar".
    expect(screen.getByText('Que sigue al enviar')).toBeInTheDocument();
    expect(screen.getByText('Tu solicitud queda registrada con fecha.')).toBeInTheDocument();
    expect(screen.getByText('Ves la resolucion aqui, en tu historial.')).toBeInTheDocument();
  });

  it('envia el tipo seleccionado en el radio group', () => {
    const { mutate } = renderPage();

    fireEvent.click(screen.getByRole('radio', { name: /Oposicion/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Enviar solicitud' }));

    expect(mutate).toHaveBeenCalledWith(
      { request_type: 'opposition', details: undefined },
      expect.anything(),
    );
  });
});
