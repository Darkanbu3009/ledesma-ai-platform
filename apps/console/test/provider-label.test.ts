import { describe, it, expect } from 'vitest';
import { playgroundPath, providerLabel } from '../src/lib/agents';

describe('providerLabel', () => {
  it('mapea los proveedores conocidos a etiquetas legibles', () => {
    expect(providerLabel('anthropic')).toBe('Anthropic');
    expect(providerLabel('openai')).toBe('OpenAI');
    expect(providerLabel('openai-compatible')).toBe('Compatible (OpenAI)');
  });
});

describe('playgroundPath', () => {
  it('apunta al Playground del agente recien creado usando su id real', () => {
    // Destino de la accion "Usar agente": los flujos asistente, autonomo y manual redirigen
    // aqui tras crear, y la tarjeta de la lista lo usa para su boton primario.
    expect(playgroundPath('agent-123')).toBe('/agentes/agent-123/playground');
  });

  it('no asume un formato de id concreto', () => {
    expect(playgroundPath('ag_AbC-9')).toBe('/agentes/ag_AbC-9/playground');
  });
});
