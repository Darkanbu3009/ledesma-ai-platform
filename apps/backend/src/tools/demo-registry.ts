import { z } from 'zod';
import { ToolRegistry } from './tool-registry.js';

/**
 * Registro DEMO de tools para P2.3. Provee una tool determinista y segura (sin red) para poder
 * ejercitar el ciclo de tools end-to-end. En P3.1 se reemplaza por las tools que vengan de la
 * configuracion del agente almacenada.
 */
export function createDemoRegistry(): ToolRegistry {
  return new ToolRegistry().register({
    name: 'get_current_time',
    description: 'Returns the current server time as an ISO 8601 string. Takes no input.',
    inputSchema: z.object({}),
    handler: () => new Date().toISOString(),
  });
}
