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
 * usuario (selector discreto de la landing o selector de Configuracion) vive en el estado de la
 * sesion de i18next via changeLanguage. Por lo mismo NO se usa i18next-browser-languagedetector:
 * su cadena de deteccion por defecto lee/escribe localStorage.
 */

export const SUPPORTED_LANGUAGES = ['es', 'en'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

/**
 * Nombres propios de cada idioma para los selectores (landing y Configuracion). Se
 * muestran IGUAL en ambos idiomas (cada idioma se nombra a si mismo), por eso son una constante
 * compartida y no claves de traduccion: una sola fuente de verdad para todos los selectores.
 */
export const LANGUAGE_LABELS: Record<SupportedLanguage, string> = {
  es: 'Español',
  en: 'English',
};

/** Colapsa cualquier etiqueta BCP 47 (ej. 'en-US') a uno de los dos idiomas soportados. */
function toSupportedLanguage(tag: string | undefined): SupportedLanguage {
  return tag?.toLowerCase().startsWith('en') ? 'en' : 'es';
}

/** Idioma inicial segun el navegador: 'en' solo si navigator.language es claramente ingles. */
export function detectBrowserLanguage(): SupportedLanguage {
  return toSupportedLanguage(typeof navigator === 'undefined' ? undefined : navigator.language);
}

/**
 * Idioma activo normalizado. Acepta la instancia reactiva de useTranslation para que los
 * componentes lean el MISMO handle al que estan suscritos; sin argumento lee el singleton.
 */
export function currentLanguage(instance: Pick<typeof i18n, 'language'> = i18n): SupportedLanguage {
  return toSupportedLanguage(instance.language);
}

void i18n.use(initReactI18next).init({
  resources: {
    es: { translation: es },
    en: { translation: en },
  },
  lng: detectBrowserLanguage(),
  fallbackLng: 'es',
  supportedLngs: SUPPORTED_LANGUAGES,
  // Init SINCRONO: los recursos van inline (no hay backend que esperar) y asi la instancia queda
  // lista en este mismo import, antes del primer render. Sin esto, i18next difiere el init a un
  // tick posterior y useTranslation suspenderia el primer render sin un Suspense boundary.
  initAsync: false,
  interpolation: {
    // React ya escapa el contenido interpolado; escapar dos veces corrompe acentos y comillas.
    escapeValue: false,
  },
});

export default i18n;
