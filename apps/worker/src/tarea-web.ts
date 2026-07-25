import { parseTareaWebJobPayload } from '@ledesma-platform/shared';
import type { Job } from '@ledesma-platform/shared';
// IMPORT DE TIPOS (type-only): igual que sitios.ts, el repositorio real (7.1a) y la boveda se
// INYECTAN; este modulo no carga en runtime el backend ni el SDK de Stagehand. Los tests pasan
// fakes y JAMAS llaman a un modelo ni abren un navegador.
import type { SitioConectado } from '@ledesma-platform/backend/sitios';
import type { AprobacionWeb } from '@ledesma-platform/backend/aprobaciones';
import type { DecryptedProviderCredential } from '@ledesma-platform/backend/execution';
import { PermanentExecutionError } from './errores.js';
import { SalidaDeRedNoDisponibleError, expiracionDeContexto } from './sitios.js';
import {
  clasificarDesenlace,
  construirSystemPromptTareaWeb,
  type DesenlaceTareaWeb,
} from './prompt-tarea-web.js';
import {
  clasificarTipoAccion,
  construirReanudacionAprobada,
  construirReanudacionRechazada,
  extraerDescripcion,
  type NotificadorAprobaciones,
  type RepositorioAprobacionesParaWorker,
} from './aprobaciones.js';
import type { SubidorDeScreenshots } from './storage.js';
import { censurarObjetivo } from './censura.js';
import {
  extraerPasosCensurados,
  type AccionCrudaDeMotor,
  type EstadoTrayectoria,
  type RegistradorDeTrayectorias,
} from './trayectoria.js';
import type { Logger } from './logger.js';

/**
 * Handler del JOB DE TAREA WEB (Fase 7.1d + checkpoints 7.1e): un agente de navegacion por IA
 * (Stagehand) ejecuta el OBJETIVO en lenguaje natural del usuario DENTRO de la sesion que el ya
 * establecio en un sitio conectado (7.1a-7.1c).
 *
 * Lineas rojas (espejo de 7.1b, mas las propias de 7.1d/7.1e):
 *  - El login JAMAS se automatiza ni se reintenta: una pantalla de login/verificacion ABORTA la
 *    tarea al instante, marca el sitio 'caducado' y notifica. CERO reintentos.
 *  - El PAIS de salida es el PINEADO o ninguno: el pais observado se verifica ANTES de navegar y se
 *    RE-VERIFICA al reanudar un checkpoint; si difiere del pais pineado (proxy_country), se aborta y
 *    el sitio queda marcado para reconexion. DECISION DE ARQUITECTURA: el criterio es el PAIS, no la
 *    IP exacta -- los proxies del pool son residenciales rotativos (la IP cambia entre sesiones
 *    dentro del mismo pais y eso es invisible para el sitio destino); lo que invalida una sesion es
 *    un salto de pais. JAMAS se degrada a otro pais. Para sitios de maxima seguridad (banca) se
 *    migrara en el futuro a proxies sticky dedicados (no en esta fase).
 *  - Una accion irreversible o financiera NO se ejecuta sin una aprobacion humana en estado
 *    'aprobada' (7.1e): al detectarla, el worker captura un screenshot, crea el checkpoint, PAUSA
 *    el job y MANTIENE VIVA la sesion (el estado del checkout se pierde si se reabre). El UNICO
 *    camino que la ejecuta es la reanudacion via construirReanudacionAprobada (aprobaciones.ts),
 *    que LANZA si la aprobacion no esta 'aprobada'. Sin excepciones por config, env ni plan.
 *  - Un fallo DESPUES de abrir la sesion es PERMANENTE a proposito: re-ejecutar una navegacion a
 *    medias sobre la cuenta real del usuario puede duplicar efectos.
 *  - El contexto descifrado existe SOLO en memoria entre el descifrado y la inyeccion; jamas se
 *    loguea (ni el, ni el objetivo, ni URLs internas: solo ids y dominios).
 */

/** Desenlace del handler hacia execution.ts: completada (markCompleted) o pausada (el job ya quedo
 *  'pausado' esperando la decision humana; NO se marca completado). */
export type ResultadoTareaWeb = 'completada' | 'pausada';

/**
 * CONTROL EXTERNO de la corrida (cancelacion cooperativa, CAMBIO 3 + D4): lo cablea execution.ts.
 * `signal` aborta el motor a mitad de tarea cuando el job dejo de ser 'running' (cancelado desde la
 * consola); `alCambiarSesion` publica la sesion de navegador ACTIVA (null al cerrarla) para que el
 * corte duro externo pueda cerrarla si el abort no detiene al motor a mitad de un paso.
 */
export interface ControlDeTareaWeb {
  signal?: AbortSignal | undefined;
  alCambiarSesion?: ((sesionExternaId: string | null) => void) | undefined;
}

/** Sesion de navegador abierta para una tarea: referencias minimas (nunca credenciales). */
export interface SesionDeTareaAbierta {
  sesionExternaId: string;
  /** IP de salida OBSERVADA (informativa/observabilidad; NO es criterio de aborto). null = no observable. */
  egressIp: string | null;
  /** PAIS de salida OBSERVADO (ISO 3166-1 alpha-2). Se verifica contra proxy_country. null = no observable. */
  egressCountry: string | null;
}

