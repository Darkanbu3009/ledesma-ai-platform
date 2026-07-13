import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import es from './locales/es.json';
import en from './locales/en.json';

/**
 * INFRAESTRUCTURA DE i18n (fase 1). Espanol es el idioma por defecto de la app; ingles es el otro
 * idioma disponible. En esta fase solo estan migrados los textos de MUESTRA (sidebar de navegacion
 * y selector de idioma); el resto de la app sigue hardcodeada en espanol y se migrara por secciones
 * en PRs futuros, agregando claves a los locales de `./locales`.
 *
 * Convencion de claves: dot-notation por seccion de la app ("nav.panel", "language.sectionTitle"),
 * con la seccion como primer segmento. Ambos locales (es.json / en.json) deben tener SIEMPRE el
 * mismo arbol de claves; `fallbackLng: 'es'` cubre cualquier clave que falte en ingles.
 *
 * Deteccion de idioma (orden): preferencia del usuario -> idioma del navegador -> espanol. Hoy NO
 * hay preferencia persistida (localStorage no esta soportado en el entorno y el perfil del backend
 * aun no guarda idioma), asi que al arrancar solo aplican los dos ultimos pasos; la eleccion del
 * usuario (modal de la landing o selector de Configuracion) vive en el estado de la sesion de
 * i18next via changeLanguage. Por lo mismo NO se usa i18next-browser-languagedetector: su cadena
 * de deteccion por defecto lee/escribe localStorage.
 */

export const SUPPORTED_LANGUAGES = ['es', 'en'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

/** Idioma inicial segun el navegador: 'en' solo si navigator.language es claramente ingles. */
export function detectBrowserLanguage(): SupportedLanguage {
  const browserLanguage = typeof navigator === 'undefined' ? '' : (navigator.language ?? '');
  return browserLanguage.toLowerCase().startsWith('en') ? 'en' : 'es';
}

/** Normaliza lo que reporte i18next (ej. 'en-US') a uno de los dos idiomas soportados. */
export function currentLanguage(): SupportedLanguage {
  return i18n.language?.toLowerCase().startsWith('en') ? 'en' : 'es';
}

void i18n.use(initReactI18next).init({
  resources: {
    es: { translation: es },
    en: { translation: en },
  },
  lng: detectBrowserLanguage(),
  fallbackLng: 'es',
  supportedLngs: SUPPORTED_LANGUAGES,
  interpolation: {
    // React ya escapa el contenido interpolado; escapar dos veces corrompe acentos y comillas.
    escapeValue: false,
  },
});

export default i18n;
