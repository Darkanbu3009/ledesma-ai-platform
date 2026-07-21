import {
  CONECTAR_SITIO_JOB_KIND,
  CONFIRMAR_CONEXION_JOB_KIND,
  DESCONECTAR_SITIO_JOB_KIND,
  dominioDeUrl,
  parseSitioJobPayload,
} from '@ledesma-platform/shared';
import type { Job } from '@ledesma-platform/shared';
// IMPORT DE TIPOS (type-only): el repositorio real de 7.1a se INYECTA (ver SitiosJobDeps); este
// modulo no carga en runtime el backend. Igual de importante: aca NO se importa NINGUN cliente de
// modelo ni SDK de proveedor de IA -- ni siquiera type-only. La propiedad "cero llamadas al modelo
// durante el login" es ESTRUCTURAL: en la ruta de estos jobs hay un humano manejando el navegador y
// no existe el import con el que llamar a un modelo. La navegacion por IA es 7.1d, no este modulo.
import type { SitioConectado } from '@ledesma-platform/backend/sitios';
import { PermanentExecutionError } from './errores.js';
import type { Logger } from './logger.js';

/**
 * Handlers de los JOBS DE SITIOS CONECTADOS (Fase 7.1b): el worker sabe abrir una sesion de
 * navegador remoto para que el USUARIO se loguee EL MISMO en un sitio (conectar_sitio), heredar y
 * cifrar esa sesion cuando el usuario confirma (confirmar_conexion), y borrarla en todos los lados
 * (desconectar_sitio). Ademas, el BARRIDO cierra sesiones de login abandonadas.
 *
 * Principios no negociables (espejo de V024/7.1a):
 *  - El login NUNCA se automatiza: un humano real teclea credenciales reales en la vista en vivo,
 *    directamente contra el proveedor del navegador. El worker jamas ve la contrasena y NINGUN tipo
 *    de este modulo tiene (ni tendra) un campo de contrasena.
 *  - conectar_sitio NO espera al humano: abre la sesion, persiste el registro y TERMINA. Cero
 *    sleeps, cero polling. La sesion vive del lado del proveedor con su propio timeout.
 *  - El PAIS de salida es FIJO por (owner, dominio): pineado al conectar por primera vez (segun la
 *    ubicacion del usuario) y verificado en cada reapertura. DECISION DE ARQUITECTURA: el criterio
 *    de continuidad es el PAIS, no la IP exacta -- los proxies del pool son residenciales rotativos
 *    (la IP cambia entre sesiones dentro del mismo pais) y lo que un sitio destino evalua para
 *    invalidar una sesion es un salto geografico imposible (cambio de pais), no el cambio de IP.
 *    Si el proveedor no puede salir por el pais pineado, el job FALLA con mensaje claro; NUNCA se
 *    degrada a otro pais. Para sitios de maxima seguridad (banca) se migrara en el futuro a proxies
 *    sticky dedicados (no en esta fase).
 *  - El contexto heredado (cookies) SON credenciales: se cifran con VAULT_SECRET en el repositorio
 *    de 7.1a antes de tocar la base y JAMAS se loguean (ni el contexto, ni las URLs de vista en
 *    vivo, ni los connect URLs: solo ids).
 */

/** Cuanto puede vivir un login manual sin confirmarse antes de que el barrido lo cierre (10 min). */
export const LOGIN_TIMEOUT_MS = 10 * 60 * 1000;

/** Vida util por defecto de un contexto confirmado: 30 dias (fija expira_en en confirmar_conexion). */
export const CONTEXTO_TTL_DIAS_DEFAULT = 30;

/**
 * TTL por dominio (dias), para sitios cuya sesion se sabe mas corta o mas larga que el default.
 * Configurable en codigo a proposito (no env): es una decision de producto por dominio, versionada
 * y revisable en PR, no un knob de despliegue. Vacio hoy: todos los dominios usan el default.
 */
export const CONTEXTO_TTL_DIAS_POR_DOMINIO: Readonly<Record<string, number>> = {};