/** Salida de red observada en una sesion viva (pestana nueva): pais para verificar, IP para logs. */
export interface SalidaObservada {
  egressIp: string | null;
  egressCountry: string | null;
}

/**
 * PUERTO hacia el proveedor de navegador para la tarea web. Lo implementa NavegadorBrowserbase
 * (browserbase.ts, el unico modulo que importa el SDK); los tests pasan fakes.
 */
export interface NavegadorParaTarea {
  /**
   * Abre una sesion RECONECTANDO el contexto guardado y FORZANDO la salida pineada. `proxyRef` y
   * `proxyCountry` son OBLIGATORIOS (una tarea jamas sortea salida nueva ni pais nuevo): si el pin
   * no es reconstruible, lanza SalidaDeRedNoDisponibleError, nunca degrada. El pais OBSERVADO lo
   * verifica el handler contra proxy_country antes de navegar.
   */
  abrirSesionParaTarea(params: {
    contextoExternoId: string;
    proxyRef: string;
    proxyCountry: string;
  }): Promise<SesionDeTareaAbierta>;
  /** Inyecta el contexto de sesion DESCIFRADO (cookies) en la sesion viva, antes de navegar. */
  inyectarContexto(sesionExternaId: string, contexto: string): Promise<void>;
  /**
   * Navega a `url` y detecta DETERMINISTICAMENTE una pantalla de login (campo de contrasena
   * presente), SIN modelo: es el pre-chequeo de caducidad antes de gastar un solo token.
   */
  detectarPantallaDeLogin(sesionExternaId: string, url: string): Promise<boolean>;
  /** Extrae el contexto de sesion actualizado (cookies serializadas) para re-cifrarlo. */
  extraerContexto(sesionExternaId: string): Promise<string>;
  /** Estado actual de una sesion por su id ('viva' | 'muerta'): la reanudacion lo verifica primero. */
  estadoDeSesion(sesionExternaId: string): Promise<'viva' | 'muerta'>;
  /** Screenshot PNG (base64) de la pagina actual, sin tocarla (evidencia del checkpoint 7.1e). */
  capturarPantalla(sesionExternaId: string): Promise<string>;
  /**
   * OBSERVA la salida de red actual (pais + IP) de la sesion viva en una PESTANA NUEVA (sin tocar
   * la pagina de la tarea). Pais null = no observable -> el handler aborta (no se puede verificar).
   */
  observarSalida(sesionExternaId: string): Promise<SalidaObservada>;
  /** Cierra (libera) la sesion en el proveedor. */
  cerrarSesion(sesionExternaId: string): Promise<void>;
}

/**
 * PUERTO hacia el motor de navegacion por IA (Stagehand). El adaptador real (stagehand.ts) es el
 * UNICO modulo del worker que importa Stagehand; los tests pasan fakes y nunca llaman al modelo.
 *
 * SEPARACION INSTRUCCION-VS-CONTENIDO, garantizada por el CONTRATO: el objetivo del usuario viaja
 * SOLO por `objetivo` (canal de instruccion del motor) y las reglas fijas por `systemPrompt`; el
 * contenido de las paginas lo ve el motor por su propio canal de observacion y NUNCA entra aca.
 */
export interface MotorDeTareaWeb {
  ejecutar(params: {
    sesionExternaId: string;
    objetivo: string;
    systemPrompt: string;
    /** API key del owner (boveda) para el modelo. NUNCA se loguea. */
    apiKey: string;
    /** Modelo proveedor/nombre (TAREA_WEB_MODEL). Haiku prohibido (validado en env.ts). */
    model: string;
    maxPasos: number;
    signal?: AbortSignal;
  }): Promise<ResultadoMotor>;
}

/**
 * Resultado de una ejecucion del motor. Ademas del desenlace, expone la TRAZA de acciones que el
 * motor ejecuto (AgentResult.actions de Stagehand v3) y los tokens consumidos: es el insumo del
 * registro de trayectorias (Fase F). Las acciones vienen CRUDAS del motor; el handler las CENSURA
 * (trayectoria.ts) antes de persistir cualquier cosa.
 */
export interface ResultadoMotor {
  exito: boolean;
  mensaje: string;
  /** Acciones ejecutadas, en orden. Vacia si el motor no llego a ejecutar ninguna. */
  acciones: AccionCrudaDeMotor[];
  /** Tokens reportados por el motor (usage). null = no reportados. */
  tokensIn: number | null;
  tokensOut: number | null;
}

/** Subconjunto del SitiosConectadosRepository (7.1a) que la tarea web usa (facil de mockear). */
export interface RepositorioSitiosParaTarea {
  obtenerPorId(id: string, ownerId: string): Promise<SitioConectado | null>;
  obtenerContextoDescifrado(id: string, ownerId: string, vaultSecret: string): Promise<string | null>;
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
  actualizarEstado(
    id: string,
    ownerId: string,
    estado: 'activo' | 'caducado' | 'error' | 'esperando_login',
  ): Promise<SitioConectado | null>;
}

