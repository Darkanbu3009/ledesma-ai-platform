import { describe, expect, it } from 'vitest';
import {
  DEFAULT_AUTH_MODE,
  authModeLabel,
  revealFromCreate,
  revealFromUpdate,
  toTriggerApiInput,
  validateTriggerDraft,
  type CreateTriggerResponse,
  type HmacSignatureInfo,
  type Trigger,
  type TriggerAuthMode,
  type TriggerDraft,
  type UpdateTriggerResponse,
} from '../src/lib/triggers';

const draft = (overrides: Partial<TriggerDraft> = {}): TriggerDraft => ({
  agentId: 'agent-1',
  credentialId: 'cred-1',
  message: 'Procesa el evento entrante',
  authMode: 'hmac',
  ...overrides,
});

const SIGNATURE: HmacSignatureInfo = {
  algorithm: 'HMAC-SHA256',
  signedPayload: '{timestamp}.{rawBody}',
  signatureFormat: 'v1=<hexdigest>',
  timestampHeader: 'x-ledesma-timestamp',
  signatureHeader: 'x-ledesma-signature',
  toleranceSeconds: 300,
};

const trigger = (overrides: Partial<Trigger> = {}): Trigger => ({
  id: 'trigger-1',
  ownerId: 'owner-1',
  agentId: 'agent-1',
  credentialId: 'cred-1',
  authMode: 'hmac',
  payloadTemplate: { messages: [{ role: 'user', content: 'hola' }] },
  isActive: true,
  lastTriggeredAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  webhookUrl: 'https://api.test/webhooks/triggers/trigger-1',
  ...overrides,
});

describe('DEFAULT_AUTH_MODE', () => {
  it('es HMAC (recomendado, mas seguro)', () => {
    expect(DEFAULT_AUTH_MODE).toBe<TriggerAuthMode>('hmac');
  });
});

describe('validateTriggerDraft', () => {
  it('no devuelve errores cuando el borrador esta completo', () => {
    expect(validateTriggerDraft(draft())).toEqual({});
    expect(validateTriggerDraft(draft({ authMode: 'url_token' }))).toEqual({});
  });

  it('marca el agente faltante', () => {
    expect(validateTriggerDraft(draft({ agentId: '' })).agentId).toBeDefined();
  });

  it('marca la credencial faltante', () => {
    expect(validateTriggerDraft(draft({ credentialId: '' })).credentialId).toBeDefined();
  });

  it('marca el mensaje vacio (incluso con solo espacios)', () => {
    expect(validateTriggerDraft(draft({ message: '   ' })).message).toBeDefined();
  });

  it('marca un authMode invalido', () => {
    expect(
      validateTriggerDraft(draft({ authMode: 'otro' as TriggerAuthMode })).authMode,
    ).toBeDefined();
  });

  it('acumula varios errores a la vez', () => {
    const errors = validateTriggerDraft(
      draft({ agentId: '', credentialId: '', message: '', authMode: 'x' as TriggerAuthMode }),
    );
    expect(Object.keys(errors).sort()).toEqual(['agentId', 'authMode', 'credentialId', 'message']);
  });
});

describe('toTriggerApiInput', () => {
  it('mapea el borrador al body del POST con un mensaje de rol user y el authMode elegido', () => {
    expect(
      toTriggerApiInput(
        draft({ agentId: 'a-uuid', credentialId: 'c-uuid', message: 'Hola', authMode: 'url_token' }),
      ),
    ).toEqual({
      agentId: 'a-uuid',
      credentialId: 'c-uuid',
      authMode: 'url_token',
      payloadTemplate: { messages: [{ role: 'user', content: 'Hola' }] },
    });
  });

  it('recorta espacios del mensaje', () => {
    const input = toTriggerApiInput(draft({ message: '  con espacios  ' }));
    expect(input.payloadTemplate.messages[0]?.content).toBe('con espacios');
  });
});

describe('authModeLabel', () => {
  it('etiqueta cada modo', () => {
    expect(authModeLabel('hmac')).toBe('HMAC (firma)');
    expect(authModeLabel('url_token')).toBe('Token en URL');
  });
});

describe('revealFromCreate', () => {
  it('arma el reveal de un trigger hmac con secreto, URL y firma', () => {
    const res: CreateTriggerResponse = {
      trigger: trigger({ authMode: 'hmac', signature: SIGNATURE }),
      webhookUrl: 'https://api.test/webhooks/triggers/trigger-1',
      hmacSecret: 'deadbeef',
      signature: SIGNATURE,
    };
    expect(revealFromCreate(res)).toEqual({
      authMode: 'hmac',
      webhookUrl: 'https://api.test/webhooks/triggers/trigger-1',
      hmacSecret: 'deadbeef',
      signature: SIGNATURE,
    });
  });

  it('arma el reveal de un trigger url_token con la URL que lleva el token', () => {
    const res: CreateTriggerResponse = {
      trigger: trigger({ authMode: 'url_token' }),
      webhookUrl: 'https://api.test/webhooks/triggers/trigger-1?token=abc',
      urlToken: 'abc',
    };
    expect(revealFromCreate(res)).toEqual({
      authMode: 'url_token',
      webhookUrl: 'https://api.test/webhooks/triggers/trigger-1?token=abc',
    });
  });

  it('devuelve null si falta el material de auth esperado', () => {
    const hmacSinSecreto: CreateTriggerResponse = {
      trigger: trigger({ authMode: 'hmac' }),
      webhookUrl: 'https://api.test/webhooks/triggers/trigger-1',
    };
    expect(revealFromCreate(hmacSinSecreto)).toBeNull();

    const tokenSinToken: CreateTriggerResponse = {
      trigger: trigger({ authMode: 'url_token' }),
      webhookUrl: 'https://api.test/webhooks/triggers/trigger-1',
    };
    expect(revealFromCreate(tokenSinToken)).toBeNull();
  });
});

describe('revealFromUpdate', () => {
  it('arma el reveal al rotar un hmac (la firma viaja en trigger.signature)', () => {
    const res: UpdateTriggerResponse = {
      trigger: trigger({ authMode: 'hmac', signature: SIGNATURE }),
      hmacSecret: 'nuevo-secreto',
    };
    expect(revealFromUpdate(res)).toEqual({
      authMode: 'hmac',
      webhookUrl: 'https://api.test/webhooks/triggers/trigger-1',
      hmacSecret: 'nuevo-secreto',
      signature: SIGNATURE,
    });
  });

  it('arma el reveal al rotar un url_token con la URL nueva', () => {
    const res: UpdateTriggerResponse = {
      trigger: trigger({ authMode: 'url_token' }),
      urlToken: 'nuevo-token',
      webhookUrl: 'https://api.test/webhooks/triggers/trigger-1?token=nuevo-token',
    };
    expect(revealFromUpdate(res)).toEqual({
      authMode: 'url_token',
      webhookUrl: 'https://api.test/webhooks/triggers/trigger-1?token=nuevo-token',
    });
  });

  it('devuelve null cuando el PATCH solo activo/pauso (sin rotar)', () => {
    const soloToggle: UpdateTriggerResponse = {
      trigger: trigger({ authMode: 'hmac', signature: SIGNATURE, isActive: false }),
    };
    expect(revealFromUpdate(soloToggle)).toBeNull();

    const soloToggleToken: UpdateTriggerResponse = {
      trigger: trigger({ authMode: 'url_token', isActive: false }),
    };
    expect(revealFromUpdate(soloToggleToken)).toBeNull();
  });
});
