// Lista COMPLETA de paises ISO 3166-1 alpha-2 (los 249 codigos oficialmente asignados) y helpers
// puros para el selector de pais del perfil. El pais lo DECLARA el usuario (se guarda en
// profiles.pais y pinea la geolocalizacion del proxy al conectar sitios): aqui no hay geo-IP, ni
// default, ni ningun pais privilegiado -- la plataforma sirve a usuarios de CUALQUIER pais.
//
// Los NOMBRES no se hardcodean: se localizan en runtime con Intl.DisplayNames (built-in del
// navegador) en el idioma activo de la consola (ES/EN), con el codigo como fallback defensivo.

/** Los 249 codigos ISO 3166-1 alpha-2 oficialmente asignados (orden alfabetico por codigo). */
export const CODIGOS_PAIS_ISO2: readonly string[] = [
  'AD', 'AE', 'AF', 'AG', 'AI', 'AL', 'AM', 'AO', 'AQ', 'AR', 'AS', 'AT', 'AU', 'AW', 'AX', 'AZ',
  'BA', 'BB', 'BD', 'BE', 'BF', 'BG', 'BH', 'BI', 'BJ', 'BL', 'BM', 'BN', 'BO', 'BQ', 'BR', 'BS',
  'BT', 'BV', 'BW', 'BY', 'BZ', 'CA', 'CC', 'CD', 'CF', 'CG', 'CH', 'CI', 'CK', 'CL', 'CM', 'CN',
  'CO', 'CR', 'CU', 'CV', 'CW', 'CX', 'CY', 'CZ', 'DE', 'DJ', 'DK', 'DM', 'DO', 'DZ', 'EC', 'EE',
  'EG', 'EH', 'ER', 'ES', 'ET', 'FI', 'FJ', 'FK', 'FM', 'FO', 'FR', 'GA', 'GB', 'GD', 'GE', 'GF',
  'GG', 'GH', 'GI', 'GL', 'GM', 'GN', 'GP', 'GQ', 'GR', 'GS', 'GT', 'GU', 'GW', 'GY', 'HK', 'HM',
  'HN', 'HR', 'HT', 'HU', 'ID', 'IE', 'IL', 'IM', 'IN', 'IO', 'IQ', 'IR', 'IS', 'IT', 'JE', 'JM',
  'JO', 'JP', 'KE', 'KG', 'KH', 'KI', 'KM', 'KN', 'KP', 'KR', 'KW', 'KY', 'KZ', 'LA', 'LB', 'LC',
  'LI', 'LK', 'LR', 'LS', 'LT', 'LU', 'LV', 'LY', 'MA', 'MC', 'MD', 'ME', 'MF', 'MG', 'MH', 'MK',
  'ML', 'MM', 'MN', 'MO', 'MP', 'MQ', 'MR', 'MS', 'MT', 'MU', 'MV', 'MW', 'MX', 'MY', 'MZ', 'NA',
  'NC', 'NE', 'NF', 'NG', 'NI', 'NL', 'NO', 'NP', 'NR', 'NU', 'NZ', 'OM', 'PA', 'PE', 'PF', 'PG',
  'PH', 'PK', 'PL', 'PM', 'PN', 'PR', 'PS', 'PT', 'PW', 'PY', 'QA', 'RE', 'RO', 'RS', 'RU', 'RW',
  'SA', 'SB', 'SC', 'SD', 'SE', 'SG', 'SH', 'SI', 'SJ', 'SK', 'SL', 'SM', 'SN', 'SO', 'SR', 'SS',
  'ST', 'SV', 'SX', 'SY', 'SZ', 'TC', 'TD', 'TF', 'TG', 'TH', 'TJ', 'TK', 'TL', 'TM', 'TN', 'TO',
  'TR', 'TT', 'TV', 'TW', 'TZ', 'UA', 'UG', 'UM', 'US', 'UY', 'UZ', 'VA', 'VC', 'VE', 'VG', 'VI',
  'VN', 'VU', 'WF', 'WS', 'YE', 'YT', 'ZA', 'ZM', 'ZW',
];

/** ¿`value` es uno de los codigos ISO 3166-1 alpha-2 asignados? (para validar antes de enviar). */
export function esCodigoPaisValido(value: string): boolean {
  return CODIGOS_PAIS_ISO2.includes(value.toUpperCase());
}

/**
 * PAIS sugerido por el navegador (ISO 3166-1 alpha-2) derivado con los likely subtags de CLDR
 * (Intl.Locale#maximize, built-in: 'es-AR' -> AR, 'es' -> ES). Es SOLO la preseleccion del selector
 * de pais (una sugerencia que el usuario confirma o cambia): lo que viaja al conectar es siempre el
 * pais DECLARADO en el perfil. undefined = no derivable (el selector arranca sin seleccion).
 */
export function paisDelNavegador(): string | undefined {
  try {
    const region = new Intl.Locale(navigator.language).maximize().region;
    return region && /^[A-Z]{2}$/.test(region) ? region : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Nombre localizado de un pais en el idioma dado ('es'/'en'), via Intl.DisplayNames. Fallback al
 * propio codigo si el runtime no puede resolverlo (jamas rompe el selector).
 */
export function nombreDePais(codigo: string, idioma: string): string {
  try {
    return new Intl.DisplayNames([idioma], { type: 'region' }).of(codigo) ?? codigo;
  } catch {
    return codigo;
  }
}

/** Una opcion del selector de pais: el codigo ISO-2 y su nombre en el idioma activo. */
export interface OpcionPais {
  codigo: string;
  nombre: string;
}

/**
 * La lista completa de paises como opciones { codigo, nombre } ORDENADAS por nombre localizado
 * (collator del idioma activo): el usuario busca su pais por nombre, no por codigo.
 */
export function opcionesDePais(idioma: string): OpcionPais[] {
  const collator = new Intl.Collator(idioma);
  return CODIGOS_PAIS_ISO2.map((codigo) => ({ codigo, nombre: nombreDePais(codigo, idioma) })).sort(
    (a, b) => collator.compare(a.nombre, b.nombre),
  );
}
