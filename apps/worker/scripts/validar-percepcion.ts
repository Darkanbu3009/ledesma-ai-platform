/**
 * VALIDACION MANUAL DE LA PERCEPCION CONTRA GMAIL REAL (FASE 3 del PR de percepcion). NUNCA corre
 * en CI y NO usa el modelo: cero tokens; consume solo browser hours de Browserbase.
 *
 * Que hace, deterministicamente y con las MISMAS primitivas del worker:
 *  1. Busca el sitio Gmail conectado del owner (mismo repositorio y mismo descifrado que una tarea).
 *  2. Abre la sesion de Browserbase con el contexto cifrado existente y el proxy pineado, verifica
 *     el pais observado y detecta caducidad de login sin modelo (igual que tarea-web.ts).
 *  3. Click en Redactar localizado por rol/aria-label/texto (NO xpath absoluto) y VERIFICACION DE
 *     EFECTO con la percepcion (el compose aparecio o no).
 *  4. TYPE del destinatario en el campo Para y LECTURA DE PERCEPCION: donde aterrizo el texto.
 *  5. Enter para confirmar el chip y lectura de percepcion: chip confirmado o no.
 *  6. Cierra el compose DESCARTANDO el borrador. NO envia nada.
 *
 * Como correrlo (un solo comando, desde la raiz del repo):
 *
 *   npm run validar-percepcion -w apps/worker
 *
 * Variables de entorno que lee (las mismas del worker):
 *   DATABASE_URL             (obligatoria) la base del backend.
 *   VAULT_SECRET             (obligatoria) para descifrar el contexto de sesion.
 *   BROWSERBASE_API_KEY      (obligatoria)
 *   BROWSERBASE_PROJECT_ID   (obligatoria)
 *   BROWSERBASE_PROXY_SERVER / _USERNAME / _PASSWORD (opcionales, si el pin es proxy externo)
 * Y las propias del script (opcionales):
 *   VALIDAR_DOMINIO          dominio del sitio conectado (default: mail.google.com; tambien matchea
 *                            por contiene 'google' si no hay coincidencia exacta).
 *   VALIDAR_OWNER_ID         owner concreto; sin el, se toma el sitio activo mas reciente del dominio.
 *   VALIDAR_DESTINATARIO     correo a teclear (default: validacion.percepcion@example.com). El
 *                            borrador se DESCARTA siempre; nada se envia.
 *   VALIDAR_ENVIO=simulacro  (FASE 3 del fix del cupo irreversible) ademas del flujo normal,
 *                            LOCALIZA el boton Enviar por rol/aria-label (por prefijo: el aria-label
 *                            real es "Enviar (Ctrl-Enter)"), imprime el localizador resuelto y la
 *                            huella previa SIN clickearlo, y despues descarta el borrador igual que
 *                            siempre. Valida la localizacion del boton final contra Gmail real sin
 *                            enviar nada y sin modelo.
 *
 * Comando del modo simulacro (desde la raiz del repo):
 *
 *   VALIDAR_ENVIO=simulacro npm run validar-percepcion -w apps/worker
 */
import { SitiosConectadosRepository } from '@ledesma-platform/backend/sitios';
import { NavegadorBrowserbase } from '../src/browserbase.js';
import { mismaHuella, lineasDeAterrizaje, type PercepcionDePagina } from '../src/percepcion.js';
import { getSql, closeSql } from '../src/db.js';
import type { EstrategiaLocalizacion } from '@ledesma-platform/shared';

function requerida(nombre: string): string {
  const valor = process.env[nombre];
  if (valor === undefined || valor === '') {
    console.error(`Falta la variable de entorno ${nombre}`);
    process.exit(1);
  }
  return valor;
}

const DATABASE_URL = requerida('DATABASE_URL');
const VAULT_SECRET = requerida('VAULT_SECRET');
const BROWSERBASE_API_KEY = requerida('BROWSERBASE_API_KEY');
const BROWSERBASE_PROJECT_ID = requerida('BROWSERBASE_PROJECT_ID');
const DOMINIO = process.env['VALIDAR_DOMINIO'] ?? 'mail.google.com';
const OWNER_ID = process.env['VALIDAR_OWNER_ID'];
const DESTINATARIO = process.env['VALIDAR_DESTINATARIO'] ?? 'validacion.percepcion@example.com';
const MODO_SIMULACRO = process.env['VALIDAR_ENVIO'] === 'simulacro';