/** Dependencias del job de tarea web. index.ts cablea las reales; los tests pasan fakes. */
export interface TareaWebDeps {
  repo: RepositorioSitiosParaTarea;
  navegador: NavegadorParaTarea;
  motor: MotorDeTareaWeb;
  /** Repositorio de checkpoints de aprobacion (V027): crear al pausar, leer la decision al reanudar. */
  aprobaciones: RepositorioAprobacionesParaWorker;
  /** Vida de una aprobacion pendiente, en ms (APROBACION_TTL_MINUTOS; default 15 min). */
  aprobacionTtlMs: number;
  /** Pausa el job en la cola ('running' -> 'pausado', JobsRepository.marcarPausado). */
  marcarJobPausado(jobId: string): Promise<void>;
  /** Sube el screenshot del checkpoint a Storage (best-effort). OPCIONAL: sin config, sin screenshot. */
  subidorScreenshots?: SubidorDeScreenshots | undefined;
  /**
   * Registro de TRAYECTORIAS (Fase F, V030): persiste la traza censurada de cada ejecucion del motor
   * (exitosa, fallida o pausada). Best-effort SIEMPRE: un fallo del registro jamas cambia el
   * desenlace de la tarea. OPCIONAL para no romper el cableado en despliegues sin la migracion.
   */
  trayectorias?: RegistradorDeTrayectorias | undefined;
  /** Notifica por correo la aprobacion pendiente/expirada (best-effort). OPCIONAL. */
  notificadorAprobaciones?: NotificadorAprobaciones | undefined;
  /** Secreto de la boveda: descifra el contexto (7.1a) y re-cifra el actualizado. */
  vaultSecret: string;
  /** Modelo de la navegacion (TAREA_WEB_MODEL; Haiku prohibido, validado al parsear el env). */
  model: string;
  /** Cap DURO de iteraciones (pasos del agente de navegacion) por corrida (TAREA_WEB_MAX_STEPS). */
  maxPasos: number;
  /** Deadline de pared de la tarea, en ms (TAREA_WEB_TIMEOUT_SECONDS * 1000). */
  runTimeoutMs: number;
  /** Resuelve y descifra la credencial del owner (la key del modelo sale de la boveda). */
  resolveCredential(ownerId: string, credentialId: string): Promise<DecryptedProviderCredential>;
  /** Persiste el resultado del job (jobs.resultado, V026) antes del cierre. */
  guardarResultado(jobId: string, resultado: unknown): Promise<void>;
  logger: Logger;
}

/** Mensaje accionable estandar cuando la conexion no esta en condiciones de ejecutar tareas. */
const MENSAJE_RECONECTAR =
  'el sitio no esta conectado o la sesion caduco, vuelve a conectarlo desde la consola';

/** Mensaje de error sanitizado (nunca contextos, objetivos ni URLs). */
function describir(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return 'error desconocido';
}

/**
 * Marca el estado del sitio SIN propagar fallos: el estado del sitio es informativo; el desenlace
 * del job ya esta decidido y un fallo de esta escritura no debe cambiarlo.
 */
async function marcarSitioBestEffort(
  deps: TareaWebDeps,
  sitio: SitioConectado,
  ownerId: string,
  estado: 'caducado' | 'error',
): Promise<void> {
  try {
    await deps.repo.actualizarEstado(sitio.id, ownerId, estado);
  } catch (error) {
    deps.logger.error('tarea web: no se pudo marcar el estado del sitio (se ignora, best-effort)', {
      connectionId: sitio.id,
      estado,
      err: describir(error),
    });
  }
}

/**
 * Guarda el contexto ACTUALIZADO de la sesion (re-cifrado) y refresca ultimo_uso_en. Best-effort en
 * DOS niveles: si la extraccion falla (la sesion murio justo al terminar), se RE-GUARDA el contexto
 * anterior (sigue siendo valido) solo para refrescar ultimo_uso_en; si tambien eso falla, se loguea
 * y el job NO falla (la tarea YA se ejecuto con exito; perder el refresco no la deshace).
 */
async function refrescarContextoBestEffort(
  deps: TareaWebDeps,
  sitio: SitioConectado,
  ownerId: string,
  sesionExternaId: string,
  contextoAnterior: string,
): Promise<void> {
  let contexto = contextoAnterior;
  try {
    contexto = await deps.navegador.extraerContexto(sesionExternaId);
  } catch (error) {
    deps.logger.warn('tarea web: no se pudo extraer el contexto actualizado; se conserva el anterior', {
      connectionId: sitio.id,
      err: describir(error),
    });
  }
  try {
    await deps.repo.guardarContexto(
      sitio.id,
      ownerId,
      {
        contexto,
        contextoExternoId: sitio.contextoExternoId,
        egressIp: sitio.egressIp,
        expiraEn: expiracionDeContexto(sitio.dominio, new Date()),
      },
      deps.vaultSecret,
    );
  } catch (error) {
    deps.logger.error('tarea web: fallo al guardar el contexto actualizado (se ignora, best-effort)', {
      connectionId: sitio.id,
      err: describir(error),
    });
  }
}

/**
 * PAUSA la tarea en un CHECKPOINT DE APROBACION (7.1e): captura la evidencia, crea la fila
 * 'pendiente', deja el job 'pausado' y devuelve 'pausada' para que el llamador NO cierre la sesion
 * (debe seguir VIVA: el estado del checkout se pierde si se reabre; la cierra la decision o el
 * barrido de vencidas). Si el checkpoint NO se puede persistir, cae al comportamiento de 7.1d
 * (bloquear y completar con 'requiere_aprobacion'): jamas se deja una sesion viva que nadie puede
 * aprobar, y la accion NUNCA se ejecuta en ninguna de las dos ramas.
 */
