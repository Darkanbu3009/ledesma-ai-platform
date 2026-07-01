import { describe, it, expect } from 'vitest';
import {
  hasPendingConsents,
  needsPrivacyConsent,
  pendingConsentBodies,
  requestStatusLabel,
  requestTypeLabel,
  PRIVACY_NOTICE_VERSION,
  TERMS_VERSION,
  SIMPLIFIED_NOTICE,
  INTEGRAL_NOTICE,
  type ConsentsState,
} from '../src/lib/privacy';

function makeState(missing: ConsentsState['missing']): ConsentsState {
  return {
    consents: [],
    current: { privacy_notice: PRIVACY_NOTICE_VERSION, terms: TERMS_VERSION },
    documentTypes: ['privacy_notice', 'terms'],
    missing,
  };
}

describe('privacy lib', () => {
  describe('needsPrivacyConsent / hasPendingConsents', () => {
    it('sin faltantes -> no requiere consentimiento', () => {
      const state = makeState([]);
      expect(needsPrivacyConsent(state)).toBe(false);
      expect(hasPendingConsents(state)).toBe(false);
    });

    it('con privacy_notice faltante -> requiere consentimiento', () => {
      const state = makeState(['privacy_notice']);
      expect(needsPrivacyConsent(state)).toBe(true);
      expect(hasPendingConsents(state)).toBe(true);
    });

    it('con solo terms faltante -> hay pendientes pero needsPrivacyConsent es false', () => {
      const state = makeState(['terms']);
      expect(needsPrivacyConsent(state)).toBe(false);
      expect(hasPendingConsents(state)).toBe(true);
    });

    it('undefined (aun cargando) -> no bloquea', () => {
      expect(needsPrivacyConsent(undefined)).toBe(false);
      expect(hasPendingConsents(undefined)).toBe(false);
    });
  });

  describe('pendingConsentBodies', () => {
    it('arma un body por documento faltante con su version VIGENTE', () => {
      const bodies = pendingConsentBodies(makeState(['privacy_notice', 'terms']));
      expect(bodies).toEqual([
        { document_type: 'privacy_notice', document_version: PRIVACY_NOTICE_VERSION },
        { document_type: 'terms', document_version: TERMS_VERSION },
      ]);
    });

    it('sin faltantes -> array vacio', () => {
      expect(pendingConsentBodies(makeState([]))).toEqual([]);
    });
  });

  describe('etiquetas', () => {
    it('traduce tipos y estados a espanol', () => {
      expect(requestTypeLabel('access')).toBe('Acceso');
      expect(requestTypeLabel('erasure')).toBe('Supresion');
      expect(requestStatusLabel('pending')).toBe('Pendiente');
      expect(requestStatusLabel('completed')).toBe('Resuelta');
    });
  });

  describe('estructura de los avisos', () => {
    it('el simplificado tiene las secciones minimas que exige la ley', () => {
      const ids = SIMPLIFIED_NOTICE.sections.map((s) => s.id);
      expect(ids).toContain('responsable');
      expect(ids).toContain('datos');
      expect(ids).toContain('finalidades');
      expect(ids).toContain('limitar-uso');
      expect(ids).toContain('integral');
    });

    it('el integral incluye derechos del titular y una seccion de IA/decisiones automatizadas', () => {
      const ids = INTEGRAL_NOTICE.sections.map((s) => s.id);
      expect(ids).toContain('derechos');
      expect(ids).toContain('ia');
      // transferencias marcada como opcional (la nueva LFPDPPP ya no la exige).
      const transfer = INTEGRAL_NOTICE.sections.find((s) => s.id === 'transferencias');
      expect(transfer?.optional).toBe(true);
    });
  });
});
