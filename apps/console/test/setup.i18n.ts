// Setup global de vitest: inicializa i18next (misma instancia que usa la app via useTranslation)
// para que los componentes ya migrados (sidebar, selector de idioma) resuelvan sus claves en los
// tests. Se fija espanol explicitamente porque jsdom reporta navigator.language = 'en-US' y la
// deteccion inicial elegiria ingles: los tests existentes asertan los textos en espanol, que es
// el idioma por defecto del producto. Los tests que ejercitan el cambio de idioma deben volver a
// 'es' al terminar.
import i18n from '../src/i18n';

await i18n.changeLanguage('es');