async function pausarEnCheckpoint(
  deps: TareaWebDeps,
  job: Job,
  sitio: SitioConectado,
  sesionExternaId: string,
  detalle: string,
  contexto: string,
): Promise<ResultadoTareaWeb | 'fallback'> {
  const descripcion = extraerDescripcion(detalle);
  const accionTipo = clasificarTipoAccion(detalle);

  // Screenshot best-effort: la evidencia ayuda a decidir, pero su falta jamas bloquea el checkpoint.
  let screenshotBase64: string | null = null;
  try {
    screenshotBase64 = await deps.navegador.capturarPantalla(sesionExternaId);
  } catch (error) {
    deps.logger.warn('tarea web: no se pudo capturar el screenshot del checkpoint (se sigue sin el)', {
      jobId: job.id,
      err: describir(error),
    });
  }

  let aprobacion: AprobacionWeb;
  try {
    aprobacion = await deps.aprobaciones.crear({
      ownerId: job.ownerId,
      jobId: job.id,
      connectionId: sitio.id,
      sesionExternaId,
      accionTipo,
      descripcion,
      screenshotPath: null,
      expiraEn: new Date(Date.now() + deps.aprobacionTtlMs),
    });
  } catch (error) {
    deps.logger.error(
      'tarea web: no se pudo crear el checkpoint de aprobacion; se bloquea la accion y se cierra (fallback 7.1d)',
      { jobId: job.id, err: describir(error) },
    );
    return 'fallback';
  }

  // El path del screenshot incluye el id de la aprobacion, asi que se sube DESPUES de crearla. La
  // fila se creo con screenshot_path null; la UI tolera su ausencia y el path se persiste si llega.
  if (screenshotBase64 !== null && deps.subidorScreenshots) {
    const path = await deps.subidorScreenshots.subir(job.ownerId, aprobacion.id, screenshotBase64);
    if (path !== null) {
      try {
        await deps.aprobaciones.guardarScreenshotPath(aprobacion.id, path);
        aprobacion = { ...aprobacion, screenshotPath: path };
      } catch (error) {
        deps.logger.warn('tarea web: no se pudo guardar el path del screenshot (se sigue sin el)', {
          jobId: job.id,
          err: describir(error),
        });
      }
    }
  }

  // La sesion se uso legitimamente hasta el bloqueo: refresca contexto y ultimo_uso_en como siempre.
  await refrescarContextoBestEffort(deps, sitio, job.ownerId, sesionExternaId, contexto);

  if (deps.notificadorAprobaciones) {
    await deps.notificadorAprobaciones.notificarPendiente({
      ownerId: job.ownerId,
      jobId: job.id,
      dominio: sitio.dominio,
      descripcion,
      expiraEnIso: aprobacion.expiraEn,
    });
  }

  // Resultado (canal de vuelta al agente/UI) ANTES de pausar: guardarResultado escribe sobre 'running'.
  await deps.guardarResultado(job.id, {
    estado: 'esperando_aprobacion',
    aprobacionId: aprobacion.id,
    descripcion,
    expiraEn: aprobacion.expiraEn,
  });
  await deps.marcarJobPausado(job.id);

  deps.logger.info('tarea web PAUSADA en checkpoint de aprobacion humana (sesion viva)', {
    jobId: job.id,
    connectionId: sitio.id,
    dominio: sitio.dominio,
    aprobacionId: aprobacion.id,
    accionTipo,
  });
  return 'pausada';
}

/**
 * kind:'tarea_web': ejecuta el objetivo del usuario dentro de la sesion activa del sitio conectado.
 * Lanza en fallo (execution.ts decide el cierre). Devuelve 'completada' (el llamador marca
 * completed) o 'pausada' (el job ya quedo 'pausado' en un checkpoint; NO marcar completed).
 * TODOS los fallos posteriores a la apertura de la sesion son PERMANENTES (ver nota de cabecera).
 */
