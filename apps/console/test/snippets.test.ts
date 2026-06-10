import { describe, it, expect } from 'vitest';
import { agentEndpoint, curlSnippet, mobileWebGuide, nodeSnippet } from '../src/lib/snippets';

const params = { apiUrl: 'https://api.example.com', agentId: 'abc-123' };
const endpoint = 'https://api.example.com/v1/run/abc-123';

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
