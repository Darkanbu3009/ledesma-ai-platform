import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { LedesmaAgent, type LedesmaAgentProps } from '../src/index.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const endpoint = 'https://api.example.com/v1/run/abc-123';
const tokenUrl = 'https://backend.example.com/api/token-agente';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

/** Renderiza (o re-renderiza) el wrapper y devuelve el custom element montado. */
function renderAgent(props: LedesmaAgentProps): HTMLElement {
  act(() => {
    root.render(createElement(LedesmaAgent, props));
  });
  const element = container.querySelector<HTMLElement>('ledesma-agent');
  if (element === null) throw new Error('el elemento ledesma-agent no se monto');
  return element;
}

describe('LedesmaAgent', () => {
  it('monta el custom element con endpoint y token-url como atributos', () => {
    const element = renderAgent({ endpoint, tokenUrl });

    expect(element.getAttribute('endpoint')).toBe(endpoint);
    expect(element.getAttribute('token-url')).toBe(tokenUrl);
  });

  it('NO crea el atributo provider-key cuando providerKey es undefined', () => {
    const element = renderAgent({ endpoint, tokenUrl });

    expect(element.hasAttribute('provider-key')).toBe(false);
  });

  it('actualiza el atributo title al re-renderizar con un title nuevo', () => {
    const element = renderAgent({ endpoint, title: 'Hola' });
    expect(element.getAttribute('title')).toBe('Hola');

    renderAgent({ endpoint, title: 'Asistente' });
    expect(element.getAttribute('title')).toBe('Asistente');
  });

  it('quita el atributo al re-renderizar con la prop en undefined', () => {
    const element = renderAgent({ endpoint, providerKey: 'clave-de-prueba' });
    expect(element.getAttribute('provider-key')).toBe('clave-de-prueba');

    renderAgent({ endpoint });
    expect(element.hasAttribute('provider-key')).toBe(false);
  });
});