/** expira_en de un contexto confirmado del dominio dado, a partir de `ahora`. */
export function expiracionDeContexto(dominio: string, ahora: Date): string {
  const dias = CONTEXTO_TTL_DIAS_POR_DOMINIO[dominio] ?? CONTEXTO_TTL_DIAS_DEFAULT;
  return new Date(ahora.getTime() + dias * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * El proveedor no puede abrir la sesion saliendo por el PAIS pineado a este dominio (o por la
 * salida externa pineada). Es PERMANENTE a proposito: reintentar seria aceptar otra salida,
 * exactamente la degradacion prohibida. El usuario debe reintentar mas tarde o reconectar el sitio.
 */
export class SalidaDeRedNoDisponibleError extends PermanentExecutionError {
  constructor(message: string) {
    super(message);
    this.name = 'SalidaDeRedNoDisponibleError';
  }
}

/** Sesion de login recien abierta en el proveedor: las referencias que se persisten en la conexion. */
export interface SesionDeLoginAbierta {
  /** Id de la sesion de navegador (para reconectar en confirmar_conexion y cerrar en el barrido). */
  sesionExternaId: string;
  /** Id del contexto de navegador donde persisten cookies/perfil. */
  contextoExternoId: string;
  /** URL de la vista en vivo que abre el usuario para loguearse. */
  vistaEnVivoUrl: string;
  /** Referencia de la salida de red USADA (se pina en la primera conexion). */
  proxyRef: string;
  /** IP de salida OBSERVADA a traves de esa salida (informativa/observabilidad). null = no observable. */
  egressIp: string | null;
  /** PAIS de salida OBSERVADO (ISO 3166-1 alpha-2). Es lo que se verifica contra el pais pineado. */
  egressCountry: string | null;
  /** Referencia del fingerprint del navegador. null = el proveedor no la expone. */
  fingerprintRef: string | null;
  /** Cuando expira sola la sesion del lado del proveedor (ISO). null = desconocido. */
  expiraEn: string | null;
}

/**
 * PUERTO hacia el proveedor de navegador remoto (Browserbase). El adaptador real (browserbase.ts,
 * cableado en index.ts) es el UNICO modulo que importa el SDK; los tests pasan fakes y este modulo
 * queda puro. Ningun metodo recibe ni devuelve credenciales del sitio.
 */
export interface NavegadorRemoto {
  /**
   * Crea una sesion de navegador APUNTANDO a `url` (navegada, lista para que el humano teclee) y
   * devuelve sus referencias. `contextoExternoId` null = crear un contexto NUEVO; con valor = reusar
   * el contexto pineado. `proxyRef` null = asignar una salida nueva; con valor = DEBE abrir por esa
   * misma salida o lanzar SalidaDeRedNoDisponibleError (jamas degradar a otra). `proxyCountry` es el
   * PAIS pedido para la geolocalizacion del proxy; el llamador VERIFICA el pais observado despues.
   */
  abrirSesionParaLogin(params: {
    url: string;
    contextoExternoId: string | null;
    proxyRef: string | null;
    proxyCountry: string;
  }): Promise<SesionDeLoginAbierta>;
  /** Estado actual de una sesion por su id: 'viva' si sigue corriendo, 'muerta' si ya termino. */
  estadoDeSesion(sesionExternaId: string): Promise<'viva' | 'muerta'>;
  /**
   * Extrae el contexto de sesion (cookies serializadas) de una sesion VIVA, para cifrarlo y
   * persistirlo. El claro solo existe en memoria entre esta llamada y guardarContexto.
   */
  extraerContexto(sesionExternaId: string): Promise<string>;
  /** Cierra (libera) la sesion en el proveedor. Con persist, el contexto se guarda alla al cerrar. */
  cerrarSesion(sesionExternaId: string): Promise<void>;
  /** Borra el contexto en el proveedor (el lado externo del borrado ARCO). */
  borrarContexto(contextoExternoId: string): Promise<void>;
}

/** Subconjunto del SitiosConectadosRepository (7.1a) que estos handlers usan (facil de mockear). */
export interface RepositorioSitios {
  obtenerPorDominio(ownerId: string, dominio: string): Promise<SitioConectado | null>;
  obtenerPorId(id: string, ownerId: string): Promise<SitioConectado | null>;
  registrarSesionDeLogin(input: {
    ownerId: string;
    dominio: string;
    urlLogin: string;
    contextoExternoId: string;
    proxyRef: string;
    proxyCountry: string;
    egressIp?: string | null;
    fingerprintRef?: string | null;
    sesionExternaId: string;
    vistaEnVivoUrl: string;
  }): Promise<SitioConectado>;
  /** Pinea el pais en una fila LEGADA (proxy_country null). Un pais ya pineado jamas se reescribe. */
  pinearPais(id: string, ownerId: string, pais: string): Promise<SitioConectado | null>;
  reabrirParaLogin(
    id: string,
    ownerId: string,
    input: { urlLogin: string; sesionExternaId: string; vistaEnVivoUrl: string },
  ): Promise<SitioConectado | null>;
  guardarContexto(
    id: string,
    ownerId: string,
    input: {
      contexto: string;
      contextoExternoId?: string | null;
      egressIp?: string | null;
      expiraEn?: string | null;
    },
    vaultSecret: string,
  ): Promise<SitioConectado | null>;
  cerrarLogin(
    id: string,
    ownerId: string,
    estado: 'activo' | 'caducado' | 'error',
  ): Promise<SitioConectado | null>;
  listarEsperandoLoginVencidas(
    cutoffIso: string,
  ): Promise<Array<{ id: string; ownerId: string; sesionExternaId: string | null }>>;
  borrar(
    id: string,
    ownerId: string,
  ): Promise<{ id: string; dominio: string; contextoExternoId: string | null } | null>;
}

/** Dependencias de los jobs de sitios. Se cablean en index.ts SOLO si la config de Browserbase esta. */
export interface SitiosJobDeps {
  repo: RepositorioSitios;
  navegador: NavegadorRemoto;
  /** Secreto de la boveda: el repo de 7.1a cifra el contexto con el ANTES de tocar la base. */
  vaultSecret: string;
  /**
   * ENCADENA la desconexion con data_subject_requests (V014): registra una solicitud de cancelacion
   * ARCO ya resuelta para el owner. Se cablea con DataSubjectRequestRepository en index.ts.
   */
  registrarDesconexionArco(ownerId: string, dominio: string): Promise<void>;
  logger: Logger;
}

/**
 * ¿El proveedor dice que el recurso YA NO EXISTE (404 / not found)? Para la desconexion eso es
 * EXITO, no fallo: el objetivo (que no quede nada alla) ya esta cumplido, tipicamente porque la
 * sesion expiro sola o un intento previo alcanzo a borrar. Se detecta por FORMA (status/statusCode
 * 404, o nombre/mensaje "not found") para no importar el SDK del proveedor en este modulo puro; los
 * fallos reales de red o permisos NO matchean y siguen propagandose.
 */
export function esErrorDeRecursoInexistente(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const status =
    (error as { status?: unknown }).status ?? (error as { statusCode?: unknown }).statusCode;
  if (status === 404) return true;
  if (!(error instanceof Error)) return false;
  return /not[ _-]?found/i.test(`${error.name}: ${error.message}`);
}

/** Mensaje de error sanitizado (nunca URLs ni contextos; ver describeError de execution.ts). */
function describir(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return 'error desconocido';
}

/** Cierra una sesion del proveedor SIN propagar fallos (para caminos de limpieza best-effort). */
async function cerrarSesionBestEffort(
  deps: SitiosJobDeps,
  sesionExternaId: string,
  motivo: string,
): Promise<void> {
  try {
    await deps.navegador.cerrarSesion(sesionExternaId);
  } catch (error) {
    deps.logger.warn('no se pudo cerrar la sesion de navegador (se ignora, best-effort)', {
      motivo,
      err: describir(error),
    });
  }
}

/**
 * kind:'conectar_sitio': abre la sesion de navegador para el login manual y TERMINA. No espera al
 * humano, no hace polling: el entregable es la fila en 'esperando_login' con la vista en vivo, que
 * la UI (7.1c) le muestra al usuario. confirmar_conexion, en un job POSTERIOR, hereda el contexto.
 */
async function conectarSitio(deps: SitiosJobDeps, job: Job, url: string, pais: string): Promise<void> {
  const dominio = dominioDeUrl(url);
  const existente = await deps.repo.obtenerPorDominio(job.ownerId, dominio);

  // Si habia un login en curso para este dominio, su sesion vieja se cierra ANTES de abrir la nueva:
  // jamas se dejan dos sesiones vivas (cuestan minutos del proveedor) ni un id colgado en la fila.
  if (existente?.sesionExternaId) {
    await cerrarSesionBestEffort(deps, existente.sesionExternaId, 'reconexion: reemplaza login previo');
  }

  // El PAIS que gobierna esta conexion: el YA pineado si existe (es inmutable de por vida), o el del
  // usuario (payload) en la primera conexion / en una fila legada sin pais (anterior a V028).
  const paisPineado = existente?.proxyCountry ?? pais;

  // Abrir la sesion: contexto NUEVO si es la primera conexion del dominio; el contexto y la salida
  // PINEADOS si la conexion ya existia, pidiendo SIEMPRE la geolocalizacion del pais pineado. El
  // adaptador lanza SalidaDeRedNoDisponibleError (permanente) si el pin no es reconstruible.
  const sesion = await deps.navegador.abrirSesionParaLogin({
    url,
    contextoExternoId: existente?.contextoExternoId ?? null,
    proxyRef: existente?.proxyRef ?? null,
    proxyCountry: paisPineado,
  });

  // VERIFICACION DEL PIN POR PAIS: el pais de salida OBSERVADO debe ser el pineado. El proveedor
  // hace best-effort con la geolocalizacion (sin cobertura puede enrutar por el pais mas cercano),
  // asi que la garantia es NUESTRA: pais distinto -- o no poder observarlo -- cierra la sesion y
  // FALLA el job. JAMAS se degrada a otro pais (un salto de pais invalida la sesion del usuario en
  // el sitio destino). Un cambio de IP dentro del mismo pais es normal (pool rotativo) y NO falla.
  if (sesion.egressCountry !== paisPineado) {
    await cerrarSesionBestEffort(deps, sesion.sesionExternaId, 'pais de salida distinto al pineado');
    throw new SalidaDeRedNoDisponibleError(
      `no hay ruta de red disponible para tu region (pais pineado al dominio ${dominio}: ${paisPineado}; ` +
        `pais observado: ${sesion.egressCountry ?? 'ninguno'}); no se degrada a otro pais. ` +
        'Reintenta mas tarde.',
    );
  }

  // Persistir el registro en 'esperando_login'. Si la escritura falla, la sesion recien abierta se
  // cierra best-effort antes de propagar: nunca queda una sesion viva sin fila que la referencie.
  try {
    if (existente) {
      await deps.repo.reabrirParaLogin(existente.id, job.ownerId, {
        urlLogin: url,
        sesionExternaId: sesion.sesionExternaId,
        vistaEnVivoUrl: sesion.vistaEnVivoUrl,
      });
      if (existente.proxyCountry === null) {
        // Fila LEGADA (pineada por IP exacta, anterior a V028): este login queda pineado al pais
        // recien verificado. pinearPais solo escribe si proxy_country sigue null (inmutable despues).
        await deps.repo.pinearPais(existente.id, job.ownerId, paisPineado);
      }
    } else {
      await deps.repo.registrarSesionDeLogin({
        ownerId: job.ownerId,
        dominio,
        urlLogin: url,
        contextoExternoId: sesion.contextoExternoId,
        proxyRef: sesion.proxyRef,
        proxyCountry: paisPineado,
        egressIp: sesion.egressIp,
        fingerprintRef: sesion.fingerprintRef,
        sesionExternaId: sesion.sesionExternaId,
        vistaEnVivoUrl: sesion.vistaEnVivoUrl,
      });
    }
  } catch (error) {
    await cerrarSesionBestEffort(deps, sesion.sesionExternaId, 'fallo al persistir la conexion');
    throw error;
  }

  // Solo ids en el log: ni la vista en vivo (permite mirar/manejar la sesion) ni URLs del sitio. El
  // pais y la egress_ip observados van SIEMPRE (observabilidad de la identidad de red por sesion).
  deps.logger.info('sesion de login abierta; esperando al usuario (el job NO espera)', {
    jobId: job.id,
    dominio,
    sesionExternaId: sesion.sesionExternaId,
    reconexion: existente !== null,
    pais: paisPineado,
    egressIp: sesion.egressIp,
  });
}

/**
 * kind:'confirmar_conexion': el usuario avisa que ya se logueo. Reconecta a la sesion por su id,
 * extrae el contexto, lo CIFRA (repositorio de 7.1a, VAULT_SECRET) y persiste, marca 'activo' con
 * expira_en (default 30 dias, configurable por dominio) y CIERRA la sesion del proveedor (que
 * ademas persiste el contexto de su lado).
 */
async function confirmarConexion(deps: SitiosJobDeps, job: Job, connectionId: string): Promise<void> {
  const sitio = await deps.repo.obtenerPorId(connectionId, job.ownerId);
  if (!sitio) {
    throw new PermanentExecutionError(`la conexion ${connectionId} no existe o no es del owner del job`);
  }
  if (sitio.estado !== 'esperando_login' || !sitio.sesionExternaId) {
    throw new PermanentExecutionError(
      `la conexion ${connectionId} no tiene un login en curso (estado: ${sitio.estado}); ` +
        'encola conectar_sitio primero',
    );
  }

  const estado = await deps.navegador.estadoDeSesion(sitio.sesionExternaId);
  if (estado === 'muerta') {
    // La sesion expiro antes de confirmar (o el barrido de otro worker la cerro). Mensaje accionable
    // en la fila y en el fallo del job; permanente: reintentar no la revive.
    await deps.repo.cerrarLogin(sitio.id, job.ownerId, 'error');
    throw new PermanentExecutionError(
      `la sesion de login del dominio ${sitio.dominio} ya expiro sin confirmarse; ` +
        'volve a conectar el sitio y confirma dentro de los 10 minutos',
    );
  }

  // El contexto en claro existe SOLO entre estas dos llamadas, en memoria: guardarContexto lo cifra
  // con VAULT_SECRET antes de tocar la base. Jamas se loguea.
  const contexto = await deps.navegador.extraerContexto(sitio.sesionExternaId);
  const actualizado = await deps.repo.guardarContexto(
    sitio.id,
    job.ownerId,
    {
      contexto,
      contextoExternoId: sitio.contextoExternoId,
      egressIp: sitio.egressIp,
      expiraEn: expiracionDeContexto(sitio.dominio, new Date()),
    },
    deps.vaultSecret,
  );
  if (!actualizado) {
    throw new Error(`la conexion ${connectionId} desaparecio al guardar el contexto`);
  }

  // Cerrar la sesion AL FINAL: el proveedor persiste el contexto de su lado al cerrar (persist), y
  // si el cierre falla el barrido/timeout del proveedor la recoge; el contexto ya quedo cifrado.
  await cerrarSesionBestEffort(deps, sitio.sesionExternaId, 'confirmacion completada');

  deps.logger.info('conexion confirmada: contexto heredado cifrado y sesion cerrada', {
    jobId: job.id,
    connectionId: sitio.id,
    dominio: sitio.dominio,
    expiraEn: actualizado.expiraEn,
  });
}

/**
 * kind:'desconectar_sitio': el borrado ARCO de una conexion, en los tres lados y en este orden:
 * (1) el proveedor externo (cierra la sesion viva si la hay y BORRA el contexto de navegador),
 * (2) la solicitud ARCO en data_subject_requests (V014) via el encadenado inyectado,
 * (3) la fila local (contexto cifrado incluido).
 * El ARCO se registra ANTES de borrar la fila: si el borrado local fallara, el reintento puede
 * duplicar la solicitud (aceptable y visible) pero jamas queda un borrado sin su constancia.
 */
async function desconectarSitio(deps: SitiosJobDeps, job: Job, connectionId: string): Promise<void> {
  const sitio = await deps.repo.obtenerPorId(connectionId, job.ownerId);
  if (!sitio) {
    // Idempotente: un reintento tras un borrado parcial (o un doble encolado) no debe fallar.
    deps.logger.info('desconectar: la conexion ya no existe (no-op idempotente)', {
      jobId: job.id,
      connectionId,
    });
    return;
  }

  if (sitio.sesionExternaId) {
    await cerrarSesionBestEffort(deps, sitio.sesionExternaId, 'desconexion del sitio');
  }

  // El lado EXTERNO del borrado NO es best-effort ante FALLOS REALES: si el proveedor falla por red
  // o permisos, el job falla (transitorio, se reintenta) en vez de dejar un contexto huerfano con
  // credenciales de sesion vivas alla. PERO "el contexto ya no existe" (404) es EXITO idempotente:
  // no queda nada que borrar del lado remoto, y la desconexion DEBE completar igual el ARCO y el
  // borrado local. Sin esto, una fila en 'error' o 'esperando_login' cuya sesion/contexto expiro
  // queda imposible de desconectar (el job reintenta el 404 para siempre).
  if (sitio.contextoExternoId) {
    try {
      await deps.navegador.borrarContexto(sitio.contextoExternoId);
    } catch (error) {
      if (!esErrorDeRecursoInexistente(error)) throw error;
      deps.logger.info('desconectar: el contexto ya no existia en el proveedor (se continua igual)', {
        jobId: job.id,
        connectionId: sitio.id,
        err: describir(error),
      });
    }
  }

  await deps.registrarDesconexionArco(job.ownerId, sitio.dominio);

  await deps.repo.borrar(sitio.id, job.ownerId);

  // La salida de red pineada muere con la fila: el proveedor no reserva proxies por fuera de la
  // sesion, asi que "liberar el proxy" es exactamente descartar el pin (no hay recurso que soltar).
  deps.logger.info('sitio desconectado: contexto borrado en proveedor y base, ARCO registrado', {
    jobId: job.id,
    connectionId: sitio.id,
    dominio: sitio.dominio,
  });
}

/**
 * Punto de entrada de los jobs de sitios: parsea el payload (ya discriminado por kind) y despacha al
 * handler. Lanza en fallo (execution.ts decide reintento/permanente); el llamador marca completed.
 */
export async function procesarJobDeSitio(deps: SitiosJobDeps | undefined, job: Job): Promise<void> {
  if (!deps) {
    throw new PermanentExecutionError(
      'la conexion de sitios no esta configurada en este worker: faltan BROWSERBASE_API_KEY y/o ' +
        'BROWSERBASE_PROJECT_ID en el entorno',
    );
  }
  const parsed = parseSitioJobPayload(job.payload);
  if (!parsed.success) {
    throw new PermanentExecutionError(`payload de sitio invalido: ${parsed.error}`);
  }
  const payload = parsed.data;
  switch (payload.kind) {
    case CONECTAR_SITIO_JOB_KIND:
      return conectarSitio(deps, job, payload.url, payload.pais);
    case CONFIRMAR_CONEXION_JOB_KIND:
      return confirmarConexion(deps, job, payload.connectionId);
    case DESCONECTAR_SITIO_JOB_KIND:
      return desconectarSitio(deps, job, payload.connectionId);
  }
}

/**
 * BARRIDO de logins abandonados: conexiones en 'esperando_login' con mas de LOGIN_TIMEOUT_MS (10
 * min) sin confirmar. Cierra la sesion del proveedor (nunca se dejan sesiones colgadas: cuestan
 * minutos) y marca la fila 'error'. Corre en el loop del worker con el MISMO patron throttled que el
 * reaper de jobs huerfanos (worker.ts); best-effort: un fallo se loguea y el proximo ciclo reintenta.
 */
export async function barrerLoginsVencidos(deps: SitiosJobDeps, ahora: Date): Promise<void> {
  const cutoff = new Date(ahora.getTime() - LOGIN_TIMEOUT_MS).toISOString();
  let vencidas: Array<{ id: string; ownerId: string; sesionExternaId: string | null }>;
  try {
    vencidas = await deps.repo.listarEsperandoLoginVencidas(cutoff);
  } catch (error) {
    deps.logger.error('barrido de logins: fallo al listar (se ignora; se reintenta en el proximo ciclo)', {
      err: describir(error),
    });
    return;
  }
  for (const conexion of vencidas) {
    try {
      if (conexion.sesionExternaId) {
        await deps.navegador.cerrarSesion(conexion.sesionExternaId);
      }
    } catch (error) {
      deps.logger.warn('barrido de logins: no se pudo cerrar la sesion (la fila se marca igual)', {
        connectionId: conexion.id,
        err: describir(error),
      });
    }
    try {
      await deps.repo.cerrarLogin(conexion.id, conexion.ownerId, 'error');
      deps.logger.warn('barrido de logins: login sin confirmar vencido, sesion cerrada y fila en error', {
        connectionId: conexion.id,
      });
    } catch (error) {
      deps.logger.error('barrido de logins: fallo al marcar la fila (se reintenta en el proximo ciclo)', {
        connectionId: conexion.id,
        err: describir(error),
      });
    }
  }
}
