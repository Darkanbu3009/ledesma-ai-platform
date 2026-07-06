import { describe, it, expect } from 'vitest';
import {
  accountTypeLabel,
  buildAdminUsersQuery,
  changeTierErrorMessage,
  formatUserDate,
  roleLabel,
  tierLabel,
  tierMeta,
  TIER_ORDER,
} from '../src/lib/admin';

describe('buildAdminUsersQuery', () => {
  it('arma limit y offset', () => {
    expect(buildAdminUsersQuery({ limit: 20, offset: 0 })).toBe('?limit=20&offset=0');
    expect(buildAdminUsersQuery({ limit: 20, offset: 40 })).toBe('?limit=20&offset=40');
  });

  it('agrega search codificado cuando hay termino', () => {
    const q = buildAdminUsersQuery({ limit: 20, offset: 0, search: 'ada@example.com' });
    expect(q).toContain('search=ada%40example.com');
  });

  it('recorta el termino y codifica los espacios internos', () => {
    expect(buildAdminUsersQuery({ limit: 20, offset: 0, search: '  ada lovelace  ' })).toContain(
      'search=ada+lovelace',
    );
  });

  it('omite search cuando es vacio o solo espacios (no filtra por vacio)', () => {
    expect(buildAdminUsersQuery({ limit: 20, offset: 0, search: '' })).toBe('?limit=20&offset=0');
    expect(buildAdminUsersQuery({ limit: 20, offset: 0, search: '   ' })).toBe('?limit=20&offset=0');
    expect(buildAdminUsersQuery({ limit: 20, offset: 0 })).toBe('?limit=20&offset=0');
  });
});

describe('tierMeta / tierLabel', () => {
  it('cubre los tres tiers con etiqueta y tono', () => {
    expect(TIER_ORDER).toEqual(['free', 'pro', 'autonomous']);
    expect(tierLabel('free')).toBe('Free');
    expect(tierLabel('pro')).toBe('Pro');
    expect(tierLabel('autonomous')).toBe('Autónomo');
    for (const tier of TIER_ORDER) {
      expect(tierMeta(tier).tone.length).toBeGreaterThan(0);
    }
  });
});

describe('etiquetas de tipo de cuenta y rol', () => {
  it('mapea el tipo de cuenta', () => {
    expect(accountTypeLabel('individual')).toBe('Individual');
    expect(accountTypeLabel('empresa_member')).toBe('Empresa');
  });

  it('mapea el rol', () => {
    expect(roleLabel('individual')).toBe('Individual');
    expect(roleLabel('org_admin')).toBe('Admin de organización');
  });
});

describe('formatUserDate', () => {
  it('formatea una fecha ISO a es-MX (mes y ano)', () => {
    const out = formatUserDate('2026-06-10T12:00:00.000Z');
    expect(out).toMatch(/jun/);
    expect(out).toMatch(/2026/);
  });

  it('devuelve la entrada tal cual si la fecha es invalida', () => {
    expect(formatUserDate('no-es-fecha')).toBe('no-es-fecha');
  });
});

describe('changeTierErrorMessage', () => {
  it('403 -> falta de permiso', () => {
    expect(changeTierErrorMessage({ status: 403 })).toMatch(/permiso/i);
  });

  it('404 -> usuario inexistente', () => {
    expect(changeTierErrorMessage({ status: 404 })).toMatch(/no existe|no encontramos/i);
  });

  it('otros estados o errores sin status -> mensaje generico reintentable', () => {
    expect(changeTierErrorMessage({ status: 500 })).toMatch(/no pudimos/i);
    expect(changeTierErrorMessage(new Error('boom'))).toMatch(/no pudimos/i);
    expect(changeTierErrorMessage(null)).toMatch(/no pudimos/i);
  });
});
