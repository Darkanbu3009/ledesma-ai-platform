import { describe, it, expect } from 'vitest';
import type { AgentSpec } from '@ledesma-platform/shared';
import { validateAgentSpec, validateAgentSpecStrict } from '../src/agents/agent-spec.js';
import { resolveToolCatalog } from '../src/tools/catalog.js';
import type { Env } from '../src/config/env.js';

/**
 * Tests de la VALIDACION ESTRICTA del modo autonomo (validateAgentSpecStrict). Verifican el delta
 * que diferencia al autonomo del asistente: un spec que valida (validateAgentSpec.ok === true) pero
 * esta INCOMPLETO (sin systemPrompt o sin description) NO pasa la estricta, mientras que un spec
 * completo si. La estricta REUSA validateAgentSpec, asi que tambien hereda todos sus rechazos.
 */

function envWith(overrides: Partial<Record<string, string>>): Env {
  return { NODE_ENV: 'test', ...overrides } as unknown as Env;
}
const WORKER = { WEB_WORKER_URL: 'https://web-worker.example.com', WEB_WORKER_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef' };
const availableCatalog = resolveToolCatalog(envWith(WORKER));

/** Spec minimo: pasa validateAgentSpec (name+providerId+model) pero NO la estricta (falta detalle). */
function minimalSpec(overrides: Partial<AgentSpec> = {}): AgentSpec {
  return { name: 'Cotizador', providerId: 'anthropic', model: 'claude-sonnet-4-6', ...overrides };
}

/** Spec COMPLETO: minimo + proposito (description) + instrucciones (systemPrompt). Pasa la estricta. */
function completeSpec(overrides: Partial<AgentSpec> = {}): AgentSpec {
  return minimalSpec({
    description: 'Cotiza productos para el equipo de ventas.',
    systemPrompt: 'Sos un asistente que calcula cotizaciones a partir de la lista de precios.',
    ...overrides,
  });
}

function malformed(spec: unknown): AgentSpec {
  return spec as AgentSpec;
}

describe('validateAgentSpecStrict: completitud (el delta del modo autonomo)', () => {
  it('spec minimo: validateAgentSpec.ok=true PERO la estricta lo RECHAZA (falta systemPrompt y description)', () => {
    // La base lo acepta...
    expect(validateAgentSpec(minimalSpec(), availableCatalog).ok).toBe(true);
    // ...pero la estricta no.
    const strict = validateAgentSpecStrict(minimalSpec(), availableCatalog);
    expect(strict.ok).toBe(false);
    if (!strict.ok) {
      expect(strict.errors.join('\n')).toMatch(/systemPrompt/);
      expect(strict.errors.join('\n')).toMatch(/description/);
    }
  });

  it('spec COMPLETO (name+providerId+model+systemPrompt+description) -> estricta ok, value listo para crear', () => {
    const strict = validateAgentSpecStrict(completeSpec(), availableCatalog);
    expect(strict.ok).toBe(true);
    if (strict.ok) {
      expect(strict.value).toMatchObject({
        name: 'Cotizador',
        providerId: 'anthropic',
        model: 'claude-sonnet-4-6',
        description: 'Cotiza productos para el equipo de ventas.',
        systemPrompt: 'Sos un asistente que calcula cotizaciones a partir de la lista de precios.',
      });
    }
  });

  it('systemPrompt presente pero vacio/espacios -> rechazado (no alcanza con que la clave exista)', () => {
    const strict = validateAgentSpecStrict(completeSpec({ systemPrompt: '   ' }), availableCatalog);
    expect(strict.ok).toBe(false);
    if (!strict.ok) expect(strict.errors.join('\n')).toMatch(/systemPrompt/);
  });

  it('description presente pero vacia -> rechazada', () => {
    const strict = validateAgentSpecStrict(completeSpec({ description: '' }), availableCatalog);
    expect(strict.ok).toBe(false);
    if (!strict.ok) expect(strict.errors.join('\n')).toMatch(/description/);
  });

  it('falta solo description (con systemPrompt) -> rechazado, solo por description', () => {
    const spec = minimalSpec({ systemPrompt: 'Instrucciones claras del agente.' });
    const strict = validateAgentSpecStrict(spec, availableCatalog);
    expect(strict.ok).toBe(false);
    if (!strict.ok) {
      expect(strict.errors.join('\n')).toMatch(/description/);
      expect(strict.errors.join('\n')).not.toMatch(/systemPrompt/);
    }
  });
});

describe('validateAgentSpecStrict: hereda los rechazos de la base', () => {
  it('si la base falla (falta model) -> la estricta devuelve esos mismos errores', () => {
    const strict = validateAgentSpecStrict(malformed({ name: 'X', providerId: 'anthropic' }), availableCatalog);
    expect(strict.ok).toBe(false);
    if (!strict.ok) expect(strict.errors.join('\n')).toMatch(/model/);
  });

  it('si la base falla (tool nativa inexistente) -> la estricta no crea aunque haya systemPrompt/description', () => {
    const spec = completeSpec({ tools: [{ kind: 'native', name: 'no_existe' }] });
    const strict = validateAgentSpecStrict(spec, availableCatalog);
    expect(strict.ok).toBe(false);
    if (!strict.ok) expect(strict.errors.join('\n')).toMatch(/no_existe/);
  });

  it('spec completo con una webhook tool valida -> estricta ok y la tool va en el value', () => {
    const spec = completeSpec({
      tools: [
        {
          kind: 'webhook',
          name: 'cotizar',
          description: 'Calcula el precio',
          inputSchema: { type: 'object' },
          url: 'https://hooks.cliente.com/cotizar',
        },
      ],
    });
    const strict = validateAgentSpecStrict(spec, availableCatalog);
    expect(strict.ok).toBe(true);
    if (strict.ok) {
      expect(strict.value.tools).toEqual([
        {
          name: 'cotizar',
          description: 'Calcula el precio',
          inputSchema: { type: 'object' },
          url: 'https://hooks.cliente.com/cotizar',
        },
      ]);
    }
  });
});