export async function procesarTareaWeb(
  deps: TareaWebDeps | undefined,
  job: Job,
  control?: ControlDeTareaWeb,
): Promise<ResultadoTareaWeb> {
  if (!deps) {
    throw new PermanentExecutionError(
      'la tarea web no esta configurada en este worker: faltan BROWSERBASE_API_KEY y/o ' +
        'BROWSERBASE_PROJECT_ID en el entorno',
    );
  }
  const parsed = parseTareaWebJobPayload(job.payload);
  if (!parsed.success) {
    throw new PermanentExecutionError(`payload de tarea web invalido: ${parsed.error}`);
  }
  const { connectionId, objetivo } = parsed.data;

  // 1. La conexion debe existir, ser del owner del job y estar 'activo'. Cualquier otra cosa falla
  //    con el mensaje accionable ANTES de crear sesion alguna (no se gasta ni un minuto de navegador).
  const sitio = await deps.repo.obtenerPorId(connectionId, job.ownerId);
  if (!sitio || sitio.estado !== 'activo') {
    throw new PermanentExecutionError(MENSAJE_RECONECTAR);
  }
  if (!sitio.contextoExternoId || !sitio.proxyRef || !sitio.proxyCountry) {
    // Sin contexto, sin salida pineada o sin PAIS pineado (fila legada anterior a V028) no hay
    // sesion que reanudar ni pin que verificar: reconectar el sitio pinea el pais.
    throw new PermanentExecutionError(MENSAJE_RECONECTAR);
  }

  // 2. Descifrar el contexto (VAULT_SECRET). El claro vive SOLO en memoria hasta inyectarContexto.
  const contexto = await deps.repo.obtenerContextoDescifrado(connectionId, job.ownerId, deps.vaultSecret);
  if (contexto === null) {
    throw new PermanentExecutionError(MENSAJE_RECONECTAR);
  }

  // La key del modelo sale de la boveda del owner (misma via que todo job). La navegacion usa un
  // modelo Claude (TAREA_WEB_MODEL): la credencial debe ser de anthropic.
  if (job.credentialId === null) {
    throw new PermanentExecutionError(
      'job de tarea web sin credencial: encola la tarea via la tool del agente',
    );
  }
  const credential = await deps.resolveCredential(job.ownerId, job.credentialId);
  if (credential.providerId !== 'anthropic') {
    throw new PermanentExecutionError(
      `la tarea web requiere una credencial de anthropic (la credencial del job es de ${credential.providerId})`,
    );
  }

  // 2.5. REANUDACION (7.1e): si este job tiene un checkpoint DECIDIDO, no se abre sesion nueva; se
  //      retoma LA MISMA sesion que quedo viva al pausar. Un job recien encolado no tiene aprobacion
  //      y sigue el camino de siempre.
  const aprobacion = await deps.aprobaciones.obtenerVigentePorJob(job.id, job.ownerId);
  if (aprobacion !== null && aprobacion.estado !== 'expirada') {
    return reanudarTrasDecision(deps, job, sitio, objetivo, credential, contexto, aprobacion, control);
  }

  // 3. Abrir la sesion RECONECTANDO el contexto guardado y FORZANDO el proxy pineado con la
  //    geolocalizacion del PAIS pineado. El adaptador lanza SalidaDeRedNoDisponibleError
  //    (permanente) si el pin no es reconstruible.
  const sesion = await deps.navegador.abrirSesionParaTarea({
    contextoExternoId: sitio.contextoExternoId,
    proxyRef: sitio.proxyRef,
    proxyCountry: sitio.proxyCountry,
  });
  control?.alCambiarSesion?.(sesion.sesionExternaId);
  deps.logger.info('tarea web: sesion abierta con el pais pineado', {
    jobId: job.id,
    connectionId: sitio.id,
    dominio: sitio.dominio,
    pais: sesion.egressCountry,
    egressIp: sesion.egressIp,
  });

  // La sesion se cierra SIEMPRE salvo que la tarea quede PAUSADA en un checkpoint: ahi DEBE seguir
  // viva (el estado del checkout se pierde si se reabre) y la cierran la decision o el barrido.
  let mantenerSesionViva = false;
  try {
    // 4. VERIFICAR el PAIS de salida ANTES de navegar: si el observado difiere del pineado (o no se
    //    pudo observar), se ABORTA sin ejecutar nada, el sitio queda 'error' (marcado para
    //    reconectar) y se notifica. Un salto de pais puede costarle la sesion al usuario; un cambio
    //    de IP dentro del MISMO pais es rotacion normal del pool y NO aborta. JAMAS se degrada.
    if (sesion.egressCountry !== sitio.proxyCountry) {
      await marcarSitioBestEffort(deps, sitio, job.ownerId, 'error');
      throw new SalidaDeRedNoDisponibleError(
        `no hay ruta de red disponible para tu region (pais pineado al dominio ${sitio.dominio}: ` +
          `${sitio.proxyCountry}; pais observado: ${sesion.egressCountry ?? 'ninguno'}); la tarea NO ` +
          'se ejecuto y no se degrada a otro pais. Reintenta mas tarde o reconecta el sitio.',
      );
    }

    // 5. Inyectar el contexto (cookies) y PRE-CHEQUEAR caducidad SIN modelo: si el sitio ya muestra
    //    una pantalla de login, se aborta antes de gastar un token. CERO reintentos de login.
    await deps.navegador.inyectarContexto(sesion.sesionExternaId, contexto);
    const urlInicial = `https://${sitio.dominio}/`;
    const pantallaDeLogin = await deps.navegador.detectarPantallaDeLogin(sesion.sesionExternaId, urlInicial);
    if (pantallaDeLogin) {
      await marcarSitioBestEffort(deps, sitio, job.ownerId, 'caducado');
      throw new PermanentExecutionError(
        `la sesion del sitio ${sitio.dominio} caduco (el sitio pide login de nuevo); ` +
          'vuelve a conectarlo desde la consola para reanudar las tareas',
      );
    }

    // 6. Ejecutar el objetivo con el motor de navegacion, bajo el deadline de pared del worker y el
    //    cap DURO de pasos. La ejecucion queda REGISTRADA como trayectoria (V030) sea cual sea el
    //    desenlace, ya clasificado por los marcadores del prompt.
    const { resultado, desenlace } = await ejecutarMotorConRegistro(
      deps,
      job,
      sitio,
      objetivo,
      sesion.sesionExternaId,
      credential.apiKey,
      { objetivo, systemPrompt: construirSystemPromptTareaWeb() },
      control?.signal,
    );

    if (desenlace.tipo === 'sesion_caducada') {
      await marcarSitioBestEffort(deps, sitio, job.ownerId, 'caducado');
      throw new PermanentExecutionError(
        `la sesion del sitio ${sitio.dominio} caduco a mitad de la tarea (aparecio una pantalla de ` +
          'login o verificacion); vuelve a conectarlo desde la consola para reanudar las tareas',
      );
    }

    if (desenlace.tipo === 'requiere_aprobacion') {
      // Accion irreversible/financiera detectada y NO ejecutada: checkpoint de aprobacion (7.1e).
      const pausa = await pausarEnCheckpoint(
        deps,
        job,
        sitio,
        sesion.sesionExternaId,
        desenlace.detalle,
        contexto,
      );
      if (pausa === 'pausada') {
        mantenerSesionViva = true;
        return 'pausada';
      }
      // Fallback (no se pudo persistir el checkpoint): comportamiento 7.1d, bloquear y completar.
      await deps.guardarResultado(job.id, {
        estado: 'requiere_aprobacion',
        detalle: desenlace.detalle,
      });
      return 'completada';
    }

    if (!resultado.exito) {
      throw new PermanentExecutionError(
        `la tarea no se pudo completar dentro del limite de pasos configurado (${deps.maxPasos} ` +
          'pasos); no se reintenta automaticamente para no repetir acciones sobre la cuenta del usuario',
      );
    }

    // 8. Exito: guardar el contexto ACTUALIZADO (re-cifrado) + refrescar ultimo_uso_en, y devolver
    //    el resultado al agente via jobs.resultado (V026).
    await refrescarContextoBestEffort(deps, sitio, job.ownerId, sesion.sesionExternaId, contexto);
    await deps.guardarResultado(job.id, { estado: 'ok', resumen: desenlace.resumen });
    deps.logger.info('tarea web completada dentro de la sesion del sitio', {
      jobId: job.id,
      connectionId: sitio.id,
      dominio: sitio.dominio,
    });
    return 'completada';
  } finally {
    if (!mantenerSesionViva) {
      await cerrarSesionBestEffort(deps, sesion.sesionExternaId);
    }
    // La sesion dejo de ser responsabilidad de esta corrida: cerrada aqui, o (pausada) del
    // checkpoint y su barrido. El corte duro externo ya no debe tocarla.
    control?.alCambiarSesion?.(null);
  }
}

