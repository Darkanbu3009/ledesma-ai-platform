import { describe, expect, it } from 'vitest';
import {
  deleteAccountErrorMessage,
  emailConfirmationMatches,
  normalizeConfirmEmail,
} from '../src/lib/account';

describe('normalizeConfirmEmail', () => {
  it('recorta y baja a minusculas (misma regla que el backend)', () => {
    expect(normalizeConfirmEmail('  Ada@Example.com  ')).toBe('ada@example.com');
  });
});

describe('emailConfirmationMatches (barrera de intencion de la UI)', () => {
  it('coincide ignorando mayusculas y espacios alrededor', () => {
    expect(emailConfirmationMatches('  ADA@example.COM ', 'ada@example.com')).toBe(true);
  });

  it('no coincide cuando el email escrito es distinto', () => {
    expect(emailConfirmationMatches('otra@example.com', 'ada@example.com')).toBe(false);
  });

  it('fail-closed: nunca coincide si no hay email esperado (undefined/null)', () => {
    expect(emailConfirmationMatches('ada@example.com', undefined)).toBe(false);
    expect(emailConfirmationMatches('ada@example.com', null)).toBe(false);
  });

  it('fail-closed: un email esperado vacio (o en blanco) nunca coincide, ni con input vacio', () => {
    expect(emailConfirmationMatches('', '')).toBe(false);
    expect(emailConfirmationMatches('   ', '   ')).toBe(false);
  });
});

describe('deleteAccountErrorMessage', () => {
  it('400 -> mensaje de email que no coincide (caso esperado)', () => {
    expect(deleteAccountErrorMessage({ status: 400 })).toMatch(/no coincide/i);
  });

  it('401 -> sesion expirada', () => {
    expect(deleteAccountErrorMessage({ status: 401 })).toMatch(/sesión expiró/i);
  });

  it('otros / desconocido -> mensaje generico reintentable', () => {
    expect(deleteAccountErrorMessage({ status: 500 })).toMatch(/no pudimos eliminar tu cuenta/i);
    expect(deleteAccountErrorMessage(new Error('boom'))).toMatch(/no pudimos eliminar tu cuenta/i);
    expect(deleteAccountErrorMessage(null)).toMatch(/no pudimos eliminar tu cuenta/i);
  });
});
