import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { ToolRegistry } from '../src/tools/index.js';
import type { ToolCall } from '../src/agent/index.js';

function makeRegistry() {
  return new ToolRegistry().register({
    name: 'cotizar',
    description: 'Calcula el precio de N piezas',
    inputSchema: z.object({ piezas: z.number().int().positive() }),
    handler: (input) => `precio: ${input.piezas * 150} MXN`,
  });
}

describe('ToolRegistry', () => {
  it('ejecuta una tool con input valido y devuelve el resultado', async () => {
    const registry = makeRegistry();
    const result = await registry.execute({ id: 't1', name: 'cotizar', input: { piezas: 10 } });
    expect(result).toEqual({ content: 'precio: 1500 MXN', isError: false });
  });

  it('devuelve isError si la tool no existe', async () => {
    const registry = makeRegistry();
    const result = await registry.execute({ id: 't1', name: 'inexistente', input: {} });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Unknown tool: inexistente');
  });

  it('valida el input con zod y NO ejecuta el handler si es invalido', async () => {
    const handler = vi.fn(() => 'no deberia correr');
    const registry = new ToolRegistry().register({
      name: 'cotizar',
      description: 'x',
      inputSchema: z.object({ piezas: z.number().int().positive() }),
      handler,
    });
    const result = await registry.execute({ id: 't1', name: 'cotizar', input: { piezas: -5 } });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Invalid input for tool cotizar');
    expect(handler).not.toHaveBeenCalled();
  });

  it('captura una excepcion del handler y la devuelve como isError sin propagar', async () => {
    const registry = new ToolRegistry().register({
      name: 'rompe',
      description: 'x',
      inputSchema: z.object({}),
      handler: () => {
        throw new Error('boom interno');
      },
    });
    const result = await registry.execute({ id: 't1', name: 'rompe', input: {} });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Tool rompe failed');
    expect(result.content).toContain('boom interno');
  });

  it('acepta un handler que devuelve el objeto completo { content, isError }', async () => {
    const registry = new ToolRegistry().register({
      name: 'manual',
      description: 'x',
      inputSchema: z.object({}),
      handler: () => ({ content: 'controlado', isError: true }),
    });
    const result = await registry.execute({ id: 't1', name: 'manual', input: {} });
    expect(result).toEqual({ content: 'controlado', isError: true });
  });

  it('lanza al registrar dos tools con el mismo nombre', () => {
    const registry = makeRegistry();
    expect(() =>
      registry.register({
        name: 'cotizar',
        description: 'dup',
        inputSchema: z.object({}),
        handler: () => 'x',
      }),
    ).toThrow('tool already registered: cotizar');
  });

  it('toToolDefinitions produce JSON Schema usable para el modelo', () => {
    const registry = makeRegistry();
    const defs = registry.toToolDefinitions();
    expect(defs).toHaveLength(1);
    expect(defs[0]?.name).toBe('cotizar');
    expect(defs[0]?.description).toBe('Calcula el precio de N piezas');
    const schema = defs[0]?.inputSchema as Record<string, unknown>;
    expect(schema.type).toBe('object');
    expect(schema).toHaveProperty('properties');
    const properties = schema.properties as Record<string, unknown>;
    expect(properties).toHaveProperty('piezas');
  });

  it('toExecutor produce un ToolExecutor que valida y ejecuta', async () => {
    const registry = makeRegistry();
    const executor = registry.toExecutor();
    const call: ToolCall = { id: 't1', name: 'cotizar', input: { piezas: 2 } };
    const result = await executor(call);
    expect(result).toEqual({ content: 'precio: 300 MXN', isError: false });
  });

  it('pasa el AbortSignal al handler', async () => {
    const handler = vi.fn<(input: unknown, signal?: AbortSignal) => string>(() => 'ok');
    const registry = new ToolRegistry().register({
      name: 'conSignal',
      description: 'x',
      inputSchema: z.object({}),
      handler,
    });
    const controller = new AbortController();
    await registry.execute({ id: 't1', name: 'conSignal', input: {} }, controller.signal);
    expect(handler.mock.calls[0]?.[1]).toBe(controller.signal);
  });
});
