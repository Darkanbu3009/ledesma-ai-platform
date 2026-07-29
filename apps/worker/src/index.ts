import { JobsRepository } from '@ledesma-platform/shared';
import {
  assembleAgentRun,
  runAgent,
  AgentRepository,
  AgentRunRepository,
  ProviderCredentialRepository,
  resolveStoredCredential,
  RegistrationRepository,
} from '@ledesma-platform/backend/execution';
import { DataSubjectRequestRepository, SitiosConectadosRepository } from '@ledesma-platform/backend/sitios';
import { AprobacionesWebRepository } from '@ledesma-platform/backend/aprobaciones';
import { PoliticasEjecucionRepository } from '@ledesma-platform/backend/politicas';
import { TrayectoriasWebRepository } from '@ledesma-platform/backend/trayectorias';
import { RecetasWebRepository } from '@ledesma-platform/backend/recetas-web';
import { AprendizajeSitiosRepository } from '@ledesma-platform/backend/aprendizaje-sitios';
import { GrabacionesRepository } from '@ledesma-platform/backend/grabaciones';
import { claveDelAtlas } from './atlas-sitios.js';
import { crearNotificadorAprobaciones, type BarridoAprobacionesDeps } from './aprobaciones.js';
import { crearSubidorDeScreenshots } from './storage.js';
import { parseEnv, type WorkerEnv } from './env.js';
import { NavegadorBrowserbase } from './browserbase.js';
import type { SitiosJobDeps } from './sitios.js';
import { MotorStagehand } from './stagehand.js';
import { crearElectorDeTareaEnsenada } from './modelo-eleccion.js';
import type { TareaWebDeps } from './tarea-web.js';
import type { GrabacionDeps } from './grabacion.js';
import { createLogger } from './logger.js';
import { verificarParcheStagehand } from './parche-stagehand.js';
import { getSql, closeSql } from './db.js';
import { startWorker } from './worker.js';
import { crearNotificadorFallos, leerEmailOwner, leerNombreAgente } from './alertas.js';
import type { JobRunnerDeps } from './execution.js';

/**
 * Punto de entrada del WORKER de ejecucion autonoma (Fase 5). Lee la config/env, se conecta a la MISMA
 * base que el backend y arranca el loop que TOMA jobs de la cola (V008) y los EJECUTA: resuelve la
 * credencial de la boveda por owner + credential, arma el run con la capa reutilizable del backend
 * (assembleAgentRun) y corre runAgent con un deadline de pared propio, cerrando cada job con exito o
 * con reintentos. El scheduler (PR 5.3) y los triggers (PR 5.4) son los que ENCOLAN; este proceso solo
 * CONSUME lo que ya esta en la cola.
 */