/** Cierra la sesion sin propagar (minutos del proveedor + higiene; el desenlace ya esta decidido). */
async function cerrarSesionBestEffort(deps: TareaWebDeps, sesionExternaId: string): Promise<void> {
  try {
    await deps.navegador.cerrarSesion(sesionExternaId);
  } catch (error) {
    deps.logger.warn('tarea web: no se pudo cerrar la sesion de navegador (se ignora, best-effort)', {
      err: describir(error),
    });
  }
}

/**
 * Persiste la TRAYECTORIA de una ejecucion del motor (V030), SIEMPRE best-effort: la traza es
 * observabilidad; su fallo jamas cambia el desenlace de la tarea (misma politica que el screenshot
 * del checkpoint). El objetivo y las acciones pasan por la CENSURA (censura.ts / trayectoria.ts)
 * ANTES de salir de este proceso: valores de campos sensibles nunca llegan a la base.
 */
async function guardarTrayectoriaBestEffort(
  deps: TareaWebDeps,
  job: Job,
  sitio: SitioConectado,
  objetivo: string,
  estado: EstadoTrayectoria,
  iniciadaEn: Date,
  resultado: Pick<ResultadoMotor, 'acciones' | 'tokensIn' | 'tokensOut'>,
): Promise<void> {
  if (!deps.trayectorias) return;
  const terminadaEn = new Date();
  try {
    await deps.trayectorias.guardar({
      ownerId: job.ownerId,
      jobId: job.id,
      connectionId: sitio.id,
      dominio: sitio.dominio,
      objetivo: censurarObjetivo(objetivo),
      estado,
      iniciadaEn,
      terminadaEn,
      duracionMs: Math.max(0, terminadaEn.getTime() - iniciadaEn.getTime()),
      tokensIn: resultado.tokensIn,
      tokensOut: resultado.tokensOut,
      pasos: extraerPasosCensurados(resultado.acciones),
    });
  } catch (error) {
    deps.logger.warn('tarea web: no se pudo registrar la trayectoria (se ignora, best-effort)', {
      jobId: job.id,
      connectionId: sitio.id,
      err: describir(error),
    });
  }
}

/**
 * Corre el motor y REGISTRA la trayectoria de la ejecucion (exitosa, fallida o pausada) antes de
 * devolver el desenlace. Si el motor LANZA (p.ej. el deadline de pared aborto la navegacion), la
 * trayectoria fallida queda igual, sin pasos (el motor no devolvio la traza), como constancia para
 * depurar; el error se re-propaga intacto.
 */
