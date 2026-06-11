import { describe, it, expect } from 'vitest';
import {
  agentEndpoint,
  curlSnippet,
  mobileWebGuide,
  nodeSnippet,
  sessionTokensEndpoint,
  tokenServerSnippet,
  widgetDirectSnippet,
  widgetScriptUrl,
  widgetTokenSnippet,
} from '../src/lib/snippets';

const params = { apiUrl: 'https://api.example.com', agentId: 'abc-123' };
const endpoint = 'https://api.example.com/v1/run/abc-123';
const tokensEndpoint = 'https://api.example.com/v1/session-tokens';
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
  it('contiene ambos endpoints y advierte que la key no va al dispositivo', () => {
    const guide = mobileWebGuide(params);
    expect(guide).toContain(endpoint);
    expect(guide).toContain(tokensEndpoint);
    expect(guide).toContain('x-session-token');
    expect(guide).toContain('la key nunca viaja al dispositivo');
  });
});

describe('sessionTokensEndpoint', () => {
  it('compone {apiUrl}/v1/session-tokens', () => {
    expect(sessionTokensEndpoint(params)).toBe(tokensEndpoint);
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

describe('widgetTokenSnippet', () => {
  it('apunta directo a la plataforma con token-url del backend del cliente, sin provider-key', () => {
    const snippet = widgetTokenSnippet(params);
    expect(snippet).not.toContain('provider-key');
    expect(snippet).toContain(`endpoint="${endpoint}"`);
    expect(snippet).toContain('token-url="https://TU-BACKEND.com/api/token-agente"');
  });

  it('carga el script del widget desde la plataforma', () => {
    expect(widgetTokenSnippet(params)).toContain(`<script src="${scriptUrl}">`);
  });
});

describe('tokenServerSnippet', () => {
  it('emite el token contra la plataforma con la key del entorno y el agentId', () => {
    const snippet = tokenServerSnippet(params);
    expect(snippet).toContain(tokensEndpoint);
    expect(snippet).toContain('process.env.PROVIDER_API_KEY');
    expect(snippet).toContain(`agentId: '${params.agentId}'`);
  });

  it('no contiene ninguna key con pinta real', () => {
    expect(tokenServerSnippet(params)).not.toContain('sk-');
  });
});
