import { describe, it, expect } from 'vitest';
import {
  COLUMN_TO_DOCUMENT_TYPE,
  CURRENT_DOCUMENT_VERSIONS,
  DOCUMENT_TYPE_TO_COLUMN,
  ENFORCED_DOCUMENT_TYPES,
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
    it('sin ningun consentimiento -> faltan TODOS los documentos EXIGIDOS', () => {
      const missing = missingConsents(new Map());
      expect(missing).toEqual([...ENFORCED_DOCUMENT_TYPES]);
    });

    it('se exigen AMBOS documentos: aviso de privacidad y terminos', () => {
      // Los dos estan publicados en ruta publica y son revisables antes de aceptar.
      expect(ENFORCED_DOCUMENT_TYPES).toEqual(['privacy_notice', 'terms']);
      expect(missingConsents(new Map())).toEqual(['privacy_notice', 'terms']);
    });

    it('aceptar SOLO el aviso deja los terminos pendientes (no libera el gate)', () => {
      const accepted = new Map<DocumentType, Set<string>>([
        ['privacy_notice', new Set([CURRENT_DOCUMENT_VERSIONS.privacy_notice])],
      ]);
      expect(missingConsents(accepted)).toEqual(['terms']);
    });

    it('con la version VIGENTE de AMBOS aceptada -> no falta nada', () => {
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

    it('SUBIR DE VERSION vuelve a pedir el documento a quien ya lo habia aceptado', () => {
      // El titular esta al dia con las dos versiones vigentes.
      const alDia = new Map<DocumentType, Set<string>>([
        ['privacy_notice', new Set([CURRENT_DOCUMENT_VERSIONS.privacy_notice])],
        ['terms', new Set([CURRENT_DOCUMENT_VERSIONS.terms])],
      ]);
      expect(missingConsents(alDia)).toEqual([]);
      // Simula el efecto de subir la version del aviso: lo aceptado pasa a ser una version anterior y el
      // documento vuelve a faltar, sin tocar la base ni correr ningun script.
      const traslaSubida = new Map<DocumentType, Set<string>>([
        ['privacy_notice', new Set(['2020-01-01'])],
        ['terms', new Set([CURRENT_DOCUMENT_VERSIONS.terms])],
      ]);
      expect(missingConsents(traslaSubida)).toEqual(['privacy_notice']);
    });
  });

  describe('vocabularios de documento', () => {
    it('el mapa a la columna `documento` y su inversa son consistentes', () => {
      for (const tipo of ENFORCED_DOCUMENT_TYPES) {
        expect(COLUMN_TO_DOCUMENT_TYPE[DOCUMENT_TYPE_TO_COLUMN[tipo]]).toBe(tipo);
      }
      // Los valores de la columna son los que exige el CHECK de la migracion V039.
      expect(DOCUMENT_TYPE_TO_COLUMN.privacy_notice).toBe('aviso_privacidad');
      expect(DOCUMENT_TYPE_TO_COLUMN.terms).toBe('terminos');
    });
  });
});
