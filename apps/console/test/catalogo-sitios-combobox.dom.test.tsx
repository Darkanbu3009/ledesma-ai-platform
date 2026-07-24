// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { CatalogoSitiosCombobox } from '../src/components/sitios/CatalogoSitiosCombobox';

afterEach(cleanup);

/** Arnes con el estado controlado que en la pagina real vive en SitiosConectadosPage. */
function Arnes({ conectados = [] }: { conectados?: string[] }) {
  const [url, setUrl] = useState('');
  return (
    <CatalogoSitiosCombobox
      value={url}
      onChange={setUrl}
      dominiosConectados={new Set(conectados)}
    />
  );
}

function input(): HTMLInputElement {
  return screen.getByRole('combobox');
}

describe('CatalogoSitiosCombobox (catalogo de sitios sugeridos)', () => {
  it('cerrado por defecto; el foco abre el panel con los grupos y aria-expanded', () => {
    render(<Arnes />);
    expect(input()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    fireEvent.focus(input());
    expect(input()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    expect(screen.getByText('Correo')).toBeInTheDocument();
    expect(screen.getByText('Gmail')).toBeInTheDocument();
  });

  it('teclear filtra por nombre y por dominio', () => {
    render(<Arnes />);
    fireEvent.focus(input());
    fireEvent.change(input(), { target: { value: 'notion.so' } });
    const opciones = screen.getAllByRole('option');
    expect(opciones).toHaveLength(1);
    expect(opciones[0]).toHaveTextContent('Notion');
  });

  it('sin coincidencias el panel se oculta y la URL libre queda tecleada tal cual', () => {
    render(<Arnes />);
    fireEvent.focus(input());
    fireEvent.change(input(), { target: { value: 'https://intranet.miempresa.com/login' } });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(input()).toHaveValue('https://intranet.miempresa.com/login');
    expect(input()).toHaveAttribute('aria-expanded', 'false');
  });

  it('clic en una fila rellena el input con la urlLogin y cierra el panel (sin conectar)', () => {
    render(<Arnes />);
    fireEvent.focus(input());
    fireEvent.change(input(), { target: { value: 'gmail' } });
    fireEvent.click(screen.getByRole('option', { name: /Gmail/ }));
    expect(input()).toHaveValue('https://mail.google.com');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('recorrido de teclado: flechas navegan con aria-activedescendant, Enter selecciona', () => {
    render(<Arnes />);
    fireEvent.focus(input());
    fireEvent.change(input(), { target: { value: 'mail.google' } });
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    const activa = input().getAttribute('aria-activedescendant');
    expect(activa).toBe('sitio-url-opcion-gmail');
    expect(document.getElementById(activa ?? '')).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(input()).toHaveValue('https://mail.google.com');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('Escape cierra el panel sin borrar lo tecleado', () => {
    render(<Arnes />);
    fireEvent.focus(input());
    fireEvent.change(input(), { target: { value: 'git' } });
    fireEvent.keyDown(input(), { key: 'Escape' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(input()).toHaveValue('git');
  });

  it('Enter sin opcion resaltada no altera el input (el submit del form sigue siendo del form)', () => {
    render(<Arnes />);
    fireEvent.focus(input());
    fireEvent.change(input(), { target: { value: 'gmail' } });
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(input()).toHaveValue('gmail');
  });

  it('un sitio ya conectado se marca, queda atenuado y no responde al clic ni a las flechas', () => {
    render(<Arnes conectados={['mail.google.com']} />);
    fireEvent.focus(input());
    fireEvent.change(input(), { target: { value: 'mail.google' } });
    const opcion = screen.getByRole('option', { name: /Gmail/ });
    expect(opcion).toHaveAttribute('aria-disabled', 'true');
    expect(opcion).toHaveTextContent('Conectado');
    fireEvent.click(opcion);
    expect(input()).toHaveValue('mail.google');
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    expect(input()).not.toHaveAttribute('aria-activedescendant', 'sitio-url-opcion-gmail');
  });

  it('las advertencias del catalogo se muestran en la fila', () => {
    render(<Arnes />);
    fireEvent.focus(input());
    fireEvent.change(input(), { target: { value: 'instagram' } });
    expect(screen.getByRole('option', { name: /Instagram/ })).toHaveTextContent(
      /restringe la automatización/,
    );
    fireEvent.change(input(), { target: { value: 'sat.gob' } });
    expect(screen.getByRole('option', { name: /SAT/ })).toHaveTextContent(
      /datos fiscales o de identidad/,
    );
  });

  it('la nota se muestra como linea secundaria', () => {
    render(<Arnes />);
    fireEvent.focus(input());
    fireEvent.change(input(), { target: { value: 'whatsapp' } });
    expect(screen.getByRole('option', { name: /WhatsApp Web/ })).toHaveTextContent(/código QR/);
  });
});
