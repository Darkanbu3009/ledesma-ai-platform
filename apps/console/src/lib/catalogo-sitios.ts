/**
 * CATALOGO CURADO de sitios sugeridos para /sitios: plataformas populares que el usuario puede
 * elegir con un clic en lugar de teclear la URL de login. Las URLs fueron verificadas MANUALMENTE
 * por el operador; NO se verifican automaticamente en CI (scripts/verificar-catalogo-sitios.mjs
 * permite re-verificarlas en local). Los nombres y logos son marcas de sus respectivos titulares,
 * usados solo para identificar el servicio.
 *
 * Es solo un atajo de captura: elegir una entrada rellena el input de URL y NADA mas; la conexion
 * sigue pasando por la validacion y la mutacion existentes. PROHIBIDO agregar bancos, fintech,
 * casas de bolsa, criptomonedas o cualquier servicio financiero.
 *
 * Sin React ni red: datos y funciones puras (filtrado y agrupado), testeables como jobs.ts.
 */

/** Grupos del catalogo, en el ORDEN en que se muestran en el panel. */
export type CategoriaSitio =
  | 'correo'
  | 'productividad'
  | 'almacenamiento'
  | 'desarrollo'
  | 'comercio'
  | 'viajes'
  | 'medios'
  | 'gobierno_mx'
  | 'social';

/** Avisos por entrada; la UI los traduce (sitios.catalogo.advertencia.*). */
export type AdvertenciaSitio = 'automatizacion_restringida' | 'datos_sensibles';

export type SitioSugerido = {
  id: string;
  /** Nombre comercial de la plataforma. Marca registrada de su titular; no se traduce. */
  nombre: string;
  /** Host de urlLogin en minusculas (mismo criterio que dominioDeUrl del backend). */
  dominio: string;
  /** URL que rellena el input al seleccionar la fila. Verificada manualmente, no en CI. */
  urlLogin: string;
  categoria: CategoriaSitio;
  /** Slug en LOGOS_CATALOGO (logos-catalogo.ts). null = sin logo empaquetado: fallback de inicial. */
  iconoSlug: string | null;
  advertencia?: AdvertenciaSitio;
  /** CLAVE i18n (sin el prefijo sitios.catalogo.nota.) de la linea secundaria de la fila. */
  nota?: string;
};

/** Orden fijo de los grupos en el panel. */
export const ORDEN_CATEGORIAS: readonly CategoriaSitio[] = [
  'correo',
  'productividad',
  'almacenamiento',
  'desarrollo',
  'comercio',
  'viajes',
  'medios',
  'gobierno_mx',
  'social',
];

/**
 * Entradas del catalogo. iconoSlug null tambien aparece en marcas cuyo icono ya no se distribuye
 * en simple-icons v16 (Outlook, Yahoo, Slack, Monday, OneDrive, Amazon, Mercado Libre, LinkedIn
 * fueron retirados upstream): esas filas usan el fallback de inicial, sin logo improvisado.
 */
