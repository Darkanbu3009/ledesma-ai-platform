import { describe, it, expect } from 'vitest';
import {
  agentEndpoint,
  curlSnippet,
  mobileWebGuide,
  nodeSnippet,
  proxyServerSnippet,
  widgetDirectSnippet,
  widgetProxySnippet,
  widgetScriptUrl,
} from '../src/lib/snippets';

const params = { apiUrl: 'https://api.example.com', agentId: 'abc-123' };
const endpoint = 'https://api.example.com/v1/run/abc-123';
const scriptUrl = 'https://api.example.com/widget/ledesma-agent.js';

describe('agentEndpoint', () => {
  it('compone {apiUrl}/v1/run/{agentId}', () => {
    expect(agentEndpoint(params)).toBe(endpoint);
  });
});

describe('curlSnippet', () => {
  it('contiene el endpoint y el header x-provider-key con placeholder', () => {
    const snippet = curlSnippet(params);
    expect(snippet).toContain(endpoint);
    expect(snippet).toContain('x-provider-key: TU_API_KEY_DEL_PROVEEDOR');
  });

  it('no contiene ninguna key con pinta real', () => {
    expect(curlSnippet(params)).not.toContain('sk-');
  });
});

describe('nodeSnippet', () => {
  it('contiene el endpoint y lee la key desde el entorno del servidor', () => {
    const snippet = nodeSnippet(params);
    expect(snippet).toContain(endpoint);
    expect(snippet).toContain('process.env.PROVIDER_API_KEY');
  });
});

describe('mobileWebGuide', () => {
  it('contiene el endpoint y advierte que la key no va al dispositivo', () => {
    const guide = mobileWebGuide(params);
    expect(guide).toContain(endpoint);
    expect(guide).toContain('la key nunca viaja al dispositivo');
  });
});

describe('widgetScriptUrl', () => {
  it('compone {apiUrl}/widget/ledesma-agent.js', () => {
    expect(widgetScriptUrl(params)).toBe(scriptUrl);
  });
});

describe('widgetDirectSnippet', () => {
  it('contiene el script, el endpoint del agente y el placeholder de la key', () => {
    const snippet = widgetDirectSnippet(params);
    expect(snippet).toContain(scriptUrl);
    expect(snippet).toContain(`endpoint="${endpoint}"`);
    expect(snippet).toContain('provider-key="TU_API_KEY_DEL_PROVEEDOR"');
  });

  it('no contiene ninguna key con pinta real', () => {
    expect(widgetDirectSnippet(params)).not.toContain('sk-');
  });
});

describe('widgetProxySnippet', () => {
  it('apunta al backend del cliente, sin provider-key ni endpoint de la plataforma', () => {
    const snippet = widgetProxySnippet(params);
    expect(snippet).not.toContain('provider-key');
    expect(snippet).not.toContain(endpoint);
    expect(snippet).toContain('endpoint="https://TU-BACKEND.com/api/agente"');
  });

  it('carga el script del widget desde la plataforma', () => {
    expect(widgetProxySnippet(params)).toContain(`<script src="${scriptUrl}">`);
  });
});

describe('proxyServerSnippet', () => {
  it('contiene el endpoint del agente y lee la key desde el entorno del servidor', () => {
    const snippet = proxyServerSnippet(params);
    expect(snippet).toContain(endpoint);
    expect(snippet).toContain('process.env.PROVIDER_API_KEY');
  });
});
