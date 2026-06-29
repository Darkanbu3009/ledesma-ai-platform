import { describe, it, expect } from 'vitest';
import type { Env } from '../src/config/env.js';
import { NATIVE_TOOLS, NATIVE_TOOL_NAMES, NATIVE_TOOL_PREFIX } from '../src/tools/native-tools.js';
import {
  TOOL_CATALOG,
  WEBHOOK_TOOL_CAPABILITY,
  buildToolCatalog,
  resolveToolCatalog,
} from '../src/tools/catalog.js';

// Env minimo: solo nos importan las dos claves del web worker para resolver disponibilidad.
function envWith(overrides: Partial<Record<string, string>>): Env {
  return { NODE_ENV: 'test', ...overrides } as unknown as Env;
}
const WORKER_URL = 'https://web-worker.example.com';
const WORKER_SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef';

describe('TOOL_CATALOG: guardian de drift contra NATIVE_TOOLS', () => {
  it('cada nativa tiene exactamente una entrada y no hay entradas huerfanas (ambos sentidos)', () => {
    const catalogNames = TOOL_CATALOG.map((e) => e.name).sort();
    const nativeNames = [...NATIVE_TOOL_NAMES].sort();
    expect(catalogNames).toEqual(nativeNames);
    // Sin duplicados en el catalogo.
    expect(new Set(catalogNames).size).toBe(catalogNames.length);
    // Toda entrada del catalogo (hoy todas 'native') apunta a una nativa real.
    for (const entry of TOOL_CATALOG) {
      expect(entry.kind).toBe('native');
      expect(NATIVE_TOOL_NAMES.has(entry.name)).toBe(true);
    }
  });

  it('agregar una nativa SIN metadata de catalogo hace fallar la construccion (fail-fast)', () => {
    const conNativaNueva = [...NATIVE_TOOLS, { name: 'platform_nueva', description: 'x', inputSchema: { type: 'object' } }];
    // Reusa la metadata real (no incluye platform_nueva) -> debe lanzar.
    expect(() => buildToolCatalog(conNativaNueva, metaReal())).toThrow(/platform_nueva/);
  });

  it('metadata huerfana (sin nativa correspondiente) hace fallar la construccion', () => {
    const metaConHuerfana = { ...metaReal(), platform_inexistente: { title: 'x', whenToUse: 'y', requiresConfig: [] } };
    expect(() => buildToolCatalog(NATIVE_TOOLS, metaConHuerfana)).toThrow(/huerfana|platform_inexistente/);
  });
});

describe('TOOL_CATALOG: shape y fuente unica', () => {
  it('cada entrada tiene todos los campos requeridos con los tipos correctos', () => {
    expect(TOOL_CATALOG.length).toBe(NATIVE_TOOLS.length);
    for (const entry of TOOL_CATALOG) {
      expect(typeof entry.name).toBe('string');
      expect(entry.name.length).toBeGreaterThan(0);
      expect(entry.kind).toBe('native');
      expect(typeof entry.title).toBe('string');
      expect(entry.title.length).toBeGreaterThan(0);
      expect(typeof entry.description).toBe('string');
      expect(entry.description.length).toBeGreaterThan(0);
      expect(typeof entry.whenToUse).toBe('string');
      expect(entry.whenToUse.length).toBeGreaterThan(0);
      expect(typeof entry.embedSafe).toBe('boolean');
      expect(entry.embedSafe).toBe(true);
      expect(Array.isArray(entry.requiresConfig)).toBe(true);
      expect(entry.requiresConfig).toEqual(['WEB_WORKER_URL', 'WEB_WORKER_SECRET']);
      expect(entry.inputSchema).toMatchObject({ type: 'object' });
    }
  });

  it('name/description/inputSchema salen de NATIVE_TOOLS (fuente unica, misma referencia)', () => {
    for (const entry of TOOL_CATALOG) {
      const native = NATIVE_TOOLS.find((t) => t.name === entry.name);
      expect(native).toBeDefined();
      expect(entry.description).toBe(native!.description);
      // Misma referencia => no se re-tecleo ni se copio: es la def nativa.
      expect(entry.inputSchema).toBe(native!.inputSchema);
    }
  });
});

describe('resolveToolCatalog', () => {
  it('con WEB_WORKER_URL + WEB_WORKER_SECRET presentes: nativas available=true', () => {
    const resolved = resolveToolCatalog(envWith({ WEB_WORKER_URL: WORKER_URL, WEB_WORKER_SECRET: WORKER_SECRET }));
    expect(resolved.length).toBe(TOOL_CATALOG.length);
    for (const entry of resolved) {
      expect(entry.available).toBe(true);
    }
  });

  it('faltando WEB_WORKER_SECRET: nativas available=false', () => {
    const resolved = resolveToolCatalog(envWith({ WEB_WORKER_URL: WORKER_URL }));
    for (const entry of resolved) expect(entry.available).toBe(false);
  });

  it('faltando WEB_WORKER_URL: nativas available=false', () => {
    const resolved = resolveToolCatalog(envWith({ WEB_WORKER_SECRET: WORKER_SECRET }));
    for (const entry of resolved) expect(entry.available).toBe(false);
  });

  it('faltando ambas: nativas available=false', () => {
    const resolved = resolveToolCatalog(envWith({}));
    for (const entry of resolved) expect(entry.available).toBe(false);
  });

  it('no muta TOOL_CATALOG (agrega available sin tocar las entradas base)', () => {
    resolveToolCatalog(envWith({ WEB_WORKER_URL: WORKER_URL, WEB_WORKER_SECRET: WORKER_SECRET }));
    for (const entry of TOOL_CATALOG) {
      expect('available' in entry).toBe(false);
    }
  });
});

describe('WEBHOOK_TOOL_CAPABILITY', () => {
  it('describe la integracion custom server-side', () => {
    expect(WEBHOOK_TOOL_CAPABILITY.kind).toBe('webhook');
    expect(WEBHOOK_TOOL_CAPABILITY.embedSafe).toBe(true);
    expect(typeof WEBHOOK_TOOL_CAPABILITY.title).toBe('string');
    expect(typeof WEBHOOK_TOOL_CAPABILITY.description).toBe('string');
    expect(typeof WEBHOOK_TOOL_CAPABILITY.whenToUse).toBe('string');
  });

  it('requiredFields refleja las reglas reales de StoredToolSchema', () => {
    const ruleFor = (field: string): string =>
      WEBHOOK_TOOL_CAPABILITY.requiredFields.find((f) => f.field === field)?.rule ?? '';
    const presentes = WEBHOOK_TOOL_CAPABILITY.requiredFields.map((f) => f.field).sort();
    expect(presentes).toEqual(['description', 'inputSchema', 'name', 'url']);
    // name: prefijo reservado de plataforma prohibido.
    expect(ruleFor('name')).toContain(NATIVE_TOOL_PREFIX);
    // url: https obligatorio.
    expect(ruleFor('url')).toContain('https');
    // inputSchema: objeto JSON Schema.
    expect(ruleFor('inputSchema').toLowerCase()).toContain('json schema');
  });
});

/** Copia de la metadata real (no exportada): la reconstruimos para los tests de drift. */
function metaReal(): Record<string, { title: string; whenToUse: string; requiresConfig: string[] }> {
  const meta: Record<string, { title: string; whenToUse: string; requiresConfig: string[] }> = {};
  for (const entry of TOOL_CATALOG) {
    meta[entry.name] = { title: entry.title, whenToUse: entry.whenToUse, requiresConfig: entry.requiresConfig };
  }
  return meta;
}
