import { describe, it, expect } from 'vitest';
import {
  currentAcceptance,
  hasPendingConsents,
  pendingConsentBodies,
  requestStatusLabel,
  requestTypeLabel,
  DOCUMENT_PATHS,
  PRIVACY_NOTICE_VERSION,
  REQUIRED_DOCUMENTS,
  TERMS_VERSION,
  type Consent,
  type ConsentsState,
} from '../src/lib/privacy';
import { documentoLegal, idiomaLegal } from '../src/content/legal';

function makeConsent(overrides: Partial<Consent> = {}): Consent {
  return {
    id: 'c1',
    ownerId: 'user-1',
    documentType: 'privacy_notice',
    documentVersion: PRIVACY_NOTICE_VERSION,
    acceptedAt: '2026-07-01T00:00:00.000Z',
    ipHash: 'a'.repeat(64),
    ...overrides,
  };
}

function makeState(missing: ConsentsState['missing'], consents: Consent[] = []): ConsentsState {
  return {
    consents,
    current: { privacy_notice: PRIVACY_NOTICE_VERSION, terms: TERMS_VERSION },
    documentTypes: ['privacy_notice', 'terms'],
    missing,
  };
}

describe('privacy lib', () => {
  describe('hasPendingConsents', () => {
    it('sin faltantes -> no bloquea', () => {
      expect(hasPendingConsents(makeState([]))).toBe(false);
    });

    it('con cualquiera de los dos documentos faltante -> bloquea', () => {
      expect(hasPendingConsents(makeState(['privacy_notice']))).toBe(true);
      expect(hasPendingConsents(makeState(['terms']))).toBe(true);
      expect(hasPendingConsents(makeState(['privacy_notice', 'terms']))).toBe(true);
    });

    it('undefined (aun cargando) -> no bloquea', () => {
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

  describe('currentAcceptance', () => {
    it('devuelve la aceptacion de la version VIGENTE', () => {
      const state = makeState([], [makeConsent()]);
      expect(currentAcceptance(state, 'privacy_notice')?.documentVersion).toBe(
        PRIVACY_NOTICE_VERSION,
      );
    });

    it('una aceptacion de version VIEJA no cuenta como vigente', () => {
      const state = makeState(['privacy_notice'], [makeConsent({ documentVersion: '2020-01-01' })]);
      expect(currentAcceptance(state, 'privacy_notice')).toBeNull();
    });

    it('sin estado o sin aceptacion del documento -> null', () => {
      expect(currentAcceptance(undefined, 'terms')).toBeNull();
      expect(currentAcceptance(makeState(['terms'], [makeConsent()]), 'terms')).toBeNull();
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
});

describe('contenido legal', () => {
  it('idiomaLegal normaliza las variantes regionales y cae a espanol', () => {
    expect(idiomaLegal('es')).toBe('es');
    expect(idiomaLegal('es-MX')).toBe('es');
    expect(idiomaLegal('en')).toBe('en');
    expect(idiomaLegal('EN-US')).toBe('en');
    expect(idiomaLegal('fr')).toBe('es');
    expect(idiomaLegal(undefined)).toBe('es');
  });

  it('la VERSION del contenido coincide con la que la consola declara (y el backend exige)', () => {
    for (const idioma of ['es', 'en']) {
      expect(documentoLegal('aviso', idioma).version).toBe(PRIVACY_NOTICE_VERSION);
      expect(documentoLegal('avisoSimplificado', idioma).version).toBe(PRIVACY_NOTICE_VERSION);
      expect(documentoLegal('terminos', idioma).version).toBe(TERMS_VERSION);
    }
  });

  it('cada documento existe en los dos idiomas, con secciones', () => {
    for (const nombre of ['aviso', 'avisoSimplificado', 'terminos'] as const) {
      for (const idioma of ['es', 'en']) {
        const doc = documentoLegal(nombre, idioma);
        expect(doc.secciones.length).toBeGreaterThan(0);
        expect(doc.titulo).not.toBe('');
        expect(doc.fecha).not.toBe('');
      }
    }
  });

  it('NINGUN documento vuelve a declararse borrador pendiente de revision legal', () => {
    // Un abogado reviso y valido los textos: la nota de borrador se retiro y no puede reaparecer, ni como
    // campo del documento ni colada en el cuerpo de una seccion, en ninguno de los dos idiomas.
    const rastros = [
      /[Bb]orrador generado con asistencia/,
      /pendiente de revisi[oó]n legal/i,
      /AI assisted draft/i,
      /pending professional legal review/i,
    ];
    for (const nombre of ['aviso', 'avisoSimplificado', 'terminos'] as const) {
      for (const idioma of ['es', 'en']) {
        const doc = documentoLegal(nombre, idioma);
        expect(Object.prototype.hasOwnProperty.call(doc, 'notaBorrador')).toBe(false);
        const texto = JSON.stringify(doc);
        for (const rastro of rastros) {
          expect(texto).not.toMatch(rastro);
        }
      }
    }
  });

  it('el aviso integral cubre las secciones que exige la ley mexicana', () => {
    const ids = documentoLegal('aviso', 'es').secciones.map((s) => s.id);
    for (const requerida of [
      'responsable',
      'datos',
      'finalidades-primarias',
      'finalidades-secundarias',
      'decisiones-automatizadas',
      'transferencias',
      'conservacion',
      'seguridad',
      'derechos',
      'cambios',
    ]) {
      expect(ids).toContain(requerida);
    }
    // Las dos versiones tienen la MISMA estructura: una traduccion no puede perder una seccion.
    expect(documentoLegal('aviso', 'en').secciones.map((s) => s.id)).toEqual(ids);
  });

  it('los terminos cubren BYOK, uso aceptable, aprendizaje colectivo y jurisdiccion', () => {
    const ids = documentoLegal('terminos', 'es').secciones.map((s) => s.id);
    for (const requerida of [
      'servicio',
      'byok',
      'uso-aceptable',
      'propiedad',
      'aprendizaje-colectivo',
      'responsabilidad',
      'jurisdiccion',
      'contacto',
    ]) {
      expect(ids).toContain(requerida);
    }
    expect(documentoLegal('terminos', 'en').secciones.map((s) => s.id)).toEqual(ids);
  });

  it('los datos del responsable son los mismos en los dos documentos y en los dos idiomas', () => {
    for (const nombre of ['aviso', 'avisoSimplificado', 'terminos'] as const) {
      for (const idioma of ['es', 'en']) {
        const texto = JSON.stringify(documentoLegal(nombre, idioma));
        expect(texto).toContain('Omar Ledesma');
        expect(texto).toContain('Ledesma AI Labs');
        expect(texto).toContain('contacto@ledesma-ai-labs.com');
        expect(texto).toMatch(/Monterrey, Nuevo Le[oó]n/);
      }
    }
  });

  it('NO afirma cifrado de extremo a extremo del relay ni certificaciones que no existen', () => {
    // El codigo del relay dice explicitamente que NO es extremo a extremo hasta el navegador remoto
    // (apps/console/src/lib/relay-crypto.ts). El aviso solo puede mencionarlo para NEGARLO.
    const es = JSON.stringify(documentoLegal('aviso', 'es'));
    expect(es).toContain('el cifrado protege el trayecto, no el destino');
    expect(es).toContain('No afirmamos que se trate de cifrado de extremo a extremo');
    expect(es).toContain('No contamos con certificaciones de seguridad de terceros');
  });

  it('los plazos de conservacion declarados son los que el codigo implementa', () => {
    const es = JSON.stringify(documentoLegal('aviso', 'es'));
    // retention-policy.ts: trayectoriasWebDays 30, terminalJobsDays 90, agentRunsDays 365.
    expect(es).toContain('30 días');
    expect(es).toContain('90 días');
    expect(es).toContain('365 días');
  });

  it('la finalidad secundaria y la clausula de aprendizaje colectivo declaran el MISMO alcance', () => {
    const aviso = JSON.stringify(documentoLegal('aviso', 'es'));
    const terminos = JSON.stringify(documentoLegal('terminos', 'es'));
    for (const texto of [aviso, terminos]) {
      expect(texto).toContain('dominio');
      expect(texto).toMatch(/una sola vía/);
    }
    // Los terminos enumeran explicitamente lo que NUNCA se agrega.
    expect(terminos).toContain('Los valores que se escribieron en los formularios.');
  });
});

describe('rutas publicas de los documentos', () => {
  it('cada documento exigido tiene su ruta publica', () => {
    expect(REQUIRED_DOCUMENTS).toEqual(['privacy_notice', 'terms']);
    expect(DOCUMENT_PATHS.privacy_notice).toBe('/privacidad');
    expect(DOCUMENT_PATHS.terms).toBe('/terminos');
  });
});
