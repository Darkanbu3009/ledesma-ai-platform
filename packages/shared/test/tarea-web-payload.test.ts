import { describe, it, expect } from 'vitest';
import {
  TAREA_WEB_JOB_KIND,
  TAREA_WEB_OBJETIVO_MAX_CHARS,
  isTareaWebJobPayload,
  parseTareaWebJobPayload,
} from '../src/jobs/tarea-web-payload.js';

const VALIDO = {
  kind: 'tarea_web',
  connectionId: '99999999-9999-4999-8999-999999999999',
  objetivo: 'dime que dice mi panel de agentes',
};

describe('isTareaWebJobPayload', () => {
  it('true para kind tarea_web', () => {
    expect(isTareaWebJobPayload(VALIDO)).toBe(true);
  });

  it('false para jobs simples, recetas, sitios y basura', () => {
    expect(isTareaWebJobPayload({ messages: [] })).toBe(false);
    expect(isTareaWebJobPayload({ kind: 'recipe' })).toBe(false);
    expect(isTareaWebJobPayload({ kind: 'conectar_sitio' })).toBe(false);
    expect(isTareaWebJobPayload(null)).toBe(false);
    expect(isTareaWebJobPayload('tarea_web')).toBe(false);
  });
});

describe('parseTareaWebJobPayload', () => {
  it('acepta un payload valido', () => {
    const parsed = parseTareaWebJobPayload(VALIDO);
    expect(parsed).toEqual({ success: true, data: VALIDO });
  });

  it('rechaza kind ajeno, connectionId vacio y objetivo vacio o solo espacios', () => {
    expect(parseTareaWebJobPayload({ ...VALIDO, kind: 'recipe' }).success).toBe(false);
    expect(parseTareaWebJobPayload({ ...VALIDO, connectionId: '' }).success).toBe(false);
    expect(parseTareaWebJobPayload({ ...VALIDO, objetivo: '' }).success).toBe(false);
    expect(parseTareaWebJobPayload({ ...VALIDO, objetivo: '   ' }).success).toBe(false);
    expect(parseTareaWebJobPayload({ ...VALIDO, connectionId: 42 }).success).toBe(false);
  });

  it('rechaza un objetivo que supera el tope de caracteres', () => {
    const parsed = parseTareaWebJobPayload({
      ...VALIDO,
      objetivo: 'x'.repeat(TAREA_WEB_OBJETIVO_MAX_CHARS + 1),
    });
    expect(parsed.success).toBe(false);
  });

  /** CAMBIO 3: el texto literal del usuario ACOMPANA al objetivo del modelo, no lo sustituye. */
  it('conserva textoUsuario cuando llega, y el objetivo del modelo sigue intacto', () => {
    const parsed = parseTareaWebJobPayload({ ...VALIDO, textoUsuario: 'dime que dice mi panel' });
    expect(parsed).toEqual({
      success: true,
      data: { ...VALIDO, textoUsuario: 'dime que dice mi panel' },
    });
  });

  it('un textoUsuario ausente o invalido NO invalida el job: se ignora y el worker cae al objetivo', () => {
    // Fallar el payload entero por un campo auxiliar dejaria sin ejecutar tareas que antes corrian.
    for (const textoUsuario of [undefined, '', '   ', 42, null, 'x'.repeat(TAREA_WEB_OBJETIVO_MAX_CHARS + 1)]) {
      expect(parseTareaWebJobPayload({ ...VALIDO, textoUsuario })).toEqual({
        success: true,
        data: VALIDO,
      });
    }
  });

  it('el kind exportado coincide con el literal del payload', () => {
    expect(TAREA_WEB_JOB_KIND).toBe('tarea_web');
  });
});
