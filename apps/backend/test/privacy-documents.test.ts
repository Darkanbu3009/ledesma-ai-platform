import { describe, it, expect } from 'vitest';
import {
  CURRENT_DOCUMENT_VERSIONS,
  DOCUMENT_TYPES,
  isDocumentType,
  missingConsents,
  type DocumentType,
} from '../src/privacy/documents.js';

describe('privacy/documents', () => {
  describe('isDocumentType', () => {
    it('reconoce los tipos validos y rechaza el resto', () => {
      expect(isDocumentType('privacy_notice')).toBe(true);
      expect(isDocumentType('terms')).toBe(true);
      expect(isDocumentType('otro')).toBe(false);
      expect(isDocumentType(null)).toBe(false);
      expect(isDocumentType(42)).toBe(false);
    });
  });

  describe('missingConsents', () => {
    it('sin ningun consentimiento -> faltan TODOS los documentos vigentes', () => {
      const missing = missingConsents(new Map());
      expect(missing).toEqual([...DOCUMENT_TYPES]);
    });

    it('con la version VIGENTE aceptada -> no falta ese documento', () => {
      const accepted = new Map<DocumentType, Set<string>>([
        ['privacy_notice', new Set([CURRENT_DOCUMENT_VERSIONS.privacy_notice])],
        ['terms', new Set([CURRENT_DOCUMENT_VERSIONS.terms])],
      ]);
      expect(missingConsents(accepted)).toEqual([]);
    });

    it('con una version VIEJA aceptada -> el documento sigue faltando (re-aceptar por cambio de version)', () => {
      const accepted = new Map<DocumentType, Set<string>>([
        ['privacy_notice', new Set(['1900-01-01'])],
        ['terms', new Set([CURRENT_DOCUMENT_VERSIONS.terms])],
      ]);
      // privacy_notice acepto una version distinta a la vigente -> falta; terms esta al dia -> no falta.
      expect(missingConsents(accepted)).toEqual(['privacy_notice']);
    });
  });
});