export const CATALOGO_SITIOS: readonly SitioSugerido[] = [
  // correo
  { id: 'gmail', nombre: 'Gmail', dominio: 'mail.google.com', urlLogin: 'https://mail.google.com', categoria: 'correo', iconoSlug: 'gmail' },
  { id: 'outlook_personal', nombre: 'Outlook', dominio: 'outlook.live.com', urlLogin: 'https://outlook.live.com/mail', categoria: 'correo', iconoSlug: null },
  { id: 'outlook_365', nombre: 'Microsoft 365', dominio: 'outlook.office.com', urlLogin: 'https://outlook.office.com/mail', categoria: 'correo', iconoSlug: null },
  { id: 'yahoo_mail', nombre: 'Yahoo Mail', dominio: 'mail.yahoo.com', urlLogin: 'https://mail.yahoo.com', categoria: 'correo', iconoSlug: null },
  { id: 'proton_mail', nombre: 'Proton Mail', dominio: 'mail.proton.me', urlLogin: 'https://mail.proton.me', categoria: 'correo', iconoSlug: 'protonmail' },
  { id: 'zoho_mail', nombre: 'Zoho Mail', dominio: 'mail.zoho.com', urlLogin: 'https://mail.zoho.com', categoria: 'correo', iconoSlug: 'zoho' },
  // productividad
  { id: 'google_calendar', nombre: 'Google Calendar', dominio: 'calendar.google.com', urlLogin: 'https://calendar.google.com', categoria: 'productividad', iconoSlug: 'googlecalendar' },
  { id: 'google_docs', nombre: 'Google Docs', dominio: 'docs.google.com', urlLogin: 'https://docs.google.com', categoria: 'productividad', iconoSlug: 'googledocs' },
  { id: 'notion', nombre: 'Notion', dominio: 'www.notion.so', urlLogin: 'https://www.notion.so/login', categoria: 'productividad', iconoSlug: 'notion' },
  { id: 'slack', nombre: 'Slack', dominio: 'slack.com', urlLogin: 'https://slack.com/signin', categoria: 'productividad', iconoSlug: null },
  { id: 'trello', nombre: 'Trello', dominio: 'trello.com', urlLogin: 'https://trello.com/login', categoria: 'productividad', iconoSlug: 'trello' },
  { id: 'asana', nombre: 'Asana', dominio: 'app.asana.com', urlLogin: 'https://app.asana.com', categoria: 'productividad', iconoSlug: 'asana' },
  { id: 'monday', nombre: 'Monday', dominio: 'auth.monday.com', urlLogin: 'https://auth.monday.com', categoria: 'productividad', iconoSlug: null },
  { id: 'clickup', nombre: 'ClickUp', dominio: 'app.clickup.com', urlLogin: 'https://app.clickup.com/login', categoria: 'productividad', iconoSlug: 'clickup' },
  { id: 'airtable', nombre: 'Airtable', dominio: 'airtable.com', urlLogin: 'https://airtable.com/login', categoria: 'productividad', iconoSlug: 'airtable' },
  { id: 'calendly', nombre: 'Calendly', dominio: 'calendly.com', urlLogin: 'https://calendly.com/app/login', categoria: 'productividad', iconoSlug: 'calendly' },
  { id: 'zoom', nombre: 'Zoom', dominio: 'zoom.us', urlLogin: 'https://zoom.us/signin', categoria: 'productividad', iconoSlug: 'zoom' },
  // almacenamiento
  { id: 'google_drive', nombre: 'Google Drive', dominio: 'drive.google.com', urlLogin: 'https://drive.google.com', categoria: 'almacenamiento', iconoSlug: 'googledrive' },
  { id: 'dropbox', nombre: 'Dropbox', dominio: 'www.dropbox.com', urlLogin: 'https://www.dropbox.com/login', categoria: 'almacenamiento', iconoSlug: 'dropbox' },
  { id: 'onedrive', nombre: 'OneDrive', dominio: 'onedrive.live.com', urlLogin: 'https://onedrive.live.com', categoria: 'almacenamiento', iconoSlug: null },
  { id: 'box', nombre: 'Box', dominio: 'account.box.com', urlLogin: 'https://account.box.com/login', categoria: 'almacenamiento', iconoSlug: 'box' },
  // desarrollo
  { id: 'github', nombre: 'GitHub', dominio: 'github.com', urlLogin: 'https://github.com/login', categoria: 'desarrollo', iconoSlug: 'github' },
  { id: 'gitlab', nombre: 'GitLab', dominio: 'gitlab.com', urlLogin: 'https://gitlab.com/users/sign_in', categoria: 'desarrollo', iconoSlug: 'gitlab' },
  { id: 'bitbucket', nombre: 'Bitbucket', dominio: 'bitbucket.org', urlLogin: 'https://bitbucket.org/account/signin', categoria: 'desarrollo', iconoSlug: 'bitbucket' },
  { id: 'atlassian', nombre: 'Jira y Confluence', dominio: 'id.atlassian.com', urlLogin: 'https://id.atlassian.com/login', categoria: 'desarrollo', iconoSlug: 'jira', nota: 'atlassian' },
  { id: 'linear', nombre: 'Linear', dominio: 'linear.app', urlLogin: 'https://linear.app/login', categoria: 'desarrollo', iconoSlug: 'linear' },
  { id: 'vercel', nombre: 'Vercel', dominio: 'vercel.com', urlLogin: 'https://vercel.com/login', categoria: 'desarrollo', iconoSlug: 'vercel' },
  { id: 'railway', nombre: 'Railway', dominio: 'railway.com', urlLogin: 'https://railway.com/login', categoria: 'desarrollo', iconoSlug: 'railway' },
  { id: 'supabase', nombre: 'Supabase', dominio: 'supabase.com', urlLogin: 'https://supabase.com/dashboard/sign-in', categoria: 'desarrollo', iconoSlug: 'supabase' },
  { id: 'cloudflare', nombre: 'Cloudflare', dominio: 'dash.cloudflare.com', urlLogin: 'https://dash.cloudflare.com/login', categoria: 'desarrollo', iconoSlug: 'cloudflare' },
  { id: 'netlify', nombre: 'Netlify', dominio: 'app.netlify.com', urlLogin: 'https://app.netlify.com/login', categoria: 'desarrollo', iconoSlug: 'netlify' },
  // comercio
  { id: 'amazon_mx', nombre: 'Amazon Mexico', dominio: 'www.amazon.com.mx', urlLogin: 'https://www.amazon.com.mx', categoria: 'comercio', iconoSlug: null },
  { id: 'mercado_libre', nombre: 'Mercado Libre', dominio: 'www.mercadolibre.com.mx', urlLogin: 'https://www.mercadolibre.com.mx', categoria: 'comercio', iconoSlug: null },
  { id: 'shopify', nombre: 'Shopify', dominio: 'accounts.shopify.com', urlLogin: 'https://accounts.shopify.com/store-login', categoria: 'comercio', iconoSlug: 'shopify' },
  { id: 'ebay', nombre: 'eBay', dominio: 'signin.ebay.com', urlLogin: 'https://signin.ebay.com', categoria: 'comercio', iconoSlug: 'ebay' },
  { id: 'aliexpress', nombre: 'AliExpress', dominio: 'www.aliexpress.com', urlLogin: 'https://www.aliexpress.com', categoria: 'comercio', iconoSlug: 'aliexpress' },
  // viajes
  { id: 'booking', nombre: 'Booking', dominio: 'account.booking.com', urlLogin: 'https://account.booking.com/sign-in', categoria: 'viajes', iconoSlug: 'bookingdotcom' },
  { id: 'airbnb', nombre: 'Airbnb', dominio: 'www.airbnb.mx', urlLogin: 'https://www.airbnb.mx/login', categoria: 'viajes', iconoSlug: 'airbnb' },
  { id: 'expedia', nombre: 'Expedia', dominio: 'www.expedia.mx', urlLogin: 'https://www.expedia.mx', categoria: 'viajes', iconoSlug: 'expedia' },
  { id: 'despegar', nombre: 'Despegar', dominio: 'www.despegar.com.mx', urlLogin: 'https://www.despegar.com.mx', categoria: 'viajes', iconoSlug: null },
  { id: 'aeromexico', nombre: 'Aeromexico', dominio: 'www.aeromexico.com', urlLogin: 'https://www.aeromexico.com', categoria: 'viajes', iconoSlug: 'aeromexico' },
  // medios
  { id: 'wikipedia', nombre: 'Wikipedia', dominio: 'en.wikipedia.org', urlLogin: 'https://en.wikipedia.org/wiki/Special:UserLogin', categoria: 'medios', iconoSlug: 'wikipedia' },
  { id: 'youtube', nombre: 'YouTube', dominio: 'www.youtube.com', urlLogin: 'https://www.youtube.com', categoria: 'medios', iconoSlug: 'youtube' },
  { id: 'spotify', nombre: 'Spotify', dominio: 'accounts.spotify.com', urlLogin: 'https://accounts.spotify.com/login', categoria: 'medios', iconoSlug: 'spotify' },
  { id: 'medium', nombre: 'Medium', dominio: 'medium.com', urlLogin: 'https://medium.com/m/signin', categoria: 'medios', iconoSlug: 'medium' },
  { id: 'substack', nombre: 'Substack', dominio: 'substack.com', urlLogin: 'https://substack.com/sign-in', categoria: 'medios', iconoSlug: 'substack' },
  // gobierno_mx
  { id: 'sat', nombre: 'SAT', dominio: 'www.sat.gob.mx', urlLogin: 'https://www.sat.gob.mx', categoria: 'gobierno_mx', iconoSlug: null, advertencia: 'datos_sensibles' },
  { id: 'imss', nombre: 'IMSS', dominio: 'serviciosdigitales.imss.gob.mx', urlLogin: 'https://serviciosdigitales.imss.gob.mx', categoria: 'gobierno_mx', iconoSlug: null, advertencia: 'datos_sensibles' },
  { id: 'cfe', nombre: 'CFE', dominio: 'www.cfe.mx', urlLogin: 'https://www.cfe.mx', categoria: 'gobierno_mx', iconoSlug: null, advertencia: 'datos_sensibles' },
  // social
  { id: 'facebook', nombre: 'Facebook', dominio: 'www.facebook.com', urlLogin: 'https://www.facebook.com/login', categoria: 'social', iconoSlug: 'facebook', advertencia: 'automatizacion_restringida' },
  { id: 'instagram', nombre: 'Instagram', dominio: 'www.instagram.com', urlLogin: 'https://www.instagram.com/accounts/login', categoria: 'social', iconoSlug: 'instagram', advertencia: 'automatizacion_restringida' },
  { id: 'x', nombre: 'X', dominio: 'x.com', urlLogin: 'https://x.com/login', categoria: 'social', iconoSlug: 'x', advertencia: 'automatizacion_restringida' },
  { id: 'linkedin', nombre: 'LinkedIn', dominio: 'www.linkedin.com', urlLogin: 'https://www.linkedin.com/login', categoria: 'social', iconoSlug: null, advertencia: 'automatizacion_restringida' },
  { id: 'tiktok', nombre: 'TikTok', dominio: 'www.tiktok.com', urlLogin: 'https://www.tiktok.com/login', categoria: 'social', iconoSlug: 'tiktok', advertencia: 'automatizacion_restringida' },
  { id: 'reddit', nombre: 'Reddit', dominio: 'www.reddit.com', urlLogin: 'https://www.reddit.com/login', categoria: 'social', iconoSlug: 'reddit', advertencia: 'automatizacion_restringida' },
  { id: 'pinterest', nombre: 'Pinterest', dominio: 'www.pinterest.com.mx', urlLogin: 'https://www.pinterest.com.mx/login', categoria: 'social', iconoSlug: 'pinterest', advertencia: 'automatizacion_restringida' },
  { id: 'whatsapp_web', nombre: 'WhatsApp Web', dominio: 'web.whatsapp.com', urlLogin: 'https://web.whatsapp.com', categoria: 'social', iconoSlug: 'whatsapp', advertencia: 'automatizacion_restringida', nota: 'whatsapp' },
];

/**
 * Filtra el catalogo por lo tecleado: coincidencia por nombre o por dominio, sin distinguir
 * mayusculas. Con el input vacio devuelve el catalogo completo (el panel recien abierto muestra
 * todo); sin coincidencias devuelve [] y el panel se oculta (el usuario escribe su URL libre).
 */
export function filtrarCatalogo(consulta: string): SitioSugerido[] {
  const q = consulta.trim().toLowerCase();
  if (q.length === 0) return [...CATALOGO_SITIOS];
  return CATALOGO_SITIOS.filter(
    (sitio) => sitio.nombre.toLowerCase().includes(q) || sitio.dominio.includes(q),
  );
}

export interface GrupoCatalogo {
  categoria: CategoriaSitio;
  sitios: SitioSugerido[];
}

/** Agrupa un subconjunto (ya filtrado) por categoria, en ORDEN_CATEGORIAS. Grupos vacios fuera. */
export function agruparPorCategoria(sitios: readonly SitioSugerido[]): GrupoCatalogo[] {
  return ORDEN_CATEGORIAS.map((categoria) => ({
    categoria,
    sitios: sitios.filter((sitio) => sitio.categoria === categoria),
  })).filter((grupo) => grupo.sitios.length > 0);
}
