import { describe, expect, it } from 'vitest';
import {
  hasActiveUpgradeRequest,
  requestUpgradeErrorMessage,
  type MyUpgradeRequestsState,
  type UpgradeRequest,
} from '../src/lib/upgrade-requests';

function req(overrides: Partial<UpgradeRequest> = {}): UpgradeRequest {
  return {
    id: 'r1',
    ownerId: 'u1',
    requestedTier: 'autonomous',
    featureContext: 'triggers',
    status: 'pending',
    note: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function state(requests: UpgradeRequest[]): MyUpgradeRequestsState {
  return { upgradeRequests: requests };
}

describe('hasActiveUpgradeRequest', () => {
  it('es false sin datos o sin solicitudes', () => {
    expect(hasActiveUpgradeRequest(undefined)).toBe(false);
    expect(hasActiveUpgradeRequest(state([]))).toBe(false);
  });

  it('es true con una solicitud pending del tier autonomous (lead vivo)', () => {
    expect(hasActiveUpgradeRequest(state([req({ status: 'pending' })]))).toBe(true);
  });

  it('es true con contacted (el equipo la esta gestionando): no re-ofrecer el boton', () => {
    expect(hasActiveUpgradeRequest(state([req({ status: 'contacted' })]))).toBe(true);
  });

  it('es false con converted o declined (gate resuelto / permite volver a pedir)', () => {
    expect(hasActiveUpgradeRequest(state([req({ status: 'converted' })]))).toBe(false);
    expect(hasActiveUpgradeRequest(state([req({ status: 'declined' })]))).toBe(false);
  });

  it('ignora solicitudes de otro tier (matchea el tier pedido)', () => {
    expect(hasActiveUpgradeRequest(state([req({ requestedTier: 'pro', status: 'pending' })]))).toBe(
      false,
    );
    expect(
      hasActiveUpgradeRequest(state([req({ requestedTier: 'pro', status: 'pending' })]), 'pro'),
    ).toBe(true);
  });
});

describe('requestUpgradeErrorMessage', () => {
  it('mapea 401 a sesion expirada', () => {
    expect(requestUpgradeErrorMessage({ status: 401 })).toMatch(/sesion expiro/i);
  });

  it('mapea 400 a un mensaje de solicitud no registrada', () => {
    expect(requestUpgradeErrorMessage({ status: 400 })).toMatch(/No pudimos registrar/i);
  });

  it('cae a un mensaje generico reintentable sin status', () => {
    expect(requestUpgradeErrorMessage(new Error('boom'))).toMatch(/No pudimos enviar/i);
    expect(requestUpgradeErrorMessage(null)).toMatch(/No pudimos enviar/i);
  });
});
