/**
 * LOGOS del catalogo de sitios sugeridos (/sitios), empaquetados en el bundle desde simple-icons.
 * Los logos son MARCAS de sus respectivos titulares y se usan SOLO para identificar cada servicio;
 * simple-icons los distribuye bajo licencia CC0. Cero peticiones de red: nada de favicons ni CDNs
 * de terceros en tiempo de render.
 *
 * El mapa es EXPLICITO icono por icono (imports nombrados) a proposito: `import * as icons`
 * meteria el paquete completo (miles de iconos) al bundle; asi Vite hace tree-shaking y solo
 * empaqueta los ~40 paths usados. Un iconoSlug del catalogo que no este aqui cae al fallback de
 * inicial en la UI.
 *
 * Sin React ni red: datos y el helper puro de contraste, testeables como catalogo-sitios.ts.
 */

import {
  siAeromexico,
  siAirbnb,
  siAirtable,
  siAliexpress,
  siAsana,
  siBitbucket,
  siBookingdotcom,
  siBox,
  siCalendly,
  siClickup,
  siCloudflare,
  siDropbox,
  siEbay,
  siExpedia,
  siFacebook,
  siGithub,
  siGitlab,
  siGmail,
  siGooglecalendar,
  siGoogledocs,
  siGoogledrive,
  siInstagram,
  siJira,
  siLinear,
  siMedium,
  siNetlify,
  siNotion,
  siPinterest,
  siProtonmail,
  siRailway,
  siReddit,
  siShopify,
  siSpotify,
  siSubstack,
  siSupabase,
  siTiktok,
  siTrello,
  siVercel,
  siWhatsapp,
  siWikipedia,
  siX,
  siYoutube,
  siZoho,
  siZoom,
} from 'simple-icons';

export interface LogoCatalogo {
  /** El unico path del SVG (viewBox 0 0 24 24). */
  path: string;
  /** Hex de marca SIN '#', tal como lo publica simple-icons. */
  hex: string;
}

function logo(icono: { path: string; hex: string }): LogoCatalogo {
  return { path: icono.path, hex: icono.hex };
}

/** Mapa iconoSlug (catalogo-sitios.ts) -> logo empaquetado. */
export const LOGOS_CATALOGO: Readonly<Record<string, LogoCatalogo>> = {
  aeromexico: logo(siAeromexico),
  airbnb: logo(siAirbnb),
  airtable: logo(siAirtable),
  aliexpress: logo(siAliexpress),
  asana: logo(siAsana),
  bitbucket: logo(siBitbucket),
  bookingdotcom: logo(siBookingdotcom),
  box: logo(siBox),
  calendly: logo(siCalendly),
  clickup: logo(siClickup),
  cloudflare: logo(siCloudflare),
  dropbox: logo(siDropbox),
  ebay: logo(siEbay),
  expedia: logo(siExpedia),
  facebook: logo(siFacebook),
  github: logo(siGithub),
  gitlab: logo(siGitlab),
  gmail: logo(siGmail),
  googlecalendar: logo(siGooglecalendar),
  googledocs: logo(siGoogledocs),
  googledrive: logo(siGoogledrive),
  instagram: logo(siInstagram),
  jira: logo(siJira),
  linear: logo(siLinear),
  medium: logo(siMedium),
  netlify: logo(siNetlify),
  notion: logo(siNotion),
  pinterest: logo(siPinterest),
  protonmail: logo(siProtonmail),
  railway: logo(siRailway),
  reddit: logo(siReddit),
  shopify: logo(siShopify),
  spotify: logo(siSpotify),
  substack: logo(siSubstack),
  supabase: logo(siSupabase),
  tiktok: logo(siTiktok),
  trello: logo(siTrello),
  vercel: logo(siVercel),
  whatsapp: logo(siWhatsapp),
  wikipedia: logo(siWikipedia),
  x: logo(siX),
  youtube: logo(siYoutube),
  zoho: logo(siZoho),
  zoom: logo(siZoom),
};

/**
 * Fondo del panel del catalogo: el valor del token `surface` (tailwind.config.js). Solo se usa
 * para CALCULAR contraste; el estilo del panel sigue saliendo del token, no de este hex.
 */
export const FONDO_PANEL_HEX = 'FFFFFF';

/** Luminancia relativa WCAG de un hex de 6 digitos sin '#'. */
function luminanciaRelativa(hex: string): number {
  const canal = (i: number): number => {
    const c = parseInt(hex.slice(i * 2, i * 2 + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * canal(0) + 0.7152 * canal(1) + 0.0722 * canal(2);
}

/** Ratio de contraste WCAG entre dos hex de 6 digitos sin '#'. */
export function ratioDeContraste(hexA: string, hexB: string): number {
  const la = luminanciaRelativa(hexA);
  const lb = luminanciaRelativa(hexB);
  const [claro, oscuro] = la >= lb ? [la, lb] : [lb, la];
  return (claro + 0.05) / (oscuro + 0.05);
}

/**
 * ¿El hex de marca contrasta al menos 3:1 contra el fondo del panel? Si no, el SVG se pinta con
 * currentColor (text-ink) para que el logo no se pierda sobre la superficie clara.
 */
export function usaColorDeMarca(hex: string): boolean {
  return ratioDeContraste(hex, FONDO_PANEL_HEX) >= 3;
}

/**
 * COLOR DE FALLBACK por id de sitio (no por slug) para entradas cuyo icono no se distribuye en
 * simple-icons: el circulo de la inicial se rellena con este hex en vez del neutro, para que a un
 * lado de logos a color no se lea como error de carga. Son APROXIMACIONES de color de marca
 * pendientes de verificacion, no assets de marca. Hex de 6 digitos sin '#'. Un id que no este
 * aqui (y sin logo empaquetado) conserva el fallback neutro de siempre.
 */
export const coloresFallback: Readonly<Record<string, string>> = {
  outlook_personal: '0078D4',
  outlook_365: '0078D4',
  onedrive: '0078D4',
  monday: 'FF3D57',
  amazon_mx: 'FF9900',
  mercado_libre: 'FFE600',
  yahoo_mail: '6001D2',
  linkedin: '0A66C2',
  despegar: '0099FF',
  sat: '691C32',
  imss: '1A5632',
  cfe: '009540',
};

/** Hex del token `ink` (tailwind.config.js): texto oscuro de la inicial del fallback con color. */
export const TEXTO_INK_HEX = '1F1E1C';

/**
 * ¿La inicial sobre este fondo va en ink (fondo claro) o en blanco (fondo oscuro)? Se decide por
 * luminancia relativa del fondo: gana el texto con MAYOR ratio de contraste contra el hex.
 */
export function inicialUsaTextoInk(hexFondo: string): boolean {
  return ratioDeContraste(hexFondo, TEXTO_INK_HEX) >= ratioDeContraste(hexFondo, 'FFFFFF');
}
