import { describe, it, expect } from 'vitest';
import {
  dominioDeUrl,
  isRecipeJobPayload,
  isSitioJobPayload,
  parseSitioJobPayload,
} from '../src/index.js';

describe('isSitioJobPayload (discriminador)', () => {
  it('true solo para los tres kinds de sitios', () => {
    expect(isSitioJobPayload({ kind: 'conectar_sitio', url: 'https://a.com' })).toBe(true);
    expect(isSitioJobPayload({ kind: 'confirmar_conexion', connectionId: 'c1' })).toBe(true);
    expect(isSitioJobPayload({ kind: 'desconectar_sitio', connectionId: 'c1' })).toBe(true);
  });

  it('false para jobs simples, recetas y basura (formas mutuamente excluyentes)', () => {
    expect(isSitioJobPayload({ messages: [{ role: 'user', content: 'hola' }] })).toBe(false);
    expect(isSitioJobPayload({ kind: 'recipe', recipeId: 'r1', steps: [{ message: 'x' }] })).toBe(false);
    expect(isSitioJobPayload(null)).toBe(false);
    expect(isSitioJobPayload('conectar_sitio')).toBe(false);
    // Y al reves: un payload de sitio jamas es de receta.
    expect(isRecipeJobPayload({ kind: 'conectar_sitio', url: 'https://a.com' })).toBe(false);
  });
});

describe('parseSitioJobPayload', () => {
  it('conectar_sitio exige una URL http(s) valida y un pais ISO-2', () => {
    const ok = parseSitioJobPayload({ kind: 'conectar_sitio', url: 'https://app.ejemplo.com/login', pais: 'AR' });
    expect(ok).toEqual({
      success: true,
      data: { kind: 'conectar_sitio', url: 'https://app.ejemplo.com/login', pais: 'AR' },
    });
    expect(parseSitioJobPayload({ kind: 'conectar_sitio', url: '', pais: 'AR' }).success).toBe(false);
    expect(parseSitioJobPayload({ kind: 'conectar_sitio', url: 'no-una-url', pais: 'AR' }).success).toBe(false);
    expect(parseSitioJobPayload({ kind: 'conectar_sitio', url: 'ftp://x.com', pais: 'AR' }).success).toBe(false);
    expect(parseSitioJobPayload({ kind: 'conectar_sitio' }).success).toBe(false);
  });

  it('conectar_sitio valida el pais y lo NORMALIZA a mayusculas (es lo que se pinea y compara)', () => {
    const ok = parseSitioJobPayload({ kind: 'conectar_sitio', url: 'https://a.com/l', pais: 'ar' });
    expect(ok.success).toBe(true);
    if (ok.success && ok.data.kind === 'conectar_sitio') {
      expect(ok.data.pais).toBe('AR');
    }
    expect(parseSitioJobPayload({ kind: 'conectar_sitio', url: 'https://a.com/l' }).success).toBe(false);
    expect(parseSitioJobPayload({ kind: 'conectar_sitio', url: 'https://a.com/l', pais: 'ARG' }).success).toBe(false);
    expect(parseSitioJobPayload({ kind: 'conectar_sitio', url: 'https://a.com/l', pais: 'A1' }).success).toBe(false);
    expect(parseSitioJobPayload({ kind: 'conectar_sitio', url: 'https://a.com/l', pais: '' }).success).toBe(false);
  });

  it('confirmar/desconectar exigen connectionId no vacio', () => {
    expect(parseSitioJobPayload({ kind: 'confirmar_conexion', connectionId: 'c1' })).toEqual({
      success: true,
      data: { kind: 'confirmar_conexion', connectionId: 'c1' },
    });
    expect(parseSitioJobPayload({ kind: 'desconectar_sitio', connectionId: 'c1' }).success).toBe(true);
    expect(parseSitioJobPayload({ kind: 'confirmar_conexion', connectionId: '' }).success).toBe(false);
    expect(parseSitioJobPayload({ kind: 'desconectar_sitio' }).success).toBe(false);
  });

  it('rechaza kinds ajenos y no-objetos sin lanzar', () => {
    expect(parseSitioJobPayload({ kind: 'recipe' }).success).toBe(false);
    expect(parseSitioJobPayload(42).success).toBe(false);
  });

  it('NINGUNA forma valida acepta (ni conserva) un campo de contrasena', () => {
    const conBasura = parseSitioJobPayload({
      kind: 'conectar_sitio',
      url: 'https://app.ejemplo.com/login',
      pais: 'AR',
      password: 'jamas',
    });
    expect(conBasura.success).toBe(true);
    if (conBasura.success) {
      expect(JSON.stringify(conBasura.data)).not.toContain('jamas');
      expect('password' in conBasura.data).toBe(false);
    }
  });
});

describe('dominioDeUrl', () => {
  it('deriva hostname en minusculas, sin puerto ni path', () => {
    expect(dominioDeUrl('https://App.Ejemplo.COM:8443/login?a=1')).toBe('app.ejemplo.com');
    expect(dominioDeUrl('http://sub.dominio.io/x')).toBe('sub.dominio.io');
  });
});
