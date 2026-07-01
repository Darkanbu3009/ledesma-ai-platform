import { describe, it, expect } from 'vitest';
import { DEFAULT_AI_NOTICE, isSafeDisclosureUrl, resolveAiNotice } from '../src/ai-disclosure.js';

describe('ai-disclosure', () => {
  describe('resolveAiNotice', () => {
    it('sin atributo -> divulgacion por defecto (SIEMPRE presente)', () => {
      expect(resolveAiNotice(null)).toBe(DEFAULT_AI_NOTICE);
      expect(resolveAiNotice(undefined)).toBe(DEFAULT_AI_NOTICE);
    });

    it('atributo vacio o solo espacios -> divulgacion por defecto (no puede desaparecer)', () => {
      expect(resolveAiNotice('')).toBe(DEFAULT_AI_NOTICE);
      expect(resolveAiNotice('   ')).toBe(DEFAULT_AI_NOTICE);
    });

    it('atributo con texto -> usa ese texto (configurable)', () => {
      expect(resolveAiNotice('Chat impulsado por IA')).toBe('Chat impulsado por IA');
    });

    it('la divulgacion por defecto menciona que es IA', () => {
      expect(DEFAULT_AI_NOTICE.toLowerCase()).toContain('ia');
    });
  });

  describe('isSafeDisclosureUrl', () => {
    it('acepta http(s) absolutas y rutas relativas', () => {
      expect(isSafeDisclosureUrl('https://ejemplo.com/privacidad')).toBe(true);
      expect(isSafeDisclosureUrl('http://ejemplo.com')).toBe(true);
      expect(isSafeDisclosureUrl('/aviso-de-privacidad')).toBe(true);
    });

    it('rechaza esquemas peligrosos y valores vacios', () => {
      expect(isSafeDisclosureUrl('javascript:alert(1)')).toBe(false);
      expect(isSafeDisclosureUrl('data:text/html,x')).toBe(false);
      expect(isSafeDisclosureUrl('')).toBe(false);
      expect(isSafeDisclosureUrl(null)).toBe(false);
      expect(isSafeDisclosureUrl(undefined)).toBe(false);
    });
  });
});