/** Prefijos del aria-label del boton Enviar de Gmail (es y en). El sufijo real es "(Ctrl-Enter)". */
const PREFIJOS_BOTON_ENVIAR = ['Enviar', 'Send'];

/** Espera de pared para que Gmail reaccione entre pasos (render del compose, chip, descarte). */
const ESPERA_TRAS_PASO_MS = 1200;

function esperar(ms: number): Promise<void> {
  return new Promise((resolver) => setTimeout(resolver, ms));
}

function titulo(texto: string): void {
  console.log(`\n=== ${texto} ===`);
}

function resumenDePercepcion(p: PercepcionDePagina | null): void {
  if (p === null) {
    console.log('  percepcion: NO LEGIBLE');
    return;
  }
  console.log(`  url: ${p.url.slice(0, 90)}`);
  console.log(`  titulo: ${p.titulo.slice(0, 90)}`);
  console.log(`  nodos: ${p.nodos}`);
  console.log(`  foco: ${p.foco ?? '(ninguno)'}`);
  console.log(`  campos legibles: ${p.campos.length}`);
  for (const campo of p.campos.slice(0, 8)) {
    const marcas = [campo.porChips === true ? 'chip' : '', campo.noLeible === true ? 'noLeible' : '']
      .filter((m) => m !== '')
      .join(',');
    console.log(`    - [${campo.contexto.slice(0, 70)}] = "${campo.valor.slice(0, 40)}"${marcas === '' ? '' : ` (${marcas})`}`);
  }
}

/** Estrategias del boton Redactar: por rol, por aria-label y por texto visible. Jamas xpath absoluto. */
const ESTRATEGIAS_REDACTAR: EstrategiaLocalizacion[] = [
  { tipo: 'rol', rol: 'button', nombre: 'Redactar' },
  { tipo: 'rol', rol: 'button', nombre: 'Compose' },
  { tipo: 'atributo', atributo: 'aria-label', valor: 'Redactar' },
  { tipo: 'atributo', atributo: 'aria-label', valor: 'Compose' },
  { tipo: 'texto', texto: 'Redactar' },
  { tipo: 'texto', texto: 'Compose' },
];

/** Estrategias del campo Para del compose (los aria-label reales de Gmail en es y en). */
const ESTRATEGIAS_CAMPO_PARA: EstrategiaLocalizacion[] = [
  { tipo: 'atributo', atributo: 'aria-label', valor: 'Destinatarios en Para' },
  { tipo: 'atributo', atributo: 'aria-label', valor: 'To recipients' },
  { tipo: 'atributo', atributo: 'aria-label', valor: 'Para' },
  { tipo: 'atributo', atributo: 'aria-label', valor: 'To' },
  { tipo: 'rol', rol: 'combobox', nombre: 'Destinatarios en Para' },
  { tipo: 'rol', rol: 'combobox', nombre: 'To recipients' },
];

/** Estrategias del boton que DESCARTA el borrador (nunca el de enviar). */
const ESTRATEGIAS_DESCARTAR: EstrategiaLocalizacion[] = [
  { tipo: 'atributo', atributo: 'aria-label', valor: 'Descartar borrador' },
  { tipo: 'atributo', atributo: 'aria-label', valor: 'Discard draft' },
  { tipo: 'rol', rol: 'button', nombre: 'Descartar borrador' },
  { tipo: 'rol', rol: 'button', nombre: 'Discard draft' },
];