async function ejecutarMotorConRegistro(
  deps: TareaWebDeps,
  job: Job,
  sitio: SitioConectado,
  objetivo: string,
  sesionExternaId: string,
  apiKey: string,
  prompt: { objetivo: string; systemPrompt: string },
  senalExterna?: AbortSignal,
): Promise<{ resultado: ResultadoMotor; desenlace: DesenlaceTareaWeb }> {
  const iniciadaEn = new Date();
  let resultado: ResultadoMotor;
  try {
    resultado = await ejecutarMotor(deps, sesionExternaId, apiKey, prompt, senalExterna);
  } catch (error) {
    await guardarTrayectoriaBestEffort(deps, job, sitio, objetivo, 'fallida', iniciadaEn, {
      acciones: [],
      tokensIn: null,
      tokensOut: null,
    });
    throw error;
  }
  const desenlace = clasificarDesenlace(resultado.mensaje);
  const estado: EstadoTrayectoria =
    desenlace.tipo === 'requiere_aprobacion'
      ? 'pausada'
      : desenlace.tipo === 'ok' && resultado.exito
        ? 'exitosa'
        : 'fallida';
  await guardarTrayectoriaBestEffort(deps, job, sitio, objetivo, estado, iniciadaEn, resultado);
  return { resultado, desenlace };
}

/**
 * Corre el motor con el deadline de pared del worker (mismo patron AbortController de 7.1d). La
 * senal EXTERNA (cancelacion cooperativa) se encadena al mismo controller: cualquiera de las dos
 * (deadline o cancelacion) aborta la corrida del motor a mitad de tarea.
 */
async function ejecutarMotor(
  deps: TareaWebDeps,
  sesionExternaId: string,
  apiKey: string,
  prompt: { objetivo: string; systemPrompt: string },
  senalExterna?: AbortSignal,
): Promise<ResultadoMotor> {
  const controller = new AbortController();
  let expiroDeadline = false;
  const alAbortarExterno = (): void => controller.abort();
  if (senalExterna?.aborted) controller.abort();
  else senalExterna?.addEventListener('abort', alAbortarExterno, { once: true });
  const timer = setTimeout(() => {
    expiroDeadline = true;
    controller.abort();
  }, deps.runTimeoutMs);
  try {
    return await deps.motor.ejecutar({
      sesionExternaId,
      objetivo: prompt.objetivo,
      systemPrompt: prompt.systemPrompt,
      apiKey,
      model: deps.model,
      maxPasos: deps.maxPasos,
      signal: controller.signal,
    });
  } catch (error) {
    // Fallo del motor con la sesion ya abierta: PERMANENTE (no se re-ejecuta una navegacion a
    // medias sobre la cuenta real). El mensaje va sanitizado: nunca el objetivo ni contenido. Si el
    // que corto fue el deadline de pared, el mensaje lo dice con los segundos configurados
    // (diagnostico interno); cualquier otro fallo conserva el mensaje sanitizado de siempre.
    if (expiroDeadline) {
      throw new PermanentExecutionError(
        `la tarea no se pudo completar dentro del deadline de pared configurado ` +
          `(${Math.round(deps.runTimeoutMs / 1000)} segundos); no se reintenta automaticamente ` +
          'para no repetir acciones sobre la cuenta del usuario',
      );
    }
    throw new PermanentExecutionError(`la navegacion fallo: ${describir(error)}`);
  } finally {
    clearTimeout(timer);
    senalExterna?.removeEventListener('abort', alAbortarExterno);
  }
}

/**
 * REANUDACION de un job pausado en un checkpoint, tras la DECISION humana (7.1e). Retoma LA MISMA
 * sesion que quedo viva al pausar (mismo proxy pineado):
 *  - 'rechazada' SIN instruccion: aborta limpio, cierra la sesion, resultado "rechazada por el usuario".
 *  - 'aprobada': RE-VERIFICA la egress_ip pineada (pestana nueva, sin tocar la pagina) y ejecuta la
 *    accion aprobada; el prompt de ejecucion SOLO lo produce construirReanudacionAprobada, que LANZA
 *    si la aprobacion no esta 'aprobada' (restriccion dura).
 *  - 'rechazada' CON instruccion: misma re-verificacion; la instruccion entra como ajuste del usuario
 *    y la accion original queda prohibida (las reglas de bloqueo siguen intactas).
 * Una aprobacion aun 'pendiente' aqui es un estado imposible (el job solo vuelve a 'pending' con la
 * decision): fallo permanente sin ejecutar nada; el barrido de vencidas cerrara la sesion.
 */
