// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

const mockEnviarTexto = vi.fn();
const mockEnviarTecla = vi.fn();
const mockSoportaRelay = vi.fn();
const mockSolicitarToken = vi.fn();

vi.mock('../src/lib/relay-crypto', () => ({
  soportaRelay: () => mockSoportaRelay(),
}));

vi.mock('../src/lib/relay-teclado', () => ({
  solicitarTokenRelay: (id: string) => mockSolicitarToken(id),
  ConexionRelayTeclado: class {
    onEstado: (estado: string) => void;
    constructor(opts: { onEstado: (estado: string) => void }) {
      this.onEstado = opts.onEstado;
    }
    async conectar() {
      this.onEstado('listo');
    }
    enviarTexto = mockEnviarTexto;
    enviarTecla = mockEnviarTecla;
    cerrar() {}
  },
}));

import { RelayTecladoMovil } from '../src/components/sitios/RelayTecladoMovil';

beforeEach(() => {
  vi.clearAllMocks();
  mockSoportaRelay.mockResolvedValue(true);
  mockSolicitarToken.mockResolvedValue({ token: 'tok', expiresAt: '', relayUrl: 'wss://relay.example' });
});

afterEach(() => {
  cleanup();
});

describe('RelayTecladoMovil', () => {
  it('muestra la divulgacion y, una vez listo, releva el texto y LIMPIA el campo', async () => {
    render(<RelayTecladoMovil sitioId="sit_1" />);

    // Divulgacion visible ANTES de escribir (mencion de cifrado y de la conexion directa por computadora).
    expect(screen.getByText(/cifrado/i)).toBeInTheDocument();

    const campo = screen.getByLabelText(/las teclas se transmiten cifradas/i) as HTMLInputElement;
    // Atributos que evitan autocompletado/autocorreccion/historial.
    expect(campo).toHaveAttribute('autocomplete', 'off');
    expect(campo).toHaveAttribute('autocorrect', 'off');
    expect(campo).toHaveAttribute('autocapitalize', 'off');
    expect(campo).toHaveAttribute('spellcheck', 'false');

    await waitFor(() => expect(campo).not.toBeDisabled());

    fireEvent.change(campo, { target: { value: 'h' } });
    expect(mockEnviarTexto).toHaveBeenCalledWith('h');
    // El campo se limpia de inmediato: no acumula texto.
    expect(campo.value).toBe('');

    fireEvent.change(campo, { target: { value: 'unter2' } });
    expect(mockEnviarTexto).toHaveBeenLastCalledWith('unter2');
    expect(campo.value).toBe('');
  });

  it('los botones de control (Tab/Enter/Retroceso) reenvian teclas', async () => {
    render(<RelayTecladoMovil sitioId="sit_1" />);
    const campo = screen.getByLabelText(/las teclas se transmiten cifradas/i);
    await waitFor(() => expect(campo).not.toBeDisabled());

    fireEvent.click(screen.getByRole('button', { name: 'Enter' }));
    expect(mockEnviarTecla).toHaveBeenCalledWith('Enter');
    fireEvent.click(screen.getByRole('button', { name: 'Tab' }));
    expect(mockEnviarTecla).toHaveBeenCalledWith('Tab');
    fireEvent.click(screen.getByRole('button', { name: 'Retroceso' }));
    expect(mockEnviarTecla).toHaveBeenCalledWith('Backspace');
  });

  it('sin soporte del navegador cae al aviso de hacerlo desde una computadora', async () => {
    mockSoportaRelay.mockResolvedValue(false);
    render(<RelayTecladoMovil sitioId="sit_1" />);
    const nota = await screen.findByRole('note');
    expect(nota).toHaveTextContent(/computadora/i);
    // No intenta pedir token ni conectar si el navegador no soporta el canal.
    expect(mockSolicitarToken).not.toHaveBeenCalled();
  });

  it('si el relay no esta configurado (501) tambien cae al aviso', async () => {
    // Se simula el ApiError por su forma (status), sin cargar lib/api en el test.
    mockSolicitarToken.mockRejectedValue({ status: 501, code: 'RELAY_NO_DISPONIBLE' });
    render(<RelayTecladoMovil sitioId="sit_1" />);
    const nota = await screen.findByRole('note');
    expect(nota).toHaveTextContent(/computadora/i);
  });
});