async function main(): Promise<void> {
  const sql = getSql(DATABASE_URL);
  const repo = new SitiosConectadosRepository(sql);
  const navegador = new NavegadorBrowserbase({
    apiKey: BROWSERBASE_API_KEY,
    projectId: BROWSERBASE_PROJECT_ID,
    proxyServer: process.env['BROWSERBASE_PROXY_SERVER'],
    proxyUsername: process.env['BROWSERBASE_PROXY_USERNAME'],
    proxyPassword: process.env['BROWSERBASE_PROXY_PASSWORD'],
  });

  titulo('1. Sitio conectado');
  // Descubrimiento del sitio: por owner si vino, si no el activo mas reciente del dominio (lectura
  // directa minima; el descifrado del contexto pasa SIEMPRE por el repositorio).
  const filas =
    OWNER_ID !== undefined
      ? await sql<Array<{ id: string; owner_id: string; dominio: string }>>`
          select id, owner_id, dominio
          from sitios_conectados
          where estado = 'activo' and owner_id = ${OWNER_ID}
            and (dominio = ${DOMINIO} or dominio ilike ${'%' + DOMINIO + '%'} or dominio ilike '%google%')
          order by ultimo_uso_en desc nulls last, creado_en desc
          limit 1
        `
      : await sql<Array<{ id: string; owner_id: string; dominio: string }>>`
          select id, owner_id, dominio
          from sitios_conectados
          where estado = 'activo'
            and (dominio = ${DOMINIO} or dominio ilike ${'%' + DOMINIO + '%'} or dominio ilike '%google%')
          order by ultimo_uso_en desc nulls last, creado_en desc
          limit 1
        `;
  const fila = filas[0];
  if (fila === undefined) {
    console.error(`No hay un sitio conectado ACTIVO que matchee "${DOMINIO}". Conecta Gmail primero.`);
    process.exit(1);
  }
  const sitio = await repo.obtenerPorId(fila.id, fila.owner_id);
  if (sitio === null || sitio.contextoExternoId === null || sitio.proxyRef === null || sitio.proxyCountry === null) {
    console.error('El sitio no tiene contexto/proxy pineados completos; reconectalo desde la consola.');
    process.exit(1);
  }
  console.log(`  dominio: ${sitio.dominio}  estado: ${sitio.estado}  pais pineado: ${sitio.proxyCountry}`);

  const contexto = await repo.obtenerContextoDescifrado(sitio.id, sitio.ownerId, VAULT_SECRET);
  if (contexto === null) {
    console.error('El contexto de sesion no se pudo descifrar (VAULT_SECRET incorrecto o sin contexto).');
    process.exit(1);
  }

  titulo('2. Sesion de Browserbase (mismo mecanismo que el worker)');
  const sesion = await navegador.abrirSesionParaTarea({
    contextoExternoId: sitio.contextoExternoId,
    proxyRef: sitio.proxyRef,
    proxyCountry: sitio.proxyCountry,
  });
  console.log(`  sesion: ${sesion.sesionExternaId}  pais observado: ${sesion.egressCountry ?? 'null'}`);
  try {
    if (sesion.egressCountry !== sitio.proxyCountry) {
      throw new Error(
        `pais observado (${sesion.egressCountry ?? 'null'}) distinto del pineado (${sitio.proxyCountry}); se aborta sin navegar`,
      );
    }
    await navegador.inyectarContexto(sesion.sesionExternaId, contexto);
    const url = `https://${sitio.dominio}/`;
    const caducado = await navegador.detectarPantallaDeLogin(sesion.sesionExternaId, url);
    if (caducado) {
      throw new Error('aparecio una pantalla de login: la sesion de Gmail caduco; reconecta el sitio');
    }
    await esperar(ESPERA_TRAS_PASO_MS * 3);

    titulo('3. Percepcion inicial (bandeja)');
    const antes = await navegador.percibirPagina(sesion.sesionExternaId);
    resumenDePercepcion(antes);

    titulo('4. Click en Redactar (rol/aria-label, sin xpath absoluto)');
    const click = await navegador.ejecutarPasoDeterminista(sesion.sesionExternaId, {
      accion: 'click',
      estrategias: ESTRATEGIAS_REDACTAR,
      texto: null,
      teclas: null,
      url: null,
      esperaMs: null,
    });
    console.log(`  estado del paso: ${click.estado}${click.detalle === null ? '' : ` (${click.detalle})`}`);
    if (click.estado !== 'ok') throw new Error('no se pudo localizar el boton Redactar');
    await esperar(ESPERA_TRAS_PASO_MS);

    titulo('5. Verificacion de efecto del click');
    const trasClick = await navegador.percibirPagina(sesion.sesionExternaId);
    resumenDePercepcion(trasClick);
    if (antes !== null && trasClick !== null) {
      if (mismaHuella(antes, trasClick)) {
        throw new Error('click ejecutado SIN efecto visible: el compose NO aparecio');
      }
      console.log('  VEREDICTO: click verificado CON efecto (la pagina cambio; el compose aparecio)');
    } else {
      console.log('  VEREDICTO: sin percepcion legible para comparar');
    }

    titulo(`6. TYPE del destinatario en el campo Para (${DESTINATARIO})`);
    const escritura = await navegador.ejecutarPasoDeterminista(sesion.sesionExternaId, {
      accion: 'escribir',
      estrategias: ESTRATEGIAS_CAMPO_PARA,
      texto: DESTINATARIO,
      teclas: null,
      url: null,
      esperaMs: null,
    });
    console.log(`  estado del paso: ${escritura.estado}${escritura.detalle === null ? '' : ` (${escritura.detalle})`}`);
    if (escritura.estado !== 'ok') throw new Error('no se pudo localizar el campo Para del compose');
    await esperar(ESPERA_TRAS_PASO_MS);

    titulo('7. Percepcion del aterrizaje del texto');
    const trasType = await navegador.percibirPagina(sesion.sesionExternaId);
    resumenDePercepcion(trasType);
    if (trasType !== null) {
      for (const linea of lineasDeAterrizaje({
        percepcion: trasType,
        texto: DESTINATARIO,
        descripcion: `type "${DESTINATARIO}" into the To field`,
      })) {
        console.log(`  ${linea}`);
      }
    }

    titulo('8. Enter para confirmar el chip y percepcion del chip');
    const enter = await navegador.ejecutarPasoDeterminista(sesion.sesionExternaId, {
      accion: 'teclas',
      estrategias: ESTRATEGIAS_CAMPO_PARA,
      texto: null,
      teclas: 'Enter',
      url: null,
      esperaMs: null,
    });
    console.log(`  estado del paso: ${enter.estado}`);
    await esperar(ESPERA_TRAS_PASO_MS);
    const trasEnter = await navegador.percibirPagina(sesion.sesionExternaId);
    resumenDePercepcion(trasEnter);
    const chip = trasEnter?.campos.find(
      (campo) => campo.valor.toLowerCase().includes(DESTINATARIO.toLowerCase()) && campo.porChips === true,
    );
    if (chip !== undefined) {
      console.log(`  VEREDICTO: chip confirmado percibido como valor presente en [${chip.contexto.slice(0, 60)}]`);
    } else {
      console.log('  VEREDICTO: el chip aun no se percibe (Gmail puede tardar o dejar el texto en el input)');
    }

    if (MODO_SIMULACRO) {
      titulo('8.5. SIMULACRO DE ENVIO: localizar el boton Enviar SIN clickearlo (FASE 3)');
      // La huella previa: es la referencia contra la que la confirmacion de efecto compararia si el
      // clic se ejecutara de verdad. Se imprime tal cual; NADA se clickea.
      const huellaPrevia = trasEnter ?? (await navegador.percibirPagina(sesion.sesionExternaId));
      console.log('  huella previa al (no) clic:');
      resumenDePercepcion(huellaPrevia);
      const boton = await navegador.localizarBotonPorAriaLabel(
        sesion.sesionExternaId,
        PREFIJOS_BOTON_ENVIAR,
      );
      if (boton === null) {
        console.log('  VEREDICTO: NO se localizo un boton visible cuyo aria-label empiece con Enviar/Send');
      } else {
        console.log(`  localizador resuelto: rol=${boton.rol} aria-label="${boton.ariaLabel}"`);
        console.log(`  candidatos que matchearon el prefijo: ${boton.candidatos}`);
        console.log('  VEREDICTO: boton Enviar LOCALIZADO por rol/aria-label; NO se clickeo nada');
      }
    }

    titulo('9. Descartar el borrador (nada se envia)');
    const descarte = await navegador.ejecutarPasoDeterminista(sesion.sesionExternaId, {
      accion: 'click',
      estrategias: ESTRATEGIAS_DESCARTAR,
      texto: null,
      teclas: null,
      url: null,
      esperaMs: null,
    });
    console.log(`  estado del paso: ${descarte.estado}`);
    await esperar(ESPERA_TRAS_PASO_MS);
    const final = await navegador.percibirPagina(sesion.sesionExternaId);
    const composeCerrado =
      final !== null &&
      !final.campos.some((campo) => campo.contexto.toLowerCase().includes('para') || campo.contexto.toLowerCase().includes('recipients'));
    console.log(`  compose cerrado: ${composeCerrado ? 'si' : 'no verificable'}`);
    console.log('\nVALIDACION COMPLETA: percepcion verificada contra Gmail real.');
  } finally {
    titulo('10. Cierre de la sesion');
    await navegador.cerrarSesion(sesion.sesionExternaId).catch((error: unknown) => {
      console.error('  no se pudo cerrar la sesion (el timeout del proveedor la cerrara):', error);
    });
    await closeSql(5);
  }
}

main().catch(async (error: unknown) => {
  console.error('\nLA VALIDACION FALLO:', error instanceof Error ? error.message : error);
  await closeSql(5).catch(() => {});
  process.exit(1);
});
