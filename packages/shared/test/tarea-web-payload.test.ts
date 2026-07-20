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

  it('el kind exportado coincide con el literal del payload', () => {
    expect(TAREA_WEB_JOB_KIND).toBe('tarea_web');
  });
});
