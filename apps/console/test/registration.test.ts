import { describe, it, expect } from 'vitest';
import {
  classifyRegistration,
  validateName,
  NAME_MAX_LENGTH,
  type Organization,
  type Profile,
  type RegistrationState,
} from '../src/lib/registration';

const individualProfile: Profile = {
  id: 'u1',
  orgId: null,
  accountType: 'individual',
  role: 'individual',
  fullName: 'Ada',
  identityVerified: false,
  tier: 'free',
  createdAt: 'x',
  updatedAt: 'x',
};

const empresaProfile: Profile = {
  id: 'u1',
  orgId: 'org-1',
  accountType: 'empresa_member',
  role: 'org_admin',
  fullName: 'Ada',
  identityVerified: false,
  tier: 'free',
  createdAt: 'x',
  updatedAt: 'x',
};

function org(status: string): Organization {
  return { id: 'org-1', name: 'Acme', status, approvedAt: null, createdAt: 'x', updatedAt: 'x' };
}

function state(over: Partial<RegistrationState>): RegistrationState {
  return {
    needsRegistration: false,
    profile: null,
    organization: null,
    subscription: null,
    usageCounter: null,
    ...over,
  };
}

describe('classifyRegistration', () => {
  it('needs-registration cuando el backend marca needsRegistration', () => {
    expect(classifyRegistration(state({ needsRegistration: true }))).toBe('needs-registration');
  });

  it('needs-registration cuando no hay perfil', () => {
    expect(classifyRegistration(state({ needsRegistration: false, profile: null }))).toBe(
      'needs-registration',
    );
  });

  it('active para un individuo con perfil', () => {
    expect(classifyRegistration(state({ profile: individualProfile }))).toBe('active');
  });

  it('pending para una empresa con organizacion pendiente', () => {
    expect(
      classifyRegistration(state({ profile: empresaProfile, organization: org('pending') })),
    ).toBe('pending');
  });

  it('active para una empresa con organizacion aprobada', () => {
    expect(
      classifyRegistration(state({ profile: empresaProfile, organization: org('approved') })),
    ).toBe('active');
  });

  it('pending para una empresa sin organizacion cargada (defensivo)', () => {
    expect(classifyRegistration(state({ profile: empresaProfile, organization: null }))).toBe(
      'pending',
    );
  });

  it('pending para una empresa con cualquier estado distinto de approved', () => {
    expect(
      classifyRegistration(state({ profile: empresaProfile, organization: org('rejected') })),
    ).toBe('pending');
  });
});

describe('validateName', () => {
  it('rechaza un valor vacio', () => {
    expect(validateName('')).toMatch(/obligatorio/);
  });

  it('rechaza un valor de solo espacios', () => {
    expect(validateName('   ')).toMatch(/obligatorio/);
  });

  it('rechaza nombres mas largos que el limite', () => {
    expect(validateName('a'.repeat(NAME_MAX_LENGTH + 1))).toMatch(/caracteres/);
  });

  it('acepta un nombre valido y recorta los espacios al medir', () => {
    expect(validateName('  Ada Lovelace  ')).toBeUndefined();
  });

  it('acepta exactamente el limite de caracteres', () => {
    expect(validateName('a'.repeat(NAME_MAX_LENGTH))).toBeUndefined();
  });
});