function loadConfig(): WorkerEnv {
  try {
    return parseEnv();
  } catch (err) {
    console.error('Configuracion de entorno invalida:');
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

/**
 * El parche de Stagehand se comprueba ANTES de leer la config y de tocar la base: un worker sin
 * parche navega igual y falla mas tarde, de forma determinista, en la tarea web. Preferimos que no
 * arranque y que el motivo quede en el log del despliegue (ver src/parche-stagehand.ts).
 */
async function verificarParche(): Promise<void> {
  try {
    await verificarParcheStagehand();
  } catch (err) {
    console.error('Parche de Stagehand no aplicado: el worker no arranca.');
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

function main(): void {
  const config = loadConfig();
  const logger = createLogger(config.LOG_LEVEL);
  const sql = getSql(config.DATABASE_URL);

  // Repos del backend reusados via el subpath @ledesma-platform/backend/execution (mismo motor y boveda
  // que la ruta HTTP, sin duplicar logica). Todos se instancian con el sql del worker (sin request).
  const jobs = new JobsRepository(sql);
  const agentRepo = new AgentRepository(sql);
  const credentialRepo = new ProviderCredentialRepository(sql);
  const registrationRepo = new RegistrationRepository(sql);
  // Registro de corridas autonomas: la MISMA tabla/metodo (agent_runs.record) que la ruta sincrona,
  // instanciada con el sql del worker. La escritura es best-effort (ver recordRun en JobRunnerDeps).
  const runRepo = new AgentRunRepository(sql);

  // Notificador de fallos DEFINITIVOS por correo (best-effort). Lee el email del owner de auth.users y el
  // nombre del agente con el MISMO cliente sql. El cooldown por owner vive en el closure (una instancia
  // por proceso). Si falta la config de email, notificarFallo loguea y no envia (no tumba el worker).
  const notificador = crearNotificadorFallos({
    ...(config.RESEND_API_KEY !== undefined ? { resendApiKey: config.RESEND_API_KEY } : {}),
    ...(config.RESEND_FROM_EMAIL !== undefined ? { fromEmail: config.RESEND_FROM_EMAIL } : {}),
    ...(config.CONSOLE_BASE_URL !== undefined ? { consoleBaseUrl: config.CONSOLE_BASE_URL } : {}),
    getOwnerEmail: (ownerId) => leerEmailOwner(sql, ownerId, logger),
    getAgentName: (agentId) => leerNombreAgente(sql, agentId, logger),
    logger,
  });

  // SITIOS CONECTADOS (7.1b): se cablea SOLO si la config de Browserbase esta completa; si falta, el
  // worker corre igual (los jobs de sitios fallan permanente con mensaje claro y el barrido no corre,
  // mismo espiritu opcional que las alertas). El repositorio de 7.1a cifra el contexto con
  // VAULT_SECRET server-side; el encadenado ARCO escribe en data_subject_requests (V014) una
  // solicitud de cancelacion YA RESUELTA por cada desconexion (el borrado ya ocurrio en el mismo job).
  let sitios: SitiosJobDeps | undefined;
  let tareaWeb: TareaWebDeps | undefined;
  let grabacion: GrabacionDeps | undefined;
  let barridoAprobaciones: BarridoAprobacionesDeps | undefined;
  if (config.BROWSERBASE_API_KEY !== undefined && config.BROWSERBASE_PROJECT_ID !== undefined) {
    const sitiosRepo = new SitiosConectadosRepository(sql);
    const dsrRepo = new DataSubjectRequestRepository(sql);
    const navegador = new NavegadorBrowserbase({
      apiKey: config.BROWSERBASE_API_KEY,
      projectId: config.BROWSERBASE_PROJECT_ID,
      proxyServer: config.BROWSERBASE_PROXY_SERVER,
      proxyUsername: config.BROWSERBASE_PROXY_USERNAME,
      proxyPassword: config.BROWSERBASE_PROXY_PASSWORD,
    });
    // CHECKPOINTS DE APROBACION HUMANA (7.1e): repositorio de V027 + notificador por Resend (mismo
    // canal que las alertas de fallo, sin cooldown: cada checkpoint es unico y urgente) + subidor de
    // screenshots (best-effort: solo con SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).
    const aprobacionesRepo = new AprobacionesWebRepository(sql);
    const notificadorAprobaciones = crearNotificadorAprobaciones({
      ...(config.RESEND_API_KEY !== undefined ? { resendApiKey: config.RESEND_API_KEY } : {}),
      ...(config.RESEND_FROM_EMAIL !== undefined ? { fromEmail: config.RESEND_FROM_EMAIL } : {}),
      ...(config.CONSOLE_BASE_URL !== undefined ? { consoleBaseUrl: config.CONSOLE_BASE_URL } : {}),
      getOwnerEmail: (ownerId) => leerEmailOwner(sql, ownerId, logger),
      logger,
    });
    const subidorScreenshots =
      config.SUPABASE_URL !== undefined && config.SUPABASE_SERVICE_ROLE_KEY !== undefined
        ? crearSubidorDeScreenshots(
            { supabaseUrl: config.SUPABASE_URL, serviceRoleKey: config.SUPABASE_SERVICE_ROLE_KEY },
            logger,
          )
        : undefined;
    // TRAYECTORIAS (Fase F, V030): el registro censurado de cada ejecucion del motor, escrito con el
    // MISMO repositorio que leen los endpoints del backend. El handler lo usa best-effort.
    const trayectoriasRepo = new TrayectoriasWebRepository(sql);
    // RECETAS DE TAREA WEB (Fase F paso 2, V035): NO es la tabla `recipes` de V013 (cadenas de
    // instrucciones para un agente conversacional), sino lo aprendido de una navegacion que salio
    // bien. El MISMO adaptador de Stagehand hace de motor (corrida completa) y de escalador (una
    // accion puntual cuando un paso de la receta no encuentra su elemento).
    const recetasRepo = new RecetasWebRepository(sql);
    const motorStagehand = new MotorStagehand({
      apiKey: config.BROWSERBASE_API_KEY,
      projectId: config.BROWSERBASE_PROJECT_ID,
      model: config.TAREA_WEB_MODEL,
      // Techo por llamada de tool del agente: sin el, Stagehand aplica su default de 45 s y el
      // despliegue no tiene forma de ajustarlo.
      toolTimeoutMs: config.TAREA_WEB_TOOL_TIMEOUT_SECONDS * 1000,
      logger,
    });
    // TAREA WEB (7.1d): navegacion por IA dentro de la sesion activa de un sitio conectado. Misma
    // compuerta de config que los jobs de sitios; el motor (Stagehand) corre con la credencial del
    // OWNER (boveda) y el modelo de TAREA_WEB_MODEL (Haiku prohibido, validado en env.ts).
    tareaWeb = {
      repo: sitiosRepo,
      navegador,
      motor: motorStagehand,
      aprobaciones: aprobacionesRepo,
      // POLITICA DE EJECUCION (V034): el MISMO repositorio que escribe la consola. La lee al inicio
      // de cada tarea web; si la lectura falla, la accion irreversible se detiene (falla cerrada).
      politicas: new PoliticasEjecucionRepository(sql),
      aprobacionTtlMs: config.APROBACION_TTL_MINUTOS * 60 * 1000,
      marcarJobPausado: (jobId) => jobs.marcarPausado(jobId),
      subidorScreenshots,
      // Escritura al cierre (guardar) MAS la incremental (FIX D): cabecera al arrancar, pasos por
      // lotes y cierre que reescribe el contenido final. /actividad muestra progreso real.
      trayectorias: {
        guardar: async (trayectoria) => void (await trayectoriasRepo.crear(trayectoria)),
        iniciar: (trayectoria) => trayectoriasRepo.iniciar(trayectoria),
        agregarPasos: (trayectoriaId, ownerId, pasos) =>
          trayectoriasRepo.agregarPasos(trayectoriaId, ownerId, pasos),
        finalizar: (trayectoriaId, ownerId, trayectoria) =>
          trayectoriasRepo.finalizar(trayectoriaId, ownerId, trayectoria),
      },
      // Las tres piezas del camino determinista van juntas: repositorio de lo aprendido, primitivas
      // de bajo nivel del navegador y escalada de un paso suelto al motor.
      recetas: recetasRepo,
      determinista: navegador,
      escalador: motorStagehand,
      // ELECCION ENTRE LAS TAREAS YA ENSENADAS (CAMBIO 3): la UNICA consulta al modelo fuera del
      // motor, y solo cuando la firma exacta del objetivo no encontro nada. Corre con la key del
      // OWNER (la misma de la corrida) y con el mismo modelo de navegacion.
      elector: crearElectorDeTareaEnsenada({ model: config.TAREA_WEB_MODEL, logger }),
      // ATLAS DE SITIOS (V040): el aprendizaje COLECTIVO sobre la estructura de cada dominio, con su
      // clave HMAC de origen. ACTIVO desde el merge y sin flag: la clave se deriva de VAULT_SECRET
      // cuando el despliegue no configura ATLAS_SITIOS_SECRET, asi que no hace falta tocar nada. La
      // tabla es global y NO tiene owner_id (ver V040): aqui no hay ni forma de pasarle uno.
      atlas: {
        repo: new AprendizajeSitiosRepository(sql),
        clave: claveDelAtlas({
          secretoDedicado: config.ATLAS_SITIOS_SECRET,
          vaultSecret: config.VAULT_SECRET,
        }),
      },
      // Observador de pasos APAGADO por defecto (TAREA_WEB_OBSERVADOR_PASOS): encendido DUPLICA,
      // por cada accion con elemento resuelto, la lectura del DOM que la percepcion ya hace despues
      // de cada paso, y habilita ademas la promocion automatica a recetas. El atlas de sitios no
      // depende de el: lo alimenta la percepcion.
      observadorPasos: config.TAREA_WEB_OBSERVADOR_PASOS,
      notificadorAprobaciones,
      vaultSecret: config.VAULT_SECRET,
      model: config.TAREA_WEB_MODEL,
      maxPasos: config.TAREA_WEB_MAX_STEPS,
      // Las dos palancas de COSTO por corrida: cuanta conversacion se le reenvia al modelo en cada
      // llamada y cuando se toma una captura de pantalla. Ninguna cambia lo que el agente decide.
      historialPasos: config.TAREA_WEB_HISTORIAL_PASOS,
      modoScreenshots: config.TAREA_WEB_SCREENSHOTS,
      runTimeoutMs: config.TAREA_WEB_TIMEOUT_SECONDS * 1000,
      resolveCredential: (ownerId, credentialId) =>
        resolveStoredCredential(credentialRepo, ownerId, credentialId, config.VAULT_SECRET),
      guardarResultado: (jobId, resultado) => jobs.guardarResultado(jobId, resultado),
      logger,
    };
    // GRABACION DE TAREAS (V036): la via COMPLEMENTARIA para sembrar una receta. Comparte el mismo
    // adaptador de navegador y el mismo repositorio de recetas que la promocion automatica, para que
    // las dos vias produzcan exactamente el mismo formato. NO recibe motor ni credencial de modelo: la
    // grabacion no llama a ningun modelo en ningun punto.
    grabacion = {
      repo: sitiosRepo,
      grabaciones: new GrabacionesRepository(sql),
      recetas: recetasRepo,
      navegador,
      vaultSecret: config.VAULT_SECRET,
      guardarResultado: (jobId, resultado) => jobs.guardarResultado(jobId, resultado),
      logger,
    };
    // BARRIDO de aprobaciones vencidas (7.1e): expira checkpoints sin decision, cierra su sesion de
    // navegador y cierra el job pausado. Corre throttled en el loop del worker.
    barridoAprobaciones = {
      aprobaciones: aprobacionesRepo,
      cerrarSesion: (sesionExternaId) => navegador.cerrarSesion(sesionExternaId),
      marcarJobFallido: (jobId, error) => jobs.marcarPausadoFallido(jobId, error),
      notificador: notificadorAprobaciones,
      logger,
    };
    sitios = {
      repo: sitiosRepo,
      navegador,
      vaultSecret: config.VAULT_SECRET,
      registrarDesconexionArco: async (ownerId, dominio) => {
        const solicitud = await dsrRepo.createRequest({
          ownerId,
          requestType: 'cancellation',
          details: `desconexion del sitio conectado ${dominio} (borrado de la sesion heredada)`,
        });
        await dsrRepo.updateStatus(
          solicitud.id,
          'completed',
          'contexto de sesion borrado en el proveedor de navegador y en la plataforma (7.1b)',
        );
      },
      logger,
    };
  } else {
    logger.info('sitios conectados deshabilitados: falta BROWSERBASE_API_KEY y/o BROWSERBASE_PROJECT_ID');
  }

  // GUARDAR COMO TAREA APRENDIDA (promocion trayectoria -> receta con consentimiento): solo lee
  // V030 y escribe V035, sin navegador ni modelo, asi que se cablea SIEMPRE (sin la compuerta de
  // Browserbase). Instancias propias de los repos: fuera del bloque de arriba no existen.
  const promocionTrayectoria = {
    trayectorias: new TrayectoriasWebRepository(sql),
    recetas: new RecetasWebRepository(sql),
    guardarResultado: (jobId: string, resultado: unknown) => jobs.guardarResultado(jobId, resultado),
    logger,
  };

  const deps: JobRunnerDeps = {
    jobs,
    promocionTrayectoria,
    getProfileTier: (ownerId) => registrationRepo.getProfileTier(ownerId),
    loadAgent: (agentId) => agentRepo.getById(agentId),
    resolveCredential: (ownerId, credentialId) =>
      resolveStoredCredential(credentialRepo, ownerId, credentialId, config.VAULT_SECRET),
    assembleAgentRun,
    runAgent,
    logger,
    config: {
      runTimeoutMs: config.RUN_TIMEOUT_SECONDS * 1000,
      tareaWebTimeoutMs: config.TAREA_WEB_TIMEOUT_SECONDS * 1000,
      runMaxTokens: config.RUN_MAX_TOKENS,
      ...(config.WEB_WORKER_URL !== undefined ? { webWorkerUrl: config.WEB_WORKER_URL } : {}),
      ...(config.WEB_WORKER_SECRET !== undefined ? { webWorkerSecret: config.WEB_WORKER_SECRET } : {}),
    },
    notifyJobFailure: (job, reason) => notificador.notificarFallo(job, reason),
    // Persistencia best-effort del usage de cada ejecucion autonoma en agent_runs (misma via que la ruta
    // sincrona). Si esto fallara, processClaimedJob lo traga: el job conserva su estado real.
    recordRun: (run) => runRepo.record(run),
    ...(sitios !== undefined ? { sitios } : {}),
    ...(tareaWeb !== undefined ? { tareaWeb } : {}),
    ...(grabacion !== undefined ? { grabacion } : {}),
    ...(barridoAprobaciones !== undefined ? { barridoAprobaciones } : {}),
  };

  const handle = startWorker({ deps, logger, intervalMs: config.WORKER_POLL_INTERVAL_MS });

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('senal recibida, cerrando', { signal });
    // Watchdog de respaldo: si el cierre se cuelga (run wedgeado, conexion muerta), el proceso sale
    // igual tras el plazo. unref para no mantener vivo el event loop solo por este timer si el cierre
    // resuelve antes. closeSql(5) ademas acota el drenaje del end() a 5s (ver db.ts).
    const watchdog = setTimeout(() => process.exit(0), 10_000);
    watchdog.unref();
    // stop() detiene el loop, aborta el job en curso (vuelve a 'pending') y espera a que termine la
    // pasada en vuelo ANTES de cerrar el pool, para no abortar a media escritura el cierre del job.
    void handle
      .stop()
      .catch(() => {})
      .then(() => closeSql(5))
      .finally(() => process.exit(0));
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

await verificarParche();
main();
