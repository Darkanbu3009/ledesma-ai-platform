import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Carga y valida `.env.validation` (raiz del repo). El archivo lo crea el operador y NUNCA se
 * commitea (cubierto por el patron `.env.*` del .gitignore). Este modulo es la UNICA puerta de
 * entrada de secretos del script: todo lo que se loguea o reporta pasa por el redactor de abajo.
 */

const CLAVES_REQUERIDAS = [
  'API_BASE_URL',
  'DATABASE_URL',
  'ADMIN_API_TOKEN',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'TEST_PROVIDER',
  'TEST_PROVIDER_API_KEY',
  'TEST_MODEL',
];

/** Claves cuyo VALOR es secreto y jamas puede aparecer en logs/informe. */
const CLAVES_SECRETAS = ['DATABASE_URL', 'ADMIN_API_TOKEN', 'SUPABASE_SERVICE_ROLE_KEY', 'TEST_PROVIDER_API_KEY'];

/** Parser minimo de lineas KEY=VALUE (sin dependencia dotenv). Ignora comentarios y vacias. */
function parseEnvFile(texto) {
  const salida = {};
  for (const linea of texto.split('\n')) {
    const limpia = linea.trim();
    if (limpia === '' || limpia.startsWith('#')) continue;
    const idx = limpia.indexOf('=');
    if (idx === -1) continue;
    const clave = limpia.slice(0, idx).trim();
    let valor = limpia.slice(idx + 1).trim();
    // Quita comillas envolventes simples o dobles si las hay.
    if ((valor.startsWith('"') && valor.endsWith('"')) || (valor.startsWith("'") && valor.endsWith("'"))) {
      valor = valor.slice(1, -1);
    }
    salida[clave] = valor;
  }
  return salida;
}

export function cargarEnv(raizRepo) {
  const ruta = resolve(raizRepo, '.env.validation');
  if (!existsSync(ruta)) {
    throw new Error(
      `No existe ${ruta}. Crealo con las claves: ${CLAVES_REQUERIDAS.join(', ')} (ver scripts/validacion-e2e/README.md).`,
    );
  }
  const env = parseEnvFile(readFileSync(ruta, 'utf8'));
  const faltantes = CLAVES_REQUERIDAS.filter((k) => !env[k] || env[k].trim() === '');
  if (faltantes.length > 0) {
    throw new Error(`.env.validation incompleto; faltan claves: ${faltantes.join(', ')}`);
  }
  // Regla dura del plan de validacion: las ejecuciones llaman al modelo de verdad, pero JAMAS con
  // un modelo haiku (decision del operador). Corta antes de gastar un solo request.
  if (/haiku/i.test(env.TEST_MODEL)) {
    throw new Error(`TEST_MODEL='${env.TEST_MODEL}' no permitido: nunca haiku. Usa p.ej. claude-sonnet-4-6.`);
  }
  // El script solo soporta proveedores cuya credencial se crea con {providerId, apiKey} SIN baseUrl.
  // 'openai-compatible' es un providerId valido del backend pero EXIGE baseUrl al guardar la
  // credencial (routes/credentials.ts), que este flujo no envia. Fallar rapido con un mensaje de
  // CONFIGURACION en vez de producir un FAIL de plataforma falso en la Fase 3.
  if (!['anthropic', 'openai'].includes(env.TEST_PROVIDER)) {
    throw new Error(
      `TEST_PROVIDER='${env.TEST_PROVIDER}' no soportado por este script (usa 'anthropic' u 'openai'; 'openai-compatible' requiere baseUrl y no esta cubierto).`,
    );
  }
  env.API_BASE_URL = env.API_BASE_URL.replace(/\/+$/, '');
  env.SUPABASE_URL = env.SUPABASE_URL.replace(/\/+$/, '');
  return env;
}

/**
 * REDACTOR global: reemplaza cualquier ocurrencia de un valor secreto conocido por [REDACTADO],
 * mas patrones genericos (JWTs, keys sk-*). Los secretos de runtime (JWT del usuario de prueba,
 * secreto HMAC del trigger, url_token, password) se registran con registrarSecreto() apenas nacen.
 */
const secretosRuntime = new Set();

export function registrarSecreto(valor) {
  if (typeof valor === 'string' && valor.length >= 8) secretosRuntime.add(valor);
}

export function crearRedactor(env) {
  const fijos = CLAVES_SECRETAS.map((k) => env[k]).filter((v) => typeof v === 'string' && v.length >= 8);
  return function redactar(texto) {
    let salida = String(texto);
    for (const secreto of [...fijos, ...secretosRuntime]) {
      salida = salida.split(secreto).join('[REDACTADO]');
    }
    // Defensa extra por patron: JWTs y API keys con prefijo conocido.
    salida = salida.replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '[JWT-REDACTADO]');
    salida = salida.replace(/sk-[A-Za-z0-9_-]{16,}/g, '[KEY-REDACTADA]');
    return salida;
  };
}
