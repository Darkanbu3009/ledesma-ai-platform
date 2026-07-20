import { parseTareaWebJobPayload } from '@ledesma-platform/shared';
import type { Job } from '@ledesma-platform/shared';
// IMPORT DE TIPOS (type-only): igual que sitios.ts, el repositorio real (7.1a) y la boveda se
// INYECTAN; este modulo no carga en runtime el backend ni el SDK de Stagehand. Los tests pasan
// fakes y JAMAS llaman a un modelo ni abren un navegador.
import type { SitioConectado } from '@ledesma-platform/backend/sitios';
import type { DecryptedProviderCredential } from '@ledesma-platform/backend/execution';
import { PermanentExecutionError } from './errores.js';
import { SalidaDeRedNoDisponibleError, expiracionDeContexto } from './sitios.js';
import {
  clasificarDesenlace,
  construirSystemPromptTareaWeb,
} from './prompt-tarea-web.js';
import type { Logger } from './logger.js';

/**
 * Handler del JOB DE TAREA WEB (Fase 7.1d): un agente de navegacion por IA (Stagehand) ejecuta el
 * OBJETIVO en lenguaje natural del usuario DENTRO de la sesion que el ya establecio en un sitio
 * conectado (7.1a-7.1c). Cierra el circulo: el usuario conecto su sitio y ahora el agente opera su
 * cuenta real.
 *
 * Lineas rojas (espejo de 7.1b, mas las propias de 7.1d):
 *  - El login JAMAS se automatiza ni se reintenta: una pantalla de login/verificacion ABORTA la
 *    tarea al instante, marca el sitio 'caducado' y notifica. CERO reintentos: reintentar contra
 *    una verificacion es lo que quema la cuenta del usuario.
 *  - La salida de red es la PINEADA o ninguna: la egress_ip observada se verifica ANTES de navegar;
 *    si difiere del pin, se aborta y el sitio queda 'error'. PROHIBIDA la rotacion de proxy.
 *  - Acciones irreversibles o financieras NO se ejecutan en este PR: el agente las clasifica, las
 *    BLOQUEA y reporta 'requiere_aprobacion' (el checkpoint de aprobacion es 7.1e).
 *  - Un fallo DESPUES de abrir la sesion es PERMANENTE a proposito: re-ejecutar una navegacion a
 *    medias sobre la cuenta real del usuario puede duplicar efectos; mejor fallar claro y que el
 *    usuario decida.
 *  - El contexto descifrado existe SOLO en memoria entre el descifrado y la inyeccion; jamas se
 *    loguea (ni el, ni el objetivo, ni URLs internas: solo ids y dominios).
 */

/** Cap DURO de iteraciones (pasos del agente de navegacion) por tarea. */
export const MAX_PASOS_TAREA_WEB = 30;

/** Sesion de navegador abierta para una tarea: referencias minimas (nunca credenciales). */
export interface SesionDeTareaAbierta {
  sesionExternaId: string;
  /** IP de salida OBSERVADA a traves del proxy pineado. null = no observable. */
  egressIp: string | null;
}

/**
 * PUERTO hacia el proveedor de navegador para la tarea web. Lo implementa NavegadorBrowserbase
 * (browserbase.ts, el unico modulo que importa el SDK); los tests pasan fakes.
 */
