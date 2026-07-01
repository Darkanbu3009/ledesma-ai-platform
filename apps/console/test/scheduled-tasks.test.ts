import { describe, expect, it } from 'vitest';
import {
  toScheduledTaskApiInput,
  validateScheduledTaskDraft,
  type ScheduledTaskDraft,
} from '../src/lib/scheduled-tasks';

const draft = (overrides: Partial<ScheduledTaskDraft>): ScheduledTaskDraft => ({
  agentId: 'agent-1',
  credentialId: 'cred-1',
  message: 'Genera el resumen diario',
  cronExpression: '0 8 * * *',
  ...overrides,
});

describe('validateScheduledTaskDraft', () => {
  it('no devuelve errores cuando el borrador esta completo y el cron es valido', () => {
    expect(validateScheduledTaskDraft(draft({}))).toEqual({});
  });

  it('marca el agente faltante', () => {
    expect(validateScheduledTaskDraft(draft({ agentId: '' })).agentId).toBeDefined();
  });

  it('marca la credencial faltante', () => {
    expect(validateScheduledTaskDraft(draft({ credentialId: '' })).credentialId).toBeDefined();
  });

  it('marca el mensaje vacio (incluso con solo espacios)', () => {
    expect(validateScheduledTaskDraft(draft({ message: '   ' })).message).toBeDefined();
  });

  it('marca un cron invalido (modo avanzado con formato malo)', () => {
    expect(validateScheduledTaskDraft(draft({ cronExpression: 'no valido' })).cronExpression).toBeDefined();
    expect(validateScheduledTaskDraft(draft({ cronExpression: '' })).cronExpression).toBeDefined();
  });

  it('acumula varios errores a la vez', () => {
    const errors = validateScheduledTaskDraft(
      draft({ agentId: '', credentialId: '', message: '', cronExpression: 'x' }),
    );
    expect(Object.keys(errors).sort()).toEqual([
      'agentId',
      'credentialId',
      'cronExpression',
      'message',
    ]);
  });
});

describe('toScheduledTaskApiInput', () => {
  it('mapea el borrador al body del POST con un mensaje de rol user', () => {
    const input = toScheduledTaskApiInput(
      draft({
        agentId: 'a-uuid',
        credentialId: 'c-uuid',
        message: 'Hola',
        cronExpression: '0 8 * * *',
      }),
    );
    expect(input).toEqual({
      agentId: 'a-uuid',
      credentialId: 'c-uuid',
      cronExpression: '0 8 * * *',
      payload: { messages: [{ role: 'user', content: 'Hola' }] },
    });
  });

  it('recorta espacios del mensaje y del cron', () => {
    const input = toScheduledTaskApiInput(
      draft({ message: '  con espacios  ', cronExpression: '  0 8 * * *  ' }),
    );
    expect(input.cronExpression).toBe('0 8 * * *');
    expect(input.payload.messages[0]?.content).toBe('con espacios');
  });
});