async function reanudarTrasDecision(
  deps: TareaWebDeps,
  job: Job,
  sitio: SitioConectado,
  objetivo: string,
  credential: DecryptedProviderCredential,
  contexto: string,
  aprobacion: AprobacionWeb,
  control?: ControlDeTareaWeb,
): Promise<ResultadoTareaWeb> {
  const sesionExternaId = aprobacion.sesionExternaId;

  if (aprobacion.estado === 'pendiente') {
    throw new PermanentExecutionError(
      'el job se reanudo con su aprobacion aun pendiente (estado inconsistente); la accion NO se ' +
        'ejecuto. El barrido de aprobaciones vencidas cerrara la sesion.',
    );
  }

  // La sesion DEBE seguir viva: el checkpoint pauso precisamente para no perder el estado de la
  // pagina. Muerta (timeout del proveedor, cierre externo) = abortar sin ejecutar nada.
  const estadoSesion = await deps.navegador.estadoDeSesion(sesionExternaId);
  if (estadoSesion === 'muerta') {
    throw new PermanentExecutionError(
      'la sesion del navegador expiro antes de reanudar el checkpoint; la accion NO se ejecuto. ' +
        'Vuelve a pedirle la tarea a tu agente.',
    );
  }

  control?.alCambiarSesion?.(sesionExternaId);
  let mantenerSesionViva = false;
  try {
    if (aprobacion.estado === 'rechazada' && aprobacion.instruccionRechazo === null) {
      // Rechazo limpio: cero navegacion extra, cero modelo. Cerrar y reportar.
      await deps.guardarResultado(job.id, {
        estado: 'rechazada',
        detalle: 'rechazada por el usuario',
        aprobacionId: aprobacion.id,
      });
      deps.logger.info('tarea web abortada: el usuario rechazo la accion del checkpoint', {
        jobId: job.id,
        connectionId: sitio.id,
        aprobacionId: aprobacion.id,
      });
      return 'completada';
    }

    // RE-VERIFICACION del pin POR PAIS (igual que 7.1d, en pestana nueva): la sesion vivio pausada
    // un rato y el proxy pudo cambiar por debajo. Pais distinto (o no observable) = ABORTAR sin
    // ejecutar nada; un cambio de IP dentro del mismo pais NO aborta. JAMAS se degrada.
    const salida = await deps.navegador.observarSalida(sesionExternaId);
    deps.logger.info('tarea web: salida de red observada al reanudar el checkpoint', {
      jobId: job.id,
      connectionId: sitio.id,
      pais: salida.egressCountry,
      egressIp: salida.egressIp,
    });
    if (sitio.proxyCountry === null || salida.egressCountry !== sitio.proxyCountry) {
      await marcarSitioBestEffort(deps, sitio, job.ownerId, 'error');
      throw new SalidaDeRedNoDisponibleError(
        `no hay ruta de red disponible para tu region (pais pineado al dominio ${sitio.dominio}: ` +
          `${sitio.proxyCountry ?? 'ninguno'}; pais observado: ${salida.egressCountry ?? 'ninguno'}); ` +
          'la accion aprobada NO se ejecuto y no se degrada a otro pais. Reintenta mas tarde o ' +
          'reconecta el sitio.',
      );
    }

    // Prompt de la reanudacion. construirReanudacionAprobada es el UNICO productor del prompt que
    // autoriza ejecutar la accion pendiente y LANZA si la aprobacion no esta 'aprobada'.
    const prompt =
      aprobacion.estado === 'aprobada'
        ? construirReanudacionAprobada(aprobacion, objetivo)
        : construirReanudacionRechazada(aprobacion, objetivo, aprobacion.instruccionRechazo ?? '');

    // La reanudacion tambien queda registrada como SU PROPIA trayectoria (la corrida inicial quedo
    // 'pausada' en el checkpoint).
    const { resultado, desenlace } = await ejecutarMotorConRegistro(
      deps,
      job,
      sitio,
      objetivo,
      sesionExternaId,
      credential.apiKey,
      prompt,
      control?.signal,
    );

    if (desenlace.tipo === 'sesion_caducada') {
      await marcarSitioBestEffort(deps, sitio, job.ownerId, 'caducado');
      throw new PermanentExecutionError(
        `la sesion del sitio ${sitio.dominio} caduco al reanudar la tarea; ` +
          'vuelve a conectarlo desde la consola',
      );
    }

    if (desenlace.tipo === 'requiere_aprobacion') {
      // La tarea reanudada topo con OTRA accion irreversible/financiera: nuevo checkpoint, misma
      // sesion. La aprobacion anterior ya quedo consumida (decidida); esta es una fila nueva.
      const pausa = await pausarEnCheckpoint(
        deps,
        job,
        sitio,
        sesionExternaId,
        desenlace.detalle,
        contexto,
      );
      if (pausa === 'pausada') {
        mantenerSesionViva = true;
        return 'pausada';
      }
      await deps.guardarResultado(job.id, {
        estado: 'requiere_aprobacion',
        detalle: desenlace.detalle,
      });
      return 'completada';
    }

    if (!resultado.exito) {
      throw new PermanentExecutionError(
        `la tarea reanudada no se pudo completar dentro del limite de pasos configurado ` +
          `(${deps.maxPasos} pasos); no se reintenta automaticamente para no repetir acciones ` +
          'sobre la cuenta del usuario',
      );
    }

    await refrescarContextoBestEffort(deps, sitio, job.ownerId, sesionExternaId, contexto);
    await deps.guardarResultado(job.id, {
      estado: 'ok',
      resumen: desenlace.resumen,
      aprobacionId: aprobacion.id,
    });
    deps.logger.info('tarea web reanudada y completada tras la decision del checkpoint', {
      jobId: job.id,
      connectionId: sitio.id,
      aprobacionId: aprobacion.id,
      decision: aprobacion.estado,
    });
    return 'completada';
  } finally {
    if (!mantenerSesionViva) {
      await cerrarSesionBestEffort(deps, sesionExternaId);
    }
    control?.alCambiarSesion?.(null);
  }
}