export interface NavegadorParaTarea {
  /**
   * Abre una sesion RECONECTANDO el contexto guardado y FORZANDO la salida pineada. `proxyRef` es
   * OBLIGATORIO (una tarea jamas sortea salida nueva): si no se puede abrir por esa salida, lanza
   * SalidaDeRedNoDisponibleError, nunca degrada a otra.
   */
  abrirSesionParaTarea(params: {
    contextoExternoId: string;
    proxyRef: string;
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
  }): Promise<{ exito: boolean; mensaje: string }>;
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
  /** Secreto de la boveda: descifra el contexto (7.1a) y re-cifra el actualizado. */
  vaultSecret: string;
  /** Modelo de la navegacion (TAREA_WEB_MODEL; Haiku prohibido, validado al parsear el env). */
  model: string;
  /** Deadline de pared de la tarea, en ms (el mismo runTimeoutMs del worker). */
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
 * kind:'tarea_web': ejecuta el objetivo del usuario dentro de la sesion activa del sitio conectado.
 * Lanza en fallo (execution.ts decide el cierre); el llamador marca completed si esto retorna.
 * TODOS los fallos posteriores a la apertura de la sesion son PERMANENTES (ver nota de cabecera).
 */
export async function procesarTareaWeb(deps: TareaWebDeps | undefined, job: Job): Promise<void> {
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
  if (!sitio.contextoExternoId || !sitio.proxyRef) {
    // Sin contexto o sin salida pineada no hay sesion que reanudar ni pin que respetar.
    throw new PermanentExecutionError(MENSAJE_RECONECTAR);
  }

  // 2. Descifrar el contexto (VAULT_SECRET). El claro vive SOLO en memoria hasta inyectarContexto.
  const contexto = await deps.repo.obtenerContextoDescifrado(connectionId, job.ownerId, deps.vaultSecret);
  if (contexto === null) {
    throw new PermanentExecutionError(MENSAJE_RECONECTAR);
  }

  // La key del modelo sale de la boveda del owner (misma via que todo job). La navegacion usa un
  // modelo Claude (TAREA_WEB_MODEL): la credencial debe ser de anthropic.
  const credential = await deps.resolveCredential(job.ownerId, job.credentialId);
  if (credential.providerId !== 'anthropic') {
    throw new PermanentExecutionError(
      `la tarea web requiere una credencial de anthropic (la credencial del job es de ${credential.providerId})`,
    );
  }

  // 3. Abrir la sesion RECONECTANDO el contexto guardado y FORZANDO el proxy pineado. El adaptador
  //    lanza SalidaDeRedNoDisponibleError (permanente) si no puede abrir por esa salida.
  const sesion = await deps.navegador.abrirSesionParaTarea({
    contextoExternoId: sitio.contextoExternoId,
    proxyRef: sitio.proxyRef,
  });

  try {
    // 4. VERIFICAR la egress_ip ANTES de navegar: si hay IP pineada y la observada no coincide (o no
    //    se pudo observar), se ABORTA sin ejecutar nada, el sitio queda 'error' y se notifica (el
    //    fallo permanente dispara la alerta de execution.ts). Una IP distinta puede costarle la
    //    sesion al usuario y disparar verificaciones en su cuenta real. JAMAS se degrada.
    if (sitio.egressIp !== null && sesion.egressIp !== sitio.egressIp) {
      await marcarSitioBestEffort(deps, sitio, job.ownerId, 'error');
      throw new SalidaDeRedNoDisponibleError(
        `la salida de red observada no coincide con la pineada al dominio ${sitio.dominio} ` +
          `(observada: ${sesion.egressIp ?? 'ninguna'}); la tarea NO se ejecuto. ` +
          'Desconecta el sitio y volvelo a conectar para pinear una salida nueva.',
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
    //    cap DURO de pasos. El system prompt fija la separacion instruccion-vs-contenido y las
    //    reglas de abortar ante login y de bloquear acciones irreversibles/financieras.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), deps.runTimeoutMs);
    let resultado: { exito: boolean; mensaje: string };
    try {
      resultado = await deps.motor.ejecutar({
        sesionExternaId: sesion.sesionExternaId,
        objetivo,
        systemPrompt: construirSystemPromptTareaWeb(),
        apiKey: credential.apiKey,
        model: deps.model,
        maxPasos: MAX_PASOS_TAREA_WEB,
        signal: controller.signal,
      });
    } catch (error) {
      // Fallo del motor con la sesion ya abierta: PERMANENTE (no se re-ejecuta una navegacion a
      // medias sobre la cuenta real). El mensaje va sanitizado: nunca el objetivo ni contenido.
      throw new PermanentExecutionError(`la navegacion fallo: ${describir(error)}`);
    } finally {
      clearTimeout(timer);
    }

    // 7. Clasificar el desenlace segun los marcadores del prompt.
    const desenlace = clasificarDesenlace(resultado.mensaje);

    if (desenlace.tipo === 'sesion_caducada') {
      // Caducidad a MITAD de tarea: el sitio queda 'caducado' y el fallo PERMANENTE notifica al
      // owner (alertas de execution.ts) con el mensaje accionable. CERO reintentos de login y CERO
      // reintentos de la tarea.
      await marcarSitioBestEffort(deps, sitio, job.ownerId, 'caducado');
      throw new PermanentExecutionError(
        `la sesion del sitio ${sitio.dominio} caduco a mitad de la tarea (aparecio una pantalla de ` +
          'login o verificacion); vuelve a conectarlo desde la consola para reanudar las tareas',
      );
    }

    if (desenlace.tipo === 'requiere_aprobacion') {
      // Accion irreversible/financiera BLOQUEADA: NO es un fallo (el bloqueo es el comportamiento
      // correcto). El job completa y el resultado le dice al agente que hace falta aprobacion
      // humana (el checkpoint de aprobacion es 7.1e). La sesion se uso legitimamente hasta el
      // bloqueo: se refresca el contexto y ultimo_uso_en igual que en el exito.
      await refrescarContextoBestEffort(deps, sitio, job.ownerId, sesion.sesionExternaId, contexto);
      await deps.guardarResultado(job.id, {
        estado: 'requiere_aprobacion',
        detalle: desenlace.detalle,
      });
      deps.logger.info('tarea web detenida: accion irreversible o financiera bloqueada (requiere aprobacion)', {
        jobId: job.id,
        connectionId: sitio.id,
        dominio: sitio.dominio,
      });
      return;
    }

    if (!resultado.exito) {
      throw new PermanentExecutionError(
        'la tarea no se pudo completar dentro de sus limites (pasos o tiempo); no se reintenta ' +
          'automaticamente para no repetir acciones sobre la cuenta del usuario',
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
  } finally {
    // La sesion se cierra SIEMPRE, pase lo que pase (minutos del proveedor + higiene de sesiones).
    try {
      await deps.navegador.cerrarSesion(sesion.sesionExternaId);
    } catch (error) {
      deps.logger.warn('tarea web: no se pudo cerrar la sesion de navegador (se ignora, best-effort)', {
        err: describir(error),
      });
    }
  }
}
