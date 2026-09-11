import {
  POLITICA_EJECUCION_DEFAULT,
  parseTareaWebJobPayload,
  sitiosAutorizadosDePayload,
} from '@ledesma-platform/shared';
import type { Job } from '@ledesma-platform/shared';
// IMPORT DE TIPOS (type-only): igual que sitios.ts, el repositorio real (7.1a) y la boveda se
// INYECTAN; este modulo no carga en runtime el backend ni el SDK de Stagehand. Los tests pasan
// fakes y JAMAS llaman a un modelo ni abren un navegador.
import type { SitioConectado } from '@ledesma-platform/backend/sitios';
import type { AprobacionWeb } from '@ledesma-platform/backend/aprobaciones';
import type { DecryptedProviderCredential } from '@ledesma-platform/backend/execution';
import {
  AccionBloqueadaError,
  AccionSinConfirmarError,
  AccionSinEfectoConfirmadoError,
  FalloDeEsquemaDelMotorError,
  GuardiaBloqueoReintentosError,
  MotorCortoPorElementoRepetidoError,
  PermanentExecutionError,
} from './errores.js';
import { FalloDeAccesoAlModeloError, clasificarFalloDeAccesoAlModelo } from './fallo-modelo.js';
import { SalidaDeRedNoDisponibleError, expiracionDeContexto } from './sitios.js';
import {
  clasificarDesenlace,
  construirSystemPromptTareaWeb,
  detectarAccionQueExigeVerificacion,
  detectarControlDeVentana,
  detectarVerboBloqueado,
  esNavegacionDeSoloLectura,
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
import {
  contarParametrosDeclarados,
  extraerParametrosDeclarados,
  nombresDeParametrosDeclarados,
  type ParametrosDeclarados,
} from './parametros-objetivo.js';
import type { ConsumoDeCorrida, ModoScreenshots } from './costo-modelo.js';
import {
  accionSurtioEfecto,
  construirPasoDeBloqueo,
  construirPasoDeVerificacion,
  esDetencionSinEvidencia,
  formularioVerificadoPresente,
  mensajeDeDetencion,
  mensajeDeIncompleto,
  resumenDeGuardiaSinIntencion,
  verificarAccion,
  type CampoDeLaPagina,
  type EstadoDeLaPagina,
  type ModoGuardiaSinIntencion,
  type PoliticaVigente,
  type RepositorioPoliticasParaWorker,
  type Veredicto,
} from './verificacion.js';
import type { SubidorDeScreenshots } from './storage.js';
import { censurarObjetivo, censurarTexto } from './censura.js';
import type { ObjetivoDeLectura, PerceptorDePagina, PercepcionDePagina } from './percepcion.js';
import {
  extraerPasosCensurados,
  type AccionCrudaDeMotor,
  type EstadoTrayectoria,
  type ObservacionDePaso,
  type PasoCensurado,
  type RegistradorDeTrayectorias,
  type TrayectoriaNueva,
} from './trayectoria.js';
import type { NuevaRecetaWeb, RecetaWeb } from '@ledesma-platform/backend/recetas-web';
import type {
  CodigoDeIntencion,
  EstrategiaLocalizacion,
  MarcadorParametro,
  MotivoDeFallaDePlantilla,
  PasoDeReceta,
} from '@ledesma-platform/shared';
import {
  ejecutarReceta,
  recetaAplicable,
  type EscaladorDePaso,
  type NavegadorDeterminista,
  type PistasDelAtlas,
  type VeredictoDeVerificacion,
} from './ejecutor-receta.js';
import {
  nombresDeLaFamilia,
  resumenDeIdentidad,
  verificarIdentidadDeElemento,
  type ModoBarreraIdentidad,
  type ResultadoDeLaBarrera,
} from './barrera-identidad.js';
import {
  bloqueDelMapa,
  claseDeElemento,
  entradaDelControlLeido,
  entradasDeCorridaLibre,
  entradasDeCorridaPorReceta,
  entradasServibles,
  hashDeOrigen,
  ORIGENES_PARA_COMPARTIR,
  pasosConEstrategiasPercibidas,
  pistasParaPaso,
  resumenDeCorridaLibre,
  valoresTecleadosDeLaCorrida,
  type EntradaConocida,
  type EntradaDeAtlas,
} from './atlas-sitios.js';
import {
  hashDeOrigenDePlantilla,
  identidadDeConsumo,
  parsearOfrecimiento,
  plantillaAplicable,
  plantillaDeLaCorrida,
  verboDeIntencion,
  type IdentidadDePlantilla,
  type OfrecimientoDePlantilla,
  type PlantillaDeLaCorrida,
} from './plantillas-compartidas.js';
import {
  clasesFaltantes,
  clasesObservablesEnInicio,
  descriptoresDeSonda,
  ESPERA_ENTRE_LECTURAS_DE_SONDA_MS,
  LECTURAS_DE_SONDA,
} from './sonda-interfaz.js';
import {
  construirPeticionDeDatos,
  datosConLoQueElModeloAgrego,
  parsearResolucionDelObjetivo,
} from './datos-del-objetivo.js';
import {
  aplicarPromociones,
  evaluarPromociones,
  ganadorasDeCorrida,
  parsearHistorialGanadoras,
  registrarGanadoras,
  type PromocionDeEstrategia,
} from './promocion-estrategias.js';
import {
  ACCION_POR_METODO,
  firmaDeObjetivo,
  parametrosDeclaradosDesdeValores,
  promoverTrayectoria,
  valoresDeParametros,
  type ValoresDeParametros,
} from './receta-web.js';
import {
  construirPeticionDeEleccion,
  ofrecerTareasEnsenadas,
  parsearEleccion,
  type ElectorDeTareaEnsenada,
} from './eleccion-tarea.js';
import {
  MAX_CAMBIOS_DE_SITIO_POR_TAREA,
  construirContinuacionEnOtroSitio,
  crearRegistroDeSitios,
  resolverDominioAutorizado,
  type EstadoDeSitioParaGuardia,
  type RegistroDeSitios,
  type ResolucionDeDominio,
} from './multisitio.js';
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
 *  - Una accion irreversible o financiera NO se ejecuta sin pasar antes por la VERIFICACION
 *    DETERMINISTA (verificacion.ts): el sistema compara, fuera del alcance del modelo, los datos que
 *    el usuario declaro en el objetivo contra los valores que hay en la pagina, y aplica la POLITICA
 *    que el usuario configuro una sola vez (V034). Coinciden y la politica lo permite: se ejecuta sin
 *    preguntar nada. No coinciden, falta un dato, o la politica lo impide: la tarea TERMINA sin
 *    ejecutar, con un mensaje que dice que se pidio y que se encontro. Es comparacion mecanica, NO
 *    aprobacion humana: el usuario final no es tecnico y no debe aprobar cada accion.
 *  - Esa verificacion corre INMEDIATAMENTE ANTES de la accion y NO depende de que el agente coopere:
 *    la GUARDIA DE ACCION (crearGuardiaDeAccion) se interpone entre la tool `act` del agente y el
 *    navegador, y es codigo del worker leyendo el DOM. Antes corria DESPUES de que el agente se
 *    detuviera solo y lo reportara, asi que un agente que no se detenia (o que se detenia y no
 *    reportaba) la salteaba entera. El agente ya no decide cuando se verifica ni si se ejecuta.
 *  - La APROBACION HUMANA (7.1e) sigue existiendo intacta para el camino de reanudacion tras una
 *    decision: construirReanudacionAprobada (aprobaciones.ts) sigue siendo el UNICO productor del
 *    prompt que ejecuta una accion aprobada y sigue LANZANDO si la aprobacion no esta 'aprobada'.
 *    Lo que cambio es que ya no se DISPARA un checkpoint por defecto en la corrida inicial.
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
   * LEE (sin tocar la pagina) los valores ACTUALES de los campos del formulario con el contexto que
   * los identifica. Es el insumo de la VERIFICACION DETERMINISTA: lo que se compara contra el
   * objetivo del usuario es lo que el agente tecleo o eligio.
   */
  leerCamposDeLaPagina(sesionExternaId: string): Promise<CampoDeLaPagina[]>;
  /**
   * PERCEPCION DE LA PAGINA (FIX A y B): huella ligera (URL, titulo, nodos), foco y campos con el
   * MISMO lector de chips de la verificacion. OPCIONAL para no romper los fakes de los tests: sin
   * este metodo la tarea corre exactamente como antes (cero percepcion). Nunca lanza: null = no se
   * pudo leer.
   *
   * `objetivo` (ATLAS DE SITIOS) pide que la MISMA evaluacion devuelva ademas las estrategias del
   * elemento que el paso toco: mismo viaje al navegador, mismo costo, un dato mas.
   */
  percibirPagina?(
    sesionExternaId: string,
    objetivo?: ObjetivoDeLectura | undefined,
  ): Promise<PercepcionDePagina | null>;
  /** LEE el texto visible de la pagina (o del elemento del selector), acotado y sin tocarla. */
  leerTextoVisible(sesionExternaId: string, selector?: string): Promise<string>;
  /**
   * LOCALIZA (sin clickear) el boton visible cuyo aria-label empieza con alguno de los prefijos, y
   * devuelve su aria-label COMPLETO. Es la MISMA primitiva de solo lectura que alimenta la barrera
   * de identidad en el camino de recetas (ejecutor-receta.ts); el adaptador real ya la implementa.
   *
   * OPCIONAL en el puerto a proposito, con el mismo criterio que `percibirPagina`: un fake que no la
   * traiga deja la barrera sin nombre accesible (falla cerrada) en vez de romper la tarea.
   */
  localizarBotonPorAriaLabel?(
    sesionExternaId: string,
    prefijos: string[],
  ): Promise<{ ariaLabel: string; rol: string; candidatos: number } | null>;
  /**
   * OBSERVA la salida de red actual (pais + IP) de la sesion viva en una PESTANA NUEVA (sin tocar
   * la pagina de la tarea). Pais null = no observable -> el handler aborta (no se puede verificar).
   */
  observarSalida(sesionExternaId: string): Promise<SalidaObservada>;
  /** Cierra (libera) la sesion en el proveedor. */
  cerrarSesion(sesionExternaId: string): Promise<void>;
}

/**
 * Que hace el worker con una accion que el agente propone:
 *  - 'permitir': pasa al navegador. `confirmar` marca las que ademas hay que CONFIRMAR en el DOM
 *    despues de ejecutarlas (CAMBIO 4): son las irreversibles que acaban de pasar la verificacion.
 *  - 'incompleto' (CAMBIO 1): NO pasa, pero la tarea SIGUE. Faltan datos del objetivo por escribir en
 *    la pagina; el mensaje vuelve al agente para que termine de llenarlos.
 *  - 'rechazar': NO pasa y la tarea SIGUE; el mensaje le dice al agente por que y como continuar.
 *    Tiene dos usos: el aviso previo al corte duro del segundo bloqueo consecutivo (FIX C, mensaje
 *    TERMINAL: la corrida va a terminar y el agente no debe intentar la accion por ninguna via) y el
 *    control de ventana del formulario que queda fuera de alcance (FIX A, mensaje NO terminal: la
 *    tarea sigue y el agente tiene que seguir con el objetivo).
 *  - 'bloquear': NO pasa y la tarea termina con el mensaje de la detencion. `causa` distingue los
 *    dos cierres nuevos: 'sin_efecto' (efecto probable, no se reintenta; el adaptador lo convierte
 *    en ACCION_SIN_EFECTO_CONFIRMADO) y 'guardia_reintentos' (el agente insistio tras agotar el
 *    reintento; se convierte en GUARDIA_BLOQUEO_REINTENTOS_IRREVERSIBLES).
 */
export type VeredictoDeGuardia =
  | { tipo: 'permitir'; confirmar?: boolean }
  | { tipo: 'incompleto'; mensaje: string }
  | { tipo: 'rechazar'; mensaje: string }
  | { tipo: 'bloquear'; mensaje: string; causa?: 'sin_efecto' | 'guardia_reintentos' };

/**
 * Resultado de confirmar en el DOM que una accion irreversible surtio efecto (CAMBIO 4, FIX A).
 * `terminal: false` = el sistema autoriza UN unico reintento verificado; el mensaje vuelve al agente
 * con la instruccion de reintentar con `act` y localizador por rol/aria-label. `terminal: true` = la
 * corrida termina (el reintento tampoco confirmo, o no hay reintento posible).
 */
export type ResultadoDeConfirmacion =
  | { confirmada: true }
  | { confirmada: false; mensaje: string; terminal: boolean };

/**
 * GUARDIA DE ACCION: el punto de INTERCEPCION entre el agente y el navegador. El adaptador del motor
 * (stagehand.ts) la consulta con la descripcion de cada accion ANTES de ejecutarla; si el objetivo
 * pide una accion bloqueada y esta es esa accion, el worker lee el DOM, compara contra lo que declaro
 * el usuario y solo entonces la deja pasar.
 *
 * Es un PUERTO a proposito: el adaptador del motor no sabe que se compara ni con que; solo sabe que
 * hay un veredicto y que un bloqueo se lanza. La implementacion (crearGuardiaDeAccion) vive en el
 * handler, que es quien tiene la politica del usuario, el objetivo original y el navegador.
 */
export interface GuardiaDeAccion {
  /** Veredicto sobre UNA accion propuesta, descrita en lenguaje natural por el agente. Nunca lanza. */
  revisar(accion: string): Promise<VeredictoDeGuardia>;
  /**
   * CONFIRMA en el DOM que la accion irreversible que se acaba de ejecutar surtio efecto (CAMBIO 4).
   * Se llama despues de CADA accion permitida con `confirmar`, haya salido bien o mal la llamada al
   * navegador. Nunca lanza: devuelve el veredicto y el adaptador decide. Una accion que no se puede
   * confirmar TERMINA la tarea; jamas se reintenta por cuenta propia.
   */
  confirmar(): Promise<ResultadoDeConfirmacion>;
}

/** Lo que el agente pidio al cambiar de sitio: a donde va y que se lleva del sitio anterior. */
export interface CambioDeSitioPedido {
  /** Dominio DESTINO, ya resuelto contra la lista autorizada del job (jamas texto libre del modelo). */
  dominio: string;
  /** Lo que el agente resume del sitio que deja. CONTENIDO NO CONFIABLE: viaja como dato delimitado. */
  resumen: string;
}

/**
 * PUERTO del CAMBIO DE SITIO (tareas multisitio): lo unico que el motor puede hacer respecto de los
 * otros sitios del usuario es PEDIR el cambio. Quien autoriza es el worker, comparando contra la
 * lista cerrada que el job trae; el adaptador del motor no conoce esa lista ni puede ampliarla.
 *
 * Se pasa SOLO cuando el job autorizo mas de un sitio: con uno solo, el toolset del agente y el
 * system prompt quedan exactamente como en una tarea de un sitio.
 */
export interface CambiadorDeSitio {
  /** Dominios autorizados, en orden (el primero es donde arranco la tarea). Para el prompt del motor. */
  dominios: readonly string[];
  /** Resuelve un destino contra la lista autorizada. Puro y sincrono: no abre nada, no lanza. */
  solicitar(dominio: string): ResolucionDeDominio;
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
    /**
     * OBSERVADOR de pasos (Fase F paso 2, CAMBIO 1): el motor lo invoca por cada accion que ejecuta,
     * en el mismo orden en que la empuja a su traza. El handler lo usa para leer del DOM las
     * estrategias de localizacion que la traza no trae. Best-effort: su fallo no cambia nada.
     * Ausente cuando TAREA_WEB_OBSERVADOR_PASOS esta apagado (default): cero lecturas extra del DOM.
     */
    observador?: ((paso: PasoObservado) => Promise<void>) | undefined;
    /**
     * REGISTRO EN VIVO de cada accion que el motor ejecuta, en crudo. Existe para que la trayectoria
     * conserve lo que paso cuando el motor LANZA (abort, deadline o corte por esquema) y por tanto
     * no llega a devolver su traza. Sincrono y sin efectos: solo acumula en memoria.
     */
    registrarAccion?: ((accion: AccionCrudaDeMotor) => void) | undefined;
    /**
     * GUARDIA DE ACCION: se consulta ANTES de ejecutar cada accion del agente. Ausente en los caminos
     * donde no hay nada que verificar (objetivo sin verbo bloqueado, reanudacion tras una decision
     * humana que ya autorizo la accion, escalada de UN paso de receta).
     */
    guardia?: GuardiaDeAccion | undefined;
    /**
     * CAMBIO DE SITIO: presente SOLO en tareas que autorizan mas de un sitio conectado. Ausente, el
     * motor no expone ninguna herramienta para salir del sitio en el que corre.
     */
    cambiador?: CambiadorDeSitio | undefined;
    /**
     * PERCEPCION DE EFECTO Y DE CAMPOS (FIX A y B): el motor lo consulta tras cada paso que toca la
     * pagina y adjunta al contexto del agente las lineas resultantes (click sin efecto, donde
     * aterrizo el texto tecleado). Ausente cuando el navegador no expone percepcion: cero cambio.
     */
    perceptor?: PerceptorDePagina | undefined;
    /**
     * ATLAS DE SITIOS (V040): bloque "mapa conocido del sitio" (estructura ya observada en este
     * dominio por la plataforma) que se adjunta al contexto de PERCEPCION del agente, dentro del
     * presupuesto por turno que ese canal ya tiene. Ausente o vacio = cero cambio respecto de V039.
     */
    mapaDelSitio?: readonly string[] | undefined;
    /** Ventana de historial que se reenvia al modelo en cada llamada (TAREA_WEB_HISTORIAL_PASOS). */
    historialPasos: number;
    /** Cuando se toma una captura de pantalla durante la corrida (TAREA_WEB_SCREENSHOTS). */
    modoScreenshots: ModoScreenshots;
    /**
     * REPORTE DE CONSUMO de la corrida (tokens de entrada, de salida, leidos de cache y creados en
     * cache, mas el numero de llamadas al modelo). El motor lo emite SIEMPRE al terminar, tambien
     * cuando la corrida lanza: una tarea cortada por deadline es justo donde hace falta saber
     * cuanto se gasto antes del corte.
     */
    reportarConsumo?: ((consumo: ConsumoDeCorrida) => void) | undefined;
  }): Promise<ResultadoMotor>;
}

/**
 * Lo que el motor expone de un paso recien ejecutado: el selector que resolvio (tools 'act' y
 * 'fillForm') o el punto sobre el que actuo (tools por coordenadas 'click' y 'type', que NO resuelven
 * ningun selector). Con cualquiera de los dos, el handler puede pedirle al navegador las estrategias
 * de localizacion del elemento.
 */
export interface PasoObservado {
  selector: string | null;
  punto: { x: number; y: number } | null;
}

/**
 * Resultado de una ejecucion del motor. Ademas del desenlace, expone la TRAZA de acciones que el
 * motor ejecuto (AgentResult.actions de Stagehand v3) y los tokens consumidos: es el insumo del
 * registro de trayectorias (Fase F). Las acciones vienen CRUDAS del motor; el handler las CENSURA
 * (trayectoria.ts) antes de persistir cualquier cosa.
 */
export interface ResultadoMotor {
  exito: boolean;
  /**
   * El agente CERRO su loop con DONE (AgentResult.completed), haya cumplido o no el objetivo. Es la
   * distincion que exito solo no da: exito=false con completado=true es "termino sin cumplir el
   * objetivo"; exito=false con completado=false es "el loop se corto" (limite de pasos u otro corte).
   */
  completado: boolean;
  mensaje: string;
  /** Acciones ejecutadas, en orden. Vacia si el motor no llego a ejecutar ninguna. */
  acciones: AccionCrudaDeMotor[];
  /**
   * ATLAS DE SITIOS: las estrategias que la PERCEPCION leyo del elemento de cada paso, UNA lista por
   * accion de `acciones` y en su mismo orden. Ausente cuando el motor no lleva percepcion cableada;
   * una cantidad que no cuadre con `acciones` se descarta entera (extraerPasosCensurados).
   */
  estrategiasPorAccion?: EstrategiaLocalizacion[][] | undefined;
  /** Tokens reportados por el motor (usage). null = no reportados. */
  tokensIn: number | null;
  tokensOut: number | null;
  /**
   * El tramo termino porque el agente pidio CAMBIAR a otro sitio autorizado y el worker lo aprobo.
   * No es un fallo: el handler abre (o reutiliza) la sesion del destino y vuelve a correr el motor
   * alli. Ausente o null = el motor termino por si mismo, como en una tarea de un solo sitio.
   */
  cambioDeSitio?: CambioDeSitioPedido | null;
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

/**
 * Subconjunto del RecetasWebRepository (V035) que la tarea web usa. Puerto propio (no la clase) para
 * que los tests pasen fakes sin base y para que quede a la vista lo unico que este handler puede
 * hacerle a una receta: buscarla, promoverla, repararla, jubilarla y contabilizarla.
 */
export interface RepositorioRecetasParaWorker {
  buscarActiva(ownerId: string, dominio: string, firmaObjetivo: string): Promise<RecetaWeb | null>;
  /**
   * Todas las recetas ACTIVAS del owner en los dominios que ESTA tarea autorizo: la lista de tareas
   * ya ensenadas entre las que se elige cuando la firma exacta no coincide (CAMBIO 3).
   */
  listarActivas(ownerId: string, dominios?: readonly string[]): Promise<RecetaWeb[]>;
  promover(input: NuevaRecetaWeb): Promise<RecetaWeb | null>;
  marcarObsoleta(id: string, ownerId: string): Promise<void>;
  reemplazarPasos(id: string, ownerId: string, pasos: PasoDeReceta[]): Promise<void>;
  registrarEjecucion(id: string, ownerId: string, exitosa: boolean): Promise<void>;
  /**
   * AUTO REPARACION (V038): lectura fresca del estado vigente (version, pasos, historial de
   * ganadoras) y guardado ATOMICO del registro y de la eventual promocion, condicionado por la
   * version leida. OPCIONALES con el mismo criterio que el resto del cableado optativo: sin ellos no
   * se registran ganadoras ni se promueve nada, y todo lo demas corre igual.
   */
  leerAutoReparacion?(
    id: string,
    ownerId: string,
  ): Promise<{ version: number; pasos: PasoDeReceta[]; ganadoras: unknown } | null>;
  guardarAutoReparacion?(
    id: string,
    ownerId: string,
    version: number,
    ganadoras: unknown,
    pasosPromovidos: PasoDeReceta[] | null,
    promociones: number,
  ): Promise<boolean>;
}

/**
 * Subconjunto del AprendizajeSitiosRepository (V040) que la tarea web usa: el ATLAS DE SITIOS, la
 * estructura de cada dominio agregada de las ejecuciones exitosas de CUALQUIER usuario. Puerto propio
 * (no la clase) con el mismo criterio que el resto: para que los tests pasen fakes sin base y para que
 * quede a la vista lo unico que este handler puede hacerle al atlas.
 *
 * Lo que NO hay aqui, y es el punto: ningun metodo recibe ni devuelve owner_id, id de trayectoria, de
 * receta o de job. Una entrada del atlas no tiene dueno; la unica dimension es el dominio.
 */
export interface RepositorioAtlasParaWorker {
  listarPorDominio(dominio: string): Promise<
    Array<{
      claseDeElemento: string;
      estrategias: unknown;
      corroboraciones: number;
      origenesHash: unknown;
    }>
  >;
  registrarObservacion(observacion: {
    dominio: string;
    claseDeElemento: string;
    estrategias: unknown;
    origenHash: string;
  }): Promise<void>;
}

/**
 * Subconjunto del PlantillasCompartidasRepository (V041) que la tarea web usa. Puerto propio con el
 * mismo criterio que el del atlas: para que los tests pasen fakes sin base y para que quede a la vista
 * lo unico que este handler puede hacerle a la tabla.
 *
 * LO QUE NO HAY AQUI, y es el punto: ningun parametro de owner, de firma, de descripcion ni de
 * valores. Una plantilla no tiene dueno y la tabla no tiene esas columnas (ver V041). Lo unico que
 * vincula una fila con quien la produjo es un HMAC opaco, y la unica pregunta que se le puede hacer es
 * "¿esta el mio dentro?", que se responde DENTRO de la query (`buscarServible`).
 *
 * LOS DOS METODOS DEL CONSUMO SON OPCIONALES, con el mismo criterio que `leerAutoReparacion` en el
 * puerto de recetas: un despliegue (o un fake) que no los traiga deja el camino de plantillas ajenas
 * apagado y la tarea corre exactamente como antes, por el motor libre.
 */
export interface RepositorioPlantillasParaWorker {
  publicar(plantilla: {
    dominiosClave: string;
    codigoDeIntencion: string;
    pasos: unknown;
    origenHash: string;
  }): Promise<{ publicada: boolean; motivo?: string; rehabilitada?: boolean }>;
  /**
   * La plantilla de esta IDENTIDAD que se le puede servir a este origen. null = no hay ninguna.
   *
   * `marcadoresPosibles` son el conjunto de marcadores que el objetivo del consumidor declara Y TODOS
   * SUS SUBCONJUNTOS: la plantilla aplica si lo que ELLA exige esta CONTENIDO en lo que el consumidor
   * trae, no solo si los dos conjuntos son iguales (ver `clavesDeMarcadoresContenidos`).
   */
  buscarServible?(clave: {
    dominiosClave: string;
    codigoDeIntencion: string;
    marcadoresPosibles: readonly string[];
    origenHash: string;
  }): Promise<{ id: string; estado: string; pasos: unknown; origenes: number } | null>;
  /**
   * COEXISTENCIA DE VARIANTES (D5 de resiliencia): la misma lectura, con hasta
   * MAX_CANDIDATAS_DE_CONSUMO filas EN EL ORDEN DEL DESEMPATE. La sonda pre-flight descarta las que
   * no aplican a la pagina de enfrente y se ejecuta la primera que si. Opcional: un fake o un
   * despliegue sin este metodo cae a `buscarServible` (una sola candidata), como hasta hoy.
   */
  buscarServibles?(clave: {
    dominiosClave: string;
    codigoDeIntencion: string;
    marcadoresPosibles: readonly string[];
    origenHash: string;
  }): Promise<Array<{ id: string; estado: string; pasos: unknown; origenes: number }>>;
  /**
   * DONDE SE CORTO la lectura de arriba cuando no devolvio nada. SOLO se llama despues de un miss:
   * es una consulta mas y el camino feliz no la paga. Best-effort: sin ella el veredicto sale igual,
   * solo que sin el corte.
   */
  diagnosticarMiss?(clave: {
    dominiosClave: string;
    codigoDeIntencion: string;
    marcadoresPosibles: readonly string[];
  }): Promise<{ corte: string; origenes: number | null }>;
  /**
   * Contadores agregados de como le fue, MAS las transiciones de estado que la ejecucion dispara
   * (corroborada con el exito doble, retirada al tercer fallo imputable seguido). Best-effort: su
   * fallo no cambia el desenlace del job.
   * `motivo` (V042): por que fallo el ultimo intento, con el vocabulario cerrado del contrato.
   * `consumidorHash` (V043): el hash del consumidor de ESTA corrida; solo se persiste en el exito.
   * Devuelve estado previo y nuevo con la IDENTIDAD de la fila (dominios, intencion, marcadores)
   * para el log de transiciones; void en fakes legados que no lo implementan.
   */
  registrarEjecucion?(
    id: string,
    exitosa: boolean,
    motivo?: MotivoDeFallaDePlantilla,
    consumidorHash?: string,
  ): Promise<{
    estado: string;
    estadoPrevio: string;
    dominiosClave: string;
    codigoDeIntencion: string;
    marcadoresClave: string;
  } | null | void>;
  /**
   * DESAJUSTE DE INTERFAZ detectado por la sonda pre-flight (V044, D4): evidencia estructural con su
   * propio contador de consumidores distintos, separada del retiro por calidad. NO es una ejecucion
   * (no se corrio un solo paso) y no toca los contadores de ejecucion. Best-effort: su fallo no
   * cambia el desenlace del job. Opcional con el mismo criterio que el resto del consumo.
   */
  registrarDesajuste?(
    id: string,
    consumidorHash: string,
  ): Promise<{
    estado: string;
    estadoPrevio: string;
    dominiosClave: string;
    codigoDeIntencion: string;
    marcadoresClave: string;
  } | null | void>;
}

/** Dependencias del job de tarea web. index.ts cablea las reales; los tests pasan fakes. */
export interface TareaWebDeps {
  repo: RepositorioSitiosParaTarea;
  navegador: NavegadorParaTarea;
  motor: MotorDeTareaWeb;
  /** Repositorio de checkpoints de aprobacion (V027): crear al pausar, leer la decision al reanudar. */
  aprobaciones: RepositorioAprobacionesParaWorker;
  /**
   * POLITICA DE EJECUCION del owner (V034): los tres ajustes que configuro UNA sola vez. OPCIONAL con
   * el mismo criterio que `trayectorias`: sin la migracion aplicada el worker sigue corriendo y usa
   * los defaults. Si esta cableado pero la lectura FALLA, la accion irreversible se detiene (jamas se
   * asume permiso sobre una preferencia que no se pudo leer).
   */
  politicas?: RepositorioPoliticasParaWorker | undefined;
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
  /**
   * RECETAS DE TAREA WEB (Fase F paso 2, V035): el procedimiento aprendido de una corrida exitosa.
   * Las TRES piezas del camino determinista son OPCIONALES y van JUNTAS (mismo criterio que
   * `trayectorias`): sin cualquiera de ellas, la tarea corre con el motor exactamente como hoy.
   *  - `recetas`: donde se buscan, se promueven y se marcan obsoletas.
   *  - `determinista`: las primitivas de bajo nivel (CDP) que repiten un paso sin modelo.
   *  - `escalador`: la escalada de UN paso al motor cuando su elemento ya no aparece (D5).
   */
  recetas?: RepositorioRecetasParaWorker | undefined;
  determinista?: NavegadorDeterminista | undefined;
  escalador?: EscaladorDePaso | undefined;
  /**
   * ELECCION ENTRE LAS TAREAS YA ENSENADAS (CAMBIO 3): la UNICA consulta al modelo fuera del motor.
   * Cuando la firma exacta del objetivo no coincide con ninguna receta, se le muestran al modelo las
   * tareas ensenadas de los sitios autorizados y elige cual corresponde y con que datos.
   *
   * OPCIONAL, igual que las tres piezas de arriba: sin ella el camino determinista sigue existiendo
   * pero SOLO por coincidencia exacta de firma, que es como funcionaba antes de este cambio.
   */
  elector?: ElectorDeTareaEnsenada | undefined;
  /**
   * ATLAS DE SITIOS (V040): el APRENDIZAJE COLECTIVO sobre la estructura de cada dominio. Va con su
   * CLAVE HMAC (claveDelAtlas, atlas-sitios.ts), que es lo que permite contar origenes distintos sin
   * identificar a ninguno; las dos juntas o ninguna, porque sin clave no hay con que contar.
   *
   * OPCIONAL con el mismo criterio que el resto del cableado (`trayectorias`, `recetas`): sin la
   * migracion aplicada el worker corre igual, no lee ni escribe nada y las tareas se comportan
   * exactamente como antes de V040.
   */
  atlas?: { repo: RepositorioAtlasParaWorker; clave: string } | undefined;
  /**
   * PLANTILLAS COMPARTIDAS (V041): la publicacion ANONIMA del procedimiento de una tarea de intencion
   * irreversible que el propio origen acaba de aprender. Va con su CLAVE HMAC propia
   * (`clavePlantillas`, plantillas-compartidas.ts), DISTINTA de la del atlas para que los dos hashes
   * del mismo owner sean incomparables; las dos juntas o ninguna, porque sin clave no hay con que
   * contar origenes.
   *
   * OPCIONAL con el mismo criterio que `atlas` y `recetas`: sin la migracion aplicada el worker corre
   * igual, no publica nada y las tareas se comportan exactamente como antes de V041.
   *
   * SOLO ESCRIBE. Nada en este handler lee una plantilla ajena.
   */
  plantillas?: { repo: RepositorioPlantillasParaWorker; clave: string } | undefined;
  /**
   * OBSERVADOR DE PASOS (TAREA_WEB_OBSERVADOR_PASOS): apagado por defecto. Encendido, cada accion
   * CON ELEMENTO RESUELTO abre una conexion CDP para leer del DOM sus estrategias de localizacion
   * (recetas mas ricas, corrida mas cara y mas fragil), y con ellas se habilita la promocion
   * automatica a recetas. Apagado, la tarea corre igual y no se promueve ninguna receta nueva. El
   * ATLAS DE SITIOS no depende de esto: lo alimenta la percepcion, que ya lee la pagina igual.
   */
  observadorPasos?: boolean | undefined;
  /** Notifica por correo la aprobacion pendiente/expirada (best-effort). OPCIONAL. */
  notificadorAprobaciones?: NotificadorAprobaciones | undefined;
  /** Secreto de la boveda: descifra el contexto (7.1a) y re-cifra el actualizado. */
  vaultSecret: string;
  /** Modelo de la navegacion (TAREA_WEB_MODEL; Haiku prohibido, validado al parsear el env). */
  model: string;
  /** Cap DURO de iteraciones (pasos del agente de navegacion) por corrida (TAREA_WEB_MAX_STEPS). */
  maxPasos: number;
  /**
   * Ventana de historial que se le reenvia al modelo en cada llamada (TAREA_WEB_HISTORIAL_PASOS).
   * El objetivo original viaja SIEMPRE; esto acota solo la conversacion posterior.
   */
  historialPasos: number;
  /** Cuando se toma una captura de pantalla durante la corrida (TAREA_WEB_SCREENSHOTS). */
  modoScreenshots: ModoScreenshots;
  /**
   * BARRERA DE IDENTIDAD DEL ELEMENTO (TAREA_WEB_BARRERA_IDENTIDAD, barrera-identidad.ts). Ausente =
   * 'apagada': la barrera ni se evalua y la ejecucion por receta corre exactamente como antes.
   */
  barreraIdentidad?: ModoBarreraIdentidad | undefined;
  /**
   * GUARDIA CON CRITERIO GENERICO (TAREA_WEB_GUARDIA_SIN_INTENCION, verificacion.ts). Ausente =
   * 'apagada': ni se evalua y la corrida se comporta exactamente como antes de este cambio.
   */
  guardiaSinIntencion?: ModoGuardiaSinIntencion | undefined;
  /** Deadline de pared de la tarea, en ms (TAREA_WEB_TIMEOUT_SECONDS * 1000). */
  runTimeoutMs: number;
  /** Resuelve y descifra la credencial del owner (la key del modelo sale de la boveda). */
  resolveCredential(ownerId: string, credentialId: string): Promise<DecryptedProviderCredential>;
  /** Persiste el resultado del job (jobs.resultado, V026) antes del cierre. */
  guardarResultado(jobId: string, resultado: unknown): Promise<void>;
  /**
   * Espera de pared entre relecturas del DOM al confirmar una accion irreversible (CAMBIO 4).
   * OPCIONAL: sin ella se usa un setTimeout real. Los tests inyectan una que no duerme.
   */
  esperar?: ((ms: number) => Promise<void>) | undefined;
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

/** Tope del mensaje final del agente dentro de un error de diagnostico (evita last_error sin cota). */
const MAX_MENSAJE_AGENTE_CHARS = 300;

function truncar(texto: string, max: number): string {
  return texto.length <= max ? texto : `${texto.slice(0, max)}...`;
}

/**
 * Mensaje VERAZ de un motor que termino con exito=false (BUG C). Diagnostico interno (sin i18n):
 *  - "limite de pasos" SOLO cuando los pasos consumidos alcanzaron el limite configurado, con ambos
 *    numeros (el mensaje viejo lo afirmaba siempre, incluso con 15 de 120 pasos consumidos);
 *  - DONE sin cumplir el objetivo: lo dice, con el mensaje final del agente (censurado y acotado);
 *  - cualquier otro corte: mensaje propio, tambien con ambos numeros.
 * Los pasos consumidos se leen de la traza (una accion por tool ejecutada, AgentResult.actions).
 */
export function describirFalloDelMotor(
  resultado: Pick<ResultadoMotor, 'completado' | 'mensaje' | 'acciones'>,
  maxPasos: number,
  sujeto: string = 'la tarea',
): string {
  const pasos = resultado.acciones.length;
  const sinReintento =
    'no se reintenta automaticamente para no repetir acciones sobre la cuenta del usuario';
  if (!resultado.completado && pasos >= maxPasos) {
    return (
      `${sujeto} agoto el limite de pasos configurado (consumio ${pasos} de ${maxPasos} pasos); ` +
      sinReintento
    );
  }
  // El mensaje final del agente puede arrastrar contenido de pagina: pasa por la censura de texto y
  // se acota antes de entrar al last_error.
  const mensajeFinal = censurarTexto(resultado.mensaje).replace(/\s+/g, ' ').trim();
  const detalle =
    mensajeFinal === ''
      ? ''
      : `; mensaje final del agente: ${truncar(mensajeFinal, MAX_MENSAJE_AGENTE_CHARS)}`;
  if (resultado.completado) {
    return (
      `el agente termino con DONE sin cumplir el objetivo de ${sujeto} ` +
      `(consumio ${pasos} de ${maxPasos} pasos)${detalle}; ${sinReintento}`
    );
  }
  return (
    `${sujeto} se detuvo sin exito antes de agotar el limite de pasos ` +
    `(consumio ${pasos} de ${maxPasos} pasos)${detalle}; ${sinReintento}`
  );
}

/**
 * DONE PREMATURO (CAMBIO 3): el objetivo pedia una accion bloqueada y la tarea termino sin que esa
 * accion pasara NUNCA por la guardia. No la ejecuto y tampoco la detuvo el sistema: el agente se paro
 * solo. Es un fallo con causa PROPIA y mensaje propio a proposito.
 *
 * Por que importa: hasta este PR ese caso caia en el mensaje generico de describirFalloDelMotor ("el
 * agente termino con DONE sin cumplir el objetivo"), indistinguible de un objetivo mal redactado o de
 * un sitio que cambio. Con ese mensaje generico, dos dias de produccion mostraron 25 pasos correctos
 * y un borrador sin enviar sin que nada dijera que la causa era una instruccion del prompt.
 */
export function describirAccionNoVerificada(
  verbo: string,
  resultado: Pick<ResultadoMotor, 'mensaje' | 'acciones'>,
  maxPasos: number,
): string {
  const mensajeFinal = censurarTexto(resultado.mensaje).replace(/\s+/g, ' ').trim();
  const detalle =
    mensajeFinal === ''
      ? ''
      : `; mensaje final del agente: ${truncar(mensajeFinal, MAX_MENSAJE_AGENTE_CHARS)}`;
  return (
    `el objetivo pedia una accion de tipo "${verbo}" y la tarea termino sin ejecutarla: el agente se ` +
    'detuvo por su cuenta y esa accion nunca llego a la verificacion previa del sistema, asi que ' +
    `tampoco fue el sistema quien la detuvo (consumio ${resultado.acciones.length} de ${maxPasos} ` +
    `pasos)${detalle}; no se reintenta automaticamente para no repetir acciones sobre la cuenta del ` +
    'usuario'
  );
}

/**
 * DATOS QUE NUNCA SE COMPLETARON (CAMBIO 1): la accion llego a la verificacion, pero la pagina jamas
 * mostro todos los datos que el objetivo declaraba, asi que nunca paso al navegador y el agente
 * termino sin ejecutarla. Es distinto de describirAccionNoVerificada (donde la accion ni siquiera
 * llego a la verificacion): aqui SI hubo comparacion, y el diagnostico dice exactamente que dato
 * faltaba, que es lo unico accionable para el usuario.
 */
export function describirDatosNuncaCompletados(
  verbo: string,
  faltantes: string[],
  resultado: Pick<ResultadoMotor, 'acciones'>,
  maxPasos: number,
): string {
  return (
    `el objetivo pedia una accion de tipo "${verbo}" y NO se ejecuto: la verificacion previa del ` +
    `sistema nunca encontro en la pagina todos los datos que el objetivo declaraba (falto: ` +
    `${faltantes.join(', ')}), asi que la accion jamas paso al navegador (consumio ` +
    `${resultado.acciones.length} de ${maxPasos} pasos); no se reintenta automaticamente para no ` +
    'repetir acciones sobre la cuenta del usuario'
  );
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
 * Lee la POLITICA DE EJECUCION del owner (D3, V034). Devuelve:
 *  - los DEFAULTS si el repositorio no esta cableado (despliegue sin la migracion) o si el usuario
 *    nunca configuro nada (sin fila; NO se crea la fila al leer),
 *  - null si la lectura FALLO: la verificacion lo trata como "no se pudo confirmar tu preferencia" y
 *    DETIENE la accion. Falla cerrada a proposito: asumir permiso sobre un dato que no se pudo leer
 *    convertiria una caida de la base en una autorizacion silenciosa.
 */
async function leerPoliticaVigente(deps: TareaWebDeps, ownerId: string): Promise<PoliticaVigente | null> {
  if (!deps.politicas) return POLITICA_EJECUCION_DEFAULT;
  try {
    return (await deps.politicas.obtenerPorOwner(ownerId)) ?? POLITICA_EJECUCION_DEFAULT;
  } catch (error) {
    deps.logger.error(
      'tarea web: no se pudo leer la politica de ejecucion del usuario; las acciones irreversibles se detendran',
      { ownerId, err: describir(error) },
    );
    return null;
  }
}

/**
 * Foto de SOLO LECTURA de la pagina justo antes de ejecutar: valores actuales de los campos y texto
 * visible. null si no se pudo leer; sin foto NO se ejecuta (la verificacion lo trata como "no
 * coincide" con nada encontrado, nunca como "seguro esta bien").
 */
async function leerEstadoDeLaPagina(
  deps: TareaWebDeps,
  job: Job,
  sesionExternaId: string,
): Promise<EstadoDeLaPagina | null> {
  try {
    const campos = await deps.navegador.leerCamposDeLaPagina(sesionExternaId);
    const texto = await deps.navegador.leerTextoVisible(sesionExternaId);
    return { campos, texto };
  } catch (error) {
    deps.logger.warn('tarea web: no se pudo leer el estado de la pagina para verificar la accion', {
      jobId: job.id,
      err: describir(error),
    });
    return null;
  }
}

/** Detencion sin comparaciones, para los motivos que no nacen de comparar (contrato con la consola). */
function detencionDirecta(motivo: 'otraAccion' | 'politicaNoDisponible'): Extract<Veredicto, { tipo: 'detener' }> {
  return { tipo: 'detener', detencion: { motivo }, comparaciones: [] };
}

/**
 * La verificacion INCOMPLETA como DETENCION, para el unico camino que no puede seguir llenando
 * campos (la ejecucion por receta). Motivo 'noCoincide' con lo pedido vacio: no hay otro valor con
 * el que discrepar, lo que hay es un dato que la pagina no muestra.
 */
function detencionPorDatosIncompletos(faltantes: string[]): Extract<Veredicto, { tipo: 'detener' }> {
  return {
    tipo: 'detener',
    detencion: {
      motivo: 'noCoincide',
      pedido: faltantes.join(', '),
      encontrado: '',
      detalle: 'la pagina no muestra todos los datos declarados en el objetivo',
    },
    comparaciones: [],
  };
}

/**
 * VERIFICACION DETERMINISTA completa: politica del usuario + parametros del objetivo + foto del DOM.
 * UNA sola implementacion para los DOS caminos (el del motor y el de la receta): que la ejecucion por
 * receta pudiera verificar con otro criterio seria exactamente la puerta trasera que D7 prohibe.
 *
 * El modelo no participa de ninguno de los tres insumos: la politica sale de la base, los parametros
 * del texto del usuario y los valores del DOM leido en un mundo aislado.
 *
 * ES TAMBIEN el unico punto donde se aplica el MODO de la guardia sin intencion (D3): los cuatro
 * caminos que comparan pasan por aqui, asi que la exigencia de D2 y su reversion en modo observacion
 * se escriben una sola vez y ningun camino puede quedarse atras.
 */
async function resolverVerificacion(
  deps: TareaWebDeps,
  job: Job,
  sitio: SitioConectado,
  sesionExternaId: string,
  opciones: {
    politica: PoliticaVigente | null;
    verboBloqueado: string | null;
    /** Texto del que salen los parametros: el LITERAL del usuario si llego (CAMBIO 3). */
    textoParametros: string;
    /**
     * Parametros YA RESUELTOS que reemplazan a los del extractor. Solo los trae el camino por tarea
     * ensenada (CAMBIO 3), donde los datos salieron de la eleccion del modelo y ya estan ANCLADOS al
     * texto literal del usuario. Se comparan contra la pagina EXACTAMENTE igual que los extraidos:
     * son los mismos datos que la tarea va a escribir, asi que verificar contra ellos es verificar
     * contra lo que se va a hacer. Ausente = el extractor determinista de siempre.
     */
    parametros?: ParametrosDeclarados | null | undefined;
    /**
     * D2: la accion que se va a verificar NO es de solo lectura, asi que cero comparaciones no puede
     * resolver 'ejecutar'. Lo pasan los cuatro caminos que preceden a una accion; la exencion de
     * navegacion y lectura ya se resolvio antes de llegar aqui.
     */
    exigeComparacion?: boolean;
  },
): Promise<ResolucionDeVerificacion> {
  if (opciones.politica === null) {
    return { veredicto: detencionDirecta('politicaNoDisponible'), pagina: null, habriaDetenido: false };
  }
  const modo = deps.guardiaSinIntencion ?? 'apagada';
  const pagina = await leerEstadoDeLaPagina(deps, job, sesionExternaId);
  const veredicto = verificarAccion({
    politica: opciones.politica,
    dominio: sitio.dominio,
    verbo: opciones.verboBloqueado,
    parametros: opciones.parametros ?? extraerParametrosDeclarados(opciones.textoParametros),
    pagina,
    exigeComparacion: opciones.exigeComparacion === true && modo !== 'apagada',
  });
  // MODO OBSERVACION (D3): el veredicto se calcula IGUAL y no detiene nada. Solo se revierte la
  // detencion NUEVA de D2; cualquier otra es anterior a este cambio y se aplica en los tres modos.
  if (modo !== 'activa' && esDetencionSinEvidencia(veredicto)) {
    deps.logger.warn(
      'tarea web: la guardia con criterio generico HABRIA detenido la accion (modo observacion); no se detuvo nada',
      { jobId: job.id, connectionId: sitio.id, dominio: sitio.dominio, verbo: opciones.verboBloqueado },
    );
    return { veredicto: { tipo: 'ejecutar', comparaciones: [] }, pagina, habriaDetenido: true };
  }
  return { veredicto, pagina, habriaDetenido: false };
}

/**
 * El resultado de una verificacion mas la telemetria de D3: `habriaDetenido` es true cuando el modo
 * observacion revirtio una detencion por cero comparaciones. El veredicto que sale ya es el que hay
 * que aplicar, en cualquiera de los tres modos: ningun llamador vuelve a mirar el modo.
 */
interface ResolucionDeVerificacion {
  veredicto: Veredicto;
  pagina: EstadoDeLaPagina | null;
  habriaDetenido: boolean;
}

/**
 * LO QUE EL MODO OBSERVACION MIDE (D3), acumulado a lo largo de TODA la corrida (los tres caminos y
 * los tramos multisitio escriben aca). Es el numero que responde la unica pregunta que decide si el
 * modo activo se puede encender: cuantas acciones reales habria detenido este cambio.
 */
export interface ObservacionDeLaGuardia {
  /**
   * Acciones que la regla nueva HABRIA detenido y no detuvo. Cuenta por los DOS caminos: el criterio
   * generico de una corrida sin intencion reconocida y la exigencia de comparar de una intencion
   * reconocida que no exige parametros.
   */
  habriaDetenido: number;
  /**
   * Acciones que la guardia juzgo CON EL CRITERIO GENERICO, es decir, las de una corrida sin
   * intencion reconocida y no exentas. Una corrida con verbo no suma aqui: ahi juzga la verificacion
   * de siempre, que ya corria antes de este cambio.
   */
  evaluadas: number;
}

/** El acumulador de una corrida, en cero. */
function crearObservacionDeLaGuardia(): ObservacionDeLaGuardia {
  return { habriaDetenido: 0, evaluadas: 0 };
}

/**
 * EL ESCALAR de la observacion para jobs.resultado (D4), del que /actividad deriva su aviso en
 * lenguaje llano. Solo viaja cuando hubo algo que contar: una corrida que no toco la guardia generica
 * deja el resultado exactamente como antes de este cambio.
 *
 * Vocabulario CERRADO y numeros: ni un dato del usuario, ni una descripcion del modelo, ni nada leido
 * de la pagina. Lo escriben SOLO los cierres exitosos: en modo activo una detencion cierra la corrida
 * por otro camino y su motivo ya viaja en el last_error.
 */
function escalarDeLaObservacion(
  observacion: ObservacionDeLaGuardia,
  modo: ModoGuardiaSinIntencion,
): { guardiaSinIntencion?: { modo: string; evaluadas: number; habriaDetenido: number } } {
  if (observacion.evaluadas === 0 && observacion.habriaDetenido === 0) return {};
  return {
    guardiaSinIntencion: {
      modo,
      evaluadas: observacion.evaluadas,
      habriaDetenido: observacion.habriaDetenido,
    },
  };
}

/**
 * El paso sintetico de una verificacion, con el LUGAR de la corrida en que ocurrio (cuantas acciones
 * del agente la precedieron). La posicion importa: la receta que se promueva de esta corrida aprende
 * a volver a comparar EN ESE PUNTO, no al principio (D7).
 */
interface VerificacionEnLaTraza {
  /** Acciones que el agente ya habia propuesto cuando esta verificacion corrio. */
  accionesPrevias: number;
  paso: PasoCensurado;
}

/**
 * EL CONTROL DE LA ACCION IRREVERSIBLE tal como la barrera de identidad lo LEYO DEL DOM, con el
 * dominio en el que se leyo (multisitio: la corrida puede terminar en otro sitio distinto de aquel en
 * el que se envio). Es el unico dato de PRIMERA MANO que este camino tiene sobre el elemento que va a
 * consumar la accion, y hasta hoy se calculaba, se comparaba y se tiraba.
 */
export interface ControlDeLaAccionIrreversible {
  dominio: string;
  /** Rol accesible del control (el mismo `rolDe` que leen la percepcion y el grabador). */
  rol: string;
  /** Nombre accesible COMPLETO leido del DOM. */
  nombre: string;
  /** Cuantos controles de la familia del verbo matchearon en la pagina, visibles u ocultos. */
  candidatos: number;
}

/** La guardia tal como la usa el handler: el puerto mas lo que hay que saber al terminar la corrida. */
interface GuardiaDeTareaWeb extends GuardiaDeAccion {
  /** ¿Alguna accion llego a pasar por la verificacion y fue autorizada EN ESTE SITIO? */
  autorizoAlgo(): boolean;
  /** Mensaje de la detencion con la que la guardia corto la corrida, o null si no corto ninguna. */
  bloqueo(): string | null;
  /** Parametros que la ultima verificacion incompleta echo en falta (CAMBIO 1), o null si no hubo. */
  faltantes(): string[] | null;
  /** Pasos sinteticos de verificacion de esta corrida, para la trayectoria. */
  verificaciones(): VerificacionEnLaTraza[];
  /**
   * El control que la barrera de identidad leyo del DOM antes de dejar salir la accion irreversible,
   * o null si no llego a leer ninguno (barrera apagada, objetivo sin verbo bloqueado, pagina sin
   * control de la familia o fallo de la lectura). Lo consume el CIERRE de la corrida, que es donde
   * consta que la accion ademas surtio efecto.
   */
  controlAccionado(): ControlDeLaAccionIrreversible | null;
}

/** Cuantas veces se relee el DOM buscando la confirmacion de la accion antes de darla por no confirmada. */
const INTENTOS_DE_CONFIRMACION = 3;

/** Espera entre relecturas de la confirmacion (el sitio tarda en cerrar el redactor o pintar el aviso). */
const ESPERA_ENTRE_CONFIRMACIONES_MS = 500;

/** Espera real: solo se usa fuera de los tests, que inyectan la suya para no dormir. */
function esperarMs(ms: number): Promise<void> {
  return new Promise((resolver) => setTimeout(resolver, ms));
}

/** Lo que la guardia necesita para evaluar la barrera de identidad, ya resuelto por el handler. */
interface BarreraDeIdentidadParaGuardia {
  /** 'apagada' ni evalua; 'observacion' solo registra; 'activa' ademas no deja pasar la accion. */
  modo: ModoBarreraIdentidad;
  /** Clases que el atlas tiene CORROBORADAS para ese dominio. Sincrono: ya se leyo al arrancar. */
  clasesCorroboradas(dominio: string): ReadonlySet<string>;
}

/**
 * El veredicto de la barrera como PASO SINTETICO de la trayectoria, con la MISMA etiqueta que el
 * camino de recetas (resumenDeIdentidad, barrera-identidad.ts) y por tanto visible en /actividad
 * igual que la de una corrida por receta. Es lo que permite comparar la medicion de los dos caminos.
 *
 * `sinElemento` distingue los dos casos que el motivo 'clase_no_corroborada' junta en este camino: no
 * haber encontrado en el DOM ningun control de la familia del verbo, o haberlo encontrado con una
 * clase que el atlas no corroboro. Para decidir si el consumo de plantillas ajenas puede ser seguro
 * esa diferencia es justamente el dato, y se registra sin tocar la funcion pura.
 *
 * La descripcion del act pasa por la MISMA censura que el resto de la traza.
 */
function construirPasoDeIdentidad(
  accion: string,
  resultado: ResultadoDeLaBarrera,
  modo: ModoBarreraIdentidad,
  sinElemento: boolean,
): PasoCensurado {
  const { etiqueta, exito } = resumenDeIdentidad(resultado, modo);
  const argumentos: string[] = [];
  if (resultado.tipo === 'bloquear') argumentos.push(resultado.motivo);
  if (sinElemento) argumentos.push('sin elemento de la familia del verbo en la pagina');
  return {
    idx: 0,
    accion: {
      tipo: etiqueta,
      instruccion: `barrera de identidad sobre la accion del motor: ${censurarTexto(accion)}`,
      metodo: null,
      argumentos,
    },
    selector: null,
    valorCensurado: null,
    estrategias: [],
    url: null,
    exito,
  };
}

/**
 * PASO SINTETICO de la GUARDIA CON CRITERIO GENERICO en la traza (D4), hermano del de la barrera de
 * identidad y con el mismo criterio de lectura: en observacion la etiqueta dice HABRIA_DETENIDO y el
 * paso queda con exito true, porque la accion siguio su camino y marcarlo fallido leeria como si algo
 * no hubiera corrido.
 *
 * `argumentos` lleva VOCABULARIO CERRADO y nada mas: el motivo de la detencion y, en observacion, la
 * constancia de que no se detuvo nada. Ni un dato del usuario ni nada leido de la pagina.
 */
function construirPasoDeGuardiaGenerica(
  accion: string,
  resolucion: ResolucionDeVerificacion,
): PasoCensurado {
  const { etiqueta, exito } = resumenDeGuardiaSinIntencion(resolucion);
  const argumentos: string[] = [];
  if (resolucion.veredicto.tipo === 'detener') {
    argumentos.push(resolucion.veredicto.detencion.motivo);
  } else if (resolucion.habriaDetenido) {
    // El modo ya revirtio la detencion de D2 a 'ejecutar', asi que el motivo hay que nombrarlo aqui:
    // es el mismo del contrato con la consola, no una etiqueta nueva.
    argumentos.push('sinEvidenciaParaComparar');
  }
  if (resolucion.habriaDetenido) argumentos.push('modo observacion: no se detuvo nada');
  return {
    idx: 0,
    accion: {
      tipo: etiqueta,
      instruccion:
        'guardia sin intencion reconocida: la accion se evaluo con el criterio generico: ' +
        censurarTexto(accion),
      metodo: null,
      argumentos,
    },
    selector: null,
    valorCensurado: null,
    estrategias: [],
    url: null,
    exito,
  };
}

/**
 * La DETENCION con la que se cierra la corrida cuando la barrera bloquea en modo 'activa'. Mismo
 * patron que detencionPorDatosIncompletos: un 'noCoincide' del contrato que ya existe, con lo pedido
 * y lo encontrado en los campos que la consola ya sabe traducir. NO se inventa un cierre nuevo ni un
 * motivo nuevo: el veredicto viaja por `bloquear`, igual que cualquier otra detencion de la guardia.
 *
 * `encontrado` va VACIO a proposito: el nombre accesible que se leyo del DOM no vuelve al usuario ni
 * al modelo por este canal (el motivo tecnico ya queda en el paso de la trayectoria).
 */
function detencionPorIdentidad(motivo: string): Extract<Veredicto, { tipo: 'detener' }> {
  return {
    tipo: 'detener',
    detencion: {
      motivo: 'noCoincide',
      pedido: 'el elemento que corresponde a la accion pedida',
      encontrado: '',
      detalle: `no se pudo confirmar la identidad del elemento a accionar (${motivo})`,
    },
    comparaciones: [],
  };
}

/**
 * GUARDIA DE ACCION (CAMBIO 2): la VERIFICACION DETERMINISTA corriendo INMEDIATAMENTE ANTES de la
 * accion, dentro del mismo bucle del agente y sin que el agente participe.
 *
 * QUE SUSTITUYE: hasta este PR la verificacion corria DESPUES de que el agente terminara su corrida
 * entera, y solo si el agente se detenia y lo reportaba; si pasaba, se lanzaba una SEGUNDA corrida
 * del motor para ejecutar. Toda esa maquinaria dependia de que el agente cooperara dos veces (que se
 * detuviera y que despues ejecutara). Ahora el agente ejecuta de una sola corrida y es el worker
 * quien se interpone: el adaptador del motor consulta `revisar` con la descripcion de cada accion
 * ANTES de mandarla al navegador.
 *
 * COMO DECIDE, en este orden:
 *  1. el objetivo del usuario no contiene ningun verbo bloqueado -> no hay nada que verificar;
 *  2. la tarea se termino desde la consola -> se bloquea (ejecutar lo que el usuario acaba de
 *     cancelar es lo peor que puede hacer este camino);
 *  3. la descripcion de la accion no corresponde A LA ACCION QUE PIDIO EL USUARIO (su verbo, o el de
 *     su familia en el otro idioma) ni a un cierre de formulario -> pasa (es un paso intermedio:
 *     abrir, escribir, navegar). Que la descripcion nombre el verbo de OTRA accion bloqueada no la
 *     convierte en la accion del objetivo: no consume cupo y no se bloquea (CAMBIO 1);
 *  4. ya se EJECUTO una accion irreversible en esta corrida -> se bloquea con 'otraAccion': no se
 *     encadenan verificaciones dentro de una misma corrida (seria un bucle sin cota sobre la cuenta
 *     real) y es lo que impide que el agente envie dos veces;
 *  5. si no: politica del usuario + parametros del objetivo + foto del DOM. Coinciden LOS N
 *     parametros declarados y la politica lo permite -> pasa. Falta escribir alguno -> 'incompleto'
 *     (la accion no pasa y la tarea SIGUE). Hay otro valor donde deberia estar el pedido, o la
 *     politica lo impide -> se bloquea con el mensaje que dice que se pidio y que se encontro.
 *
 * QUE CUENTA COMO "YA SE EJECUTO UNA ACCION" (CAMBIO 2): SOLO una accion que la guardia dejo pasar
 * al navegador (`irreversiblesEjecutadas`). Antes contaba cualquier verificacion superada, aunque la
 * accion no fuera la irreversible de verdad: un intento prematuro (el formulario a medio llenar)
 * consumia el unico cupo de la corrida y el envio real, ya con todos los datos, se bloqueaba como si
 * fuera un segundo envio. Un intento que no supero la verificacion, o que se bloqueo, NO cuenta.
 *
 * EL CUPO ES POR SITIO (multisitio): ese contador vive en `opciones.estado`, que el handler mantiene
 * POR CONEXION y a lo largo de TODA la tarea, no en esta guardia. Enviar un correo en un sitio y
 * comprar en otro son dos acciones distintas y las dos tienen que poder ejecutarse en la misma tarea;
 * lo que no puede haber es dos acciones irreversibles en el MISMO sitio, ni siquiera volviendo a el
 * despues de haber pasado por otro (por eso el contador sobrevive al cambio de tramo).
 *
 * NUNCA LANZA: cualquier error inesperado se convierte en bloqueo (falla cerrada). Una excepcion que
 * escapara de aqui saldria por la tool del agente y se leeria como un fallo del motor, no como lo que
 * es: que el sistema no pudo comprobar la accion.
 */
function crearGuardiaDeAccion(
  deps: TareaWebDeps,
  job: Job,
  sitio: SitioConectado,
  sesionExternaId: string,
  opciones: {
    politica: PoliticaVigente | null;
    /**
     * Verbo irreversible del OBJETIVO DEL USUARIO, resuelto UNA vez al arrancar la corrida. null =
     * el objetivo no pide ninguna accion bloqueada y la guardia deja pasar todo.
     */
    verboBloqueado: string | null;
    /** Texto del que salen los parametros: el LITERAL del usuario si llego (CAMBIO 3). */
    textoParametros: string;
    /**
     * TEXTO DEL USUARIO contra el que se resuelve la excepcion de los controles de ventana (FIX A):
     * su literal MAS el objetivo que redacto el modelo conversacional. La union porque cualquiera de
     * los dos puede ser el unico que nombre el control, y equivocarse hacia el lado permisivo es el
     * lado barato. Lo que NUNCA entra aca es la descripcion que el agente de navegacion escribe en
     * cada paso: es justo a quien la regla vigila.
     */
    objetivoDelUsuario: string;
    control?: ControlDeTareaWeb | undefined;
    /**
     * ESTADO DEL SITIO a lo largo de TODA la tarea (no de este tramo): el cupo de accion irreversible.
     * Lo mantiene el handler por conexion, para que volver a un sitio ya visitado no reabra su cupo.
     */
    estado: EstadoDeSitioParaGuardia;
    /**
     * BARRERA DE IDENTIDAD DEL ELEMENTO (barrera-identidad.ts) para el camino del MOTOR LIBRE.
     * Ausente = la barrera NO se evalua y la guardia se comporta exactamente como antes.
     */
    barreraIdentidad?: BarreraDeIdentidadParaGuardia | undefined;
    /**
     * TELEMETRIA de la guardia con criterio generico (D3), COMPARTIDA por toda la corrida: una tarea
     * multisitio crea una guardia por tramo y lo que se reporta al final es la corrida entera.
     */
    observacion?: ObservacionDeLaGuardia | undefined;
  },
): GuardiaDeTareaWeb {
  const verificaciones: VerificacionEnLaTraza[] = [];
  const parametros = extraerParametrosDeclarados(opciones.textoParametros);
  const declarados = contarParametrosDeclarados(parametros);
  const esperar = deps.esperar ?? esperarMs;
  const estado = opciones.estado;
  let acciones = 0;
  /** Foto del DOM de la accion permitida, contra la que se confirma su efecto. */
  let paginaPrevia: EstadoDeLaPagina | null = null;
  let mensajeDeBloqueo: string | null = null;
  let ultimosFaltantes: string[] | null = null;
  /** La accion permitida en vuelo es el REINTENTO autorizado (FIX A): su confirmacion es terminal. */
  let ejecucionPendienteEsReintento = false;
  /** Intentos irreversibles bloqueados DESPUES de agotar el reintento (FIX C): al segundo, corte. */
  let bloqueosTrasReintento = 0;
  /** El control que la barrera leyo del DOM en la accion irreversible. Lo consume el cierre. */
  let controlAccionado: ControlDeLaAccionIrreversible | null = null;

  const bloquear = (veredicto: Extract<Veredicto, { tipo: 'detener' }>): VeredictoDeGuardia => {
    mensajeDeBloqueo = mensajeDeDetencion(veredicto);
    return { tipo: 'bloquear', mensaje: mensajeDeBloqueo };
  };
  /**
   * TELEMETRIA DE OBSERVACION (D3) sobre la accion IRREVERSIBLE del objetivo: cuando el modo revirtio
   * una detencion por cero comparaciones, queda contada. `evaluadas` no sube por este camino: el
   * criterio generico no fue el que juzgo esta accion, la verificacion de siempre si.
   */
  const contarObservacion = (habriaDetenido: boolean): void => {
    if (!habriaDetenido || opciones.observacion === undefined) return;
    opciones.observacion.habriaDetenido += 1;
  };

  return {
    // "Autorizo algo" es exactamente "dejo salir una accion irreversible al navegador".
    autorizoAlgo: () => estado.irreversiblesEjecutadas > 0,
    bloqueo: () => mensajeDeBloqueo,
    faltantes: () => ultimosFaltantes,
    verificaciones: () => verificaciones,
    controlAccionado: () => controlAccionado,
    revisar: async (accion: string): Promise<VeredictoDeGuardia> => {
      // Cuantas acciones del agente LLEGARON al navegador antes que esta. Solo avanza con las
      // permitidas (permitir()): una accion que no paso no deja paso en la traza, y si se contara
      // igual, el paso de verificacion quedaria intercalado en el lugar equivocado.
      const accionesPrevias = acciones;
      const permitir = (veredicto: VeredictoDeGuardia): VeredictoDeGuardia => {
        acciones += 1;
        return veredicto;
      };
      // CAMBIO 4: toda decision de la guardia que NO deja pasar la accion queda como PASO de la
      // trayectoria, con exito false y su motivo, en el punto exacto de la corrida en que ocurrio.
      // La descripcion del act pasa por la MISMA censura que el resto de la traza.
      const registrarRechazo = (motivo: string): void => {
        verificaciones.push({
          accionesPrevias,
          paso: construirPasoDeBloqueo(
            `guardia: la accion NO se ejecuto (${motivo}): ${censurarTexto(accion)}`,
          ),
        });
      };
      const bloquearRegistrando = (
        veredicto: Extract<Veredicto, { tipo: 'detener' }>,
      ): VeredictoDeGuardia => {
        registrarRechazo(veredicto.detencion.motivo);
        return bloquear(veredicto);
      };
      /**
       * BARRERA DE IDENTIDAD DEL ELEMENTO (barrera-identidad.ts) en el camino del MOTOR LIBRE.
       *
       * SE INTERPONE JUSTO ANTES DE `permitir` con `confirmar: true`, que son los DOS unicos puntos
       * por los que la accion IRREVERSIBLE del objetivo sale al navegador (el primer intento y su
       * unico reintento autorizado). Se llama ANTES de tocar `estado` a proposito: en modo 'activa'
       * la accion no sale, y contar una ejecucion que no ocurrio corromperia el cupo de la corrida.
       *
       * QUE MIRA, y en que se diferencia del camino de recetas: aqui la guardia corre ANTES de que el
       * motor resuelva el elemento, asi que el elemento exacto que se va a accionar todavia no es un
       * dato de este proceso. Lo que se lee del DOM es el control de la FAMILIA DEL VERBO DEL USUARIO
       * (nombresDeLaFamilia, jamas la descripcion que redacta el modelo) y lo que se comprueba es que
       * ese control EXISTA y que su clase este corroborada por el atlas en este dominio.
       *
       * NO SE EVALUA en las acciones intermedias (abrir, escribir, navegar): sin el paso de la receta
       * no hay clase que comparar sin leer el DOM, y leerlo por accion costaria una conexion CDP en
       * cada uno de los ~28 pasos de una corrida para producir un veredicto sin contenido.
       *
       * TODO EN TRY/CATCH PROPIO: un fallo de la barrera queda como 'no_evaluable' y jamas cambia el
       * desenlace de la accion ni del job. Devuelve un veredicto SOLO en modo 'activa'.
       */
      const revisarIdentidad = async (): Promise<VeredictoDeGuardia | null> => {
        const barrera = opciones.barreraIdentidad;
        if (barrera === undefined || barrera.modo === 'apagada') return null;
        let resultado: ResultadoDeLaBarrera;
        let sinElemento = true;
        try {
          const localizar = deps.navegador.localizarBotonPorAriaLabel;
          const prefijos = nombresDeLaFamilia(opciones.verboBloqueado);
          const boton =
            localizar === undefined || prefijos.length === 0
              ? null
              : await localizar.call(deps.navegador, sesionExternaId, prefijos);
          sinElemento = boton === null;
          // LO LEIDO SE GUARDA, no se tira. Es el mismo dato con el que se arma la clase de abajo, y
          // el unico de este camino que describe el elemento que va a consumar la accion. Quien
          // decide si llega al atlas es el CIERRE de la corrida (ahi consta el efecto confirmado):
          // aqui el boton esta localizado, pero todavia no accionado.
          if (boton !== null) {
            controlAccionado = {
              dominio: sitio.dominio,
              rol: boton.rol,
              nombre: boton.ariaLabel,
              candidatos: boton.candidatos,
            };
          }
          resultado = verificarIdentidadDeElemento({
            // La clase se construye con la MISMA funcion con la que el atlas escribio las suyas, a
            // partir del elemento LEIDO DEL DOM: es la unica identidad disponible en este camino.
            claseDeclarada:
              boton === null
                ? null
                : claseDeElemento('click', [
                    { tipo: 'rol', rol: boton.rol, nombre: boton.ariaLabel },
                  ]),
            clasesCorroboradas: barrera.clasesCorroboradas(sitio.dominio),
            verboDelObjetivo: opciones.verboBloqueado,
            esPasoIrreversible: true,
            nombreAccesible: boton === null ? null : boton.ariaLabel,
          });
        } catch (error) {
          deps.logger.warn('tarea web: la barrera de identidad fallo; el veredicto queda no evaluable', {
            jobId: job.id,
            connectionId: sitio.id,
            err: describir(error),
          });
          resultado = { tipo: 'no_evaluable' };
        }
        verificaciones.push({
          accionesPrevias,
          paso: construirPasoDeIdentidad(accion, resultado, barrera.modo, sinElemento),
        });
        if (barrera.modo !== 'activa' || resultado.tipo !== 'bloquear') return null;
        deps.logger.warn('tarea web: la barrera de identidad bloqueo la accion del motor', {
          jobId: job.id,
          connectionId: sitio.id,
          dominio: sitio.dominio,
          motivo: resultado.motivo,
        });
        return bloquear(detencionPorIdentidad(resultado.motivo));
      };
      /**
       * GUARDIA CON CRITERIO GENERICO, para la corrida cuya INTENCION EL SISTEMA NO RECONOCE (D1).
       *
       * QUE JUZGA. Lo unico que hay cuando no hay verbo: la POLITICA del usuario (acciones apagadas,
       * dominio excluido, tope de monto), que la pagina se pueda leer, y la COMPARACION de los datos
       * que el objetivo SI declaro. Es la misma verificacion determinista de siempre -- no hay un
       * criterio nuevo ni mas laxo -- corriendo donde antes no corria nada.
       *
       * QUE NO JUZGA, y es la limitacion honesta de este camino: la IDENTIDAD del control. La barrera
       * necesita la familia del verbo para saber que buscar en el DOM (nombresDeLaFamilia devuelve la
       * lista vacia sin verbo), asi que sin intencion reconocida no hay nombre accesible que leer ni
       * clase que comparar contra el atlas. Evaluarla igual produciria 'clase_no_corroborada' en
       * todas las acciones: un bloqueo general disfrazado de criterio, no una comprobacion.
       *
       * LA UNICA EXENCION es esNavegacionDeSoloLectura (D1). Es estrecha a proposito y por eso el
       * default de produccion es observacion: su asimetria se diseno al reves de la de aqui, y hoy
       * deja bajo guardia descripciones que son de solo lectura ("busca el correo de ana", "open the
       * first email"). El modo activo se enciende cuando la medicion diga que ya no cuesta corridas.
       *
       * FUERA DE 'activa' NO DETIENE NADA, sea cual sea el veredicto. Toda esta rama es
       * comportamiento NUEVO: hasta hoy una corrida sin verbo no podia detenerse aqui por ningun
       * motivo, ni siquiera por la politica del usuario, asi que aplicar cualquiera de ellos en
       * observacion cambiaria el desenlace de corridas reales, que es justo lo que el modo evita.
       *
       * DEVUELVE null salvo que haya que cortar: en observacion cuenta, registra y deja pasar.
       */
      const revisarSinIntencion = async (): Promise<VeredictoDeGuardia | null> => {
        const modo = deps.guardiaSinIntencion ?? 'apagada';
        if (modo === 'apagada') return null;
        // Navegacion y lectura reconocidas: pasan sin guardia y SIN paso en la traza. Son la mayoria
        // de las acciones de una corrida y anotarlas una por una haria ilegible la tarjeta.
        if (esNavegacionDeSoloLectura(accion)) return null;
        let resolucion: ResolucionDeVerificacion;
        try {
          resolucion = await resolverVerificacion(deps, job, sitio, sesionExternaId, {
            politica: opciones.politica,
            // NULL a proposito: sin verbo no hay parametro exigido y no se inventa uno.
            verboBloqueado: null,
            textoParametros: opciones.textoParametros,
            exigeComparacion: true,
          });
        } catch (error) {
          // Falla CERRADA, igual que el resto de la guardia: si la comprobacion no se pudo completar,
          // la accion no pasa. Se arma como cualquier otra detencion para que cuente y quede en la
          // traza tambien en observacion, donde ademas no detiene nada.
          deps.logger.error('tarea web: la guardia con criterio generico fallo', {
            jobId: job.id,
            connectionId: sitio.id,
            err: describir(error),
          });
          resolucion = {
            veredicto: detencionDirecta('politicaNoDisponible'),
            pagina: null,
            habriaDetenido: false,
          };
        }
        // EN OBSERVACION todo veredicto de detencion es un "habria": el que el modo ya revirtio
        // (cero comparaciones) y los que este camino nunca aplico hasta hoy (politica, tope, dato
        // que no coincide, pagina ilegible).
        const habriaDetenido =
          modo !== 'activa' && (resolucion.habriaDetenido || resolucion.veredicto.tipo === 'detener');
        const observacion = opciones.observacion;
        if (observacion !== undefined) {
          observacion.evaluadas += 1;
          if (habriaDetenido) observacion.habriaDetenido += 1;
        }
        verificaciones.push({
          accionesPrevias,
          paso: construirPasoDeGuardiaGenerica(accion, { ...resolucion, habriaDetenido }),
        });
        if (modo !== 'activa') return null;
        // INCOMPLETO NO DETIENE por este camino, y es deliberado: sin intencion reconocida no se
        // sabe cual de las acciones es la que consuma, y bloquear cada una hasta que todos los datos
        // esten en pantalla dejaria a la corrida sin forma de escribirlos (el dato llega a la pagina
        // justamente actuando). Sigue siendo mas estricto que el `return permitir` de antes: lo que
        // no pasa es una accion sin NADA que comparar, o con un dato que NO COINCIDE.
        if (resolucion.veredicto.tipo !== 'detener') return null;
        deps.logger.warn('tarea web: la guardia con criterio generico detuvo la accion', {
          jobId: job.id,
          connectionId: sitio.id,
          dominio: sitio.dominio,
          motivo: resolucion.veredicto.detencion.motivo,
        });
        // No pasa por registrarRechazo: el paso de arriba YA dejo la decision en la traza, con su
        // motivo y con exito false. Dos pasos para el mismo rechazo leerian como dos rechazos.
        return bloquear(resolucion.veredicto);
      };
      // CONTROLES DE VENTANA DEL FORMULARIO (FIX A): pantalla completa, expandir, minimizar,
      // restaurar y cerrar quedan fuera del alcance del agente salvo que el objetivo del usuario los
      // pida. Se evalua ANTES que todo lo demas -- el corte por objetivo sin verbo bloqueado incluido
      // -- a proposito: la evidencia de produccion es de tareas de llenado, pero una tarea de solo
      // lectura pierde la corrida igual de facil si el formulario se colapsa bajo sus pies.
      //
      // NO consume cupo ni cuenta como accion ejecutada (no pasa por `permitir` y no toca `estado`) y
      // NO termina la corrida: mismo trato que una verificacion incompleta. Queda como PASO de la
      // trayectoria con su motivo, para que en /actividad se vea por que no se ejecuto.
      const controlDeVentana = detectarControlDeVentana(accion, opciones.objetivoDelUsuario);
      if (controlDeVentana !== null) {
        registrarRechazo(`control de ventana fuera del alcance de la tarea: ${controlDeVentana}`);
        deps.logger.warn(
          'tarea web: el agente propuso un control de ventana del formulario; NO se ejecuta y la tarea sigue',
          { jobId: job.id, connectionId: sitio.id, control: controlDeVentana },
        );
        return { tipo: 'rechazar', mensaje: MENSAJE_CONTROL_DE_VENTANA };
      }
      // SIN INTENCION RECONOCIDA, LA GUARDIA NO DEJA PASAR SIN COMPARAR (D1). Aqui estaba el
      // `return permitir` incondicional: un objetivo cuya intencion no cae en el vocabulario cerrado
      // de ocho verbos dejaba pasar TODAS sus acciones sin comparar una sola contra la pagina. De 16
      // peticiones realistas medidas sobre siete familias de interfaz, 16 caian por aqui (desactiva,
      // archiva, revoca, da de baja, vacia la papelera, reinicia). Una intencion que el sistema no
      // reconoce jamas puede resultar en tratar la accion como reversible: hay guardia con criterio
      // generico, nunca ausencia de guardia.
      if (opciones.verboBloqueado === null) {
        const corte = await revisarSinIntencion();
        if (corte !== null) return corte;
        return permitir({ tipo: 'permitir' });
      }
      if (opciones.control?.signal?.aborted === true) {
        // NO cuenta como bloqueo de la guardia (`bloqueo()` sigue en null): no es una detencion de
        // la verificacion, es una cancelacion del dueno, y su cierre ya lo escribio quien cancelo.
        // SI queda en la traza: que el act se haya rechazado es parte de lo que paso en la corrida.
        registrarRechazo('cancelada desde la consola');
        return {
          tipo: 'bloquear',
          mensaje:
            'la tarea se termino desde la consola antes de ejecutar la accion pendiente; no se ejecuto nada',
        };
      }
      // La accion irreversible es la del OBJETIVO DEL USUARIO, no la que el agente describa
      // (CAMBIO 1): un act que nombra el verbo de otra familia es un paso intermedio y pasa igual
      // que abrir el redactor o escribir un campo. No consume cupo ni se bloquea.
      const etiqueta = detectarAccionQueExigeVerificacion(accion, opciones.verboBloqueado);
      if (etiqueta === null) return permitir({ tipo: 'permitir' });
      // Una accion irreversible CON EFECTO CONFIRMADO cierra la corrida para cualquier otra: es la
      // barrera que impide enviar dos veces. El cupo se consume al CONFIRMAR, no al ejecutar (FIX A).
      if (estado.irreversiblesConfirmadas > 0) {
        deps.logger.warn('tarea web: segunda accion irreversible en la misma corrida; se bloquea', {
          jobId: job.id,
          connectionId: sitio.id,
          etiqueta,
          irreversiblesEjecutadas: estado.irreversiblesEjecutadas,
          irreversiblesConfirmadas: estado.irreversiblesConfirmadas,
        });
        return bloquearRegistrando(detencionDirecta('otraAccion'));
      }
      // EJECUTADA SIN EFECTO CONFIRMADO (FIX A): se autoriza UN unico reintento en la corrida,
      // precedido de la re-verificacion determinista completa y de la doble seguridad de abajo.
      // Nunca un bucle: agotado el reintento, la corrida termina (FIX C).
      if (estado.irreversiblesEjecutadas > 0) {
        if (estado.reintentosSinEfecto >= 1) {
          bloqueosTrasReintento += 1;
          registrarRechazo('reintento irreversible ya agotado');
          deps.logger.warn(
            'tarea web: la guardia bloqueo un reintento irreversible ya agotado; la corrida terminara',
            {
              jobId: job.id,
              connectionId: sitio.id,
              etiqueta,
              bloqueosTrasReintento,
            },
          );
          if (bloqueosTrasReintento >= 2) {
            // Segundo bloqueo consecutivo de la misma etiqueta: corte duro con prefijo estable.
            mensajeDeBloqueo = MENSAJE_GUARDIA_AGOTADA;
            return { tipo: 'bloquear', causa: 'guardia_reintentos', mensaje: MENSAJE_GUARDIA_AGOTADA };
          }
          return { tipo: 'rechazar', mensaje: MENSAJE_BLOQUEO_TERMINAL };
        }
        try {
          const { veredicto, pagina, habriaDetenido } = await resolverVerificacion(
            deps,
            job,
            sitio,
            sesionExternaId,
            {
              politica: opciones.politica,
              verboBloqueado: opciones.verboBloqueado,
              textoParametros: opciones.textoParametros,
              // D2 tambien sobre la intencion RECONOCIDA: llegar aqui ya significa que esta accion es
              // la irreversible del objetivo, asi que no es de solo lectura por construccion.
              exigeComparacion: true,
            },
          );
          contarObservacion(habriaDetenido);
          // DOBLE SEGURIDAD (FIX A): si el formulario con los datos verificados YA NO esta, la
          // accion probablemente surtio efecto con retraso. NO se reintenta (seria el doble envio);
          // la corrida termina pidiendole al usuario que verifique el resultado en el sitio.
          const previa = paginaPrevia;
          if (previa !== null && pagina !== null && !formularioVerificadoPresente(parametros, previa, pagina)) {
            registrarRechazo('efecto probable: el formulario verificado ya no esta en la pagina');
            deps.logger.warn(
              'tarea web: el formulario verificado ya no esta; se trata como efecto probable y NO se reintenta',
              { jobId: job.id, connectionId: sitio.id, etiqueta },
            );
            mensajeDeBloqueo = MENSAJE_EFECTO_PROBABLE;
            return { tipo: 'bloquear', causa: 'sin_efecto', mensaje: MENSAJE_EFECTO_PROBABLE };
          }
          verificaciones.push({ accionesPrevias, paso: construirPasoDeVerificacion(veredicto) });
          if (veredicto.tipo === 'detener') {
            deps.logger.warn('tarea web: el reintento irreversible NO supero la re-verificacion', {
              jobId: job.id,
              connectionId: sitio.id,
              motivo: veredicto.detencion.motivo,
              etiqueta,
            });
            return bloquear(veredicto);
          }
          if (veredicto.tipo === 'incompleto') {
            ultimosFaltantes = veredicto.faltantes;
            return { tipo: 'incompleto', mensaje: mensajeDeIncompleto(veredicto) };
          }
          const corte = await revisarIdentidad();
          if (corte !== null) return corte;
          // El reintento NO suma una segunda ejecucion: es LA MISMA accion (confirmarla deja
          // ejecutadas == confirmadas y la tarea puede cerrarse como exitosa).
          estado.reintentosSinEfecto += 1;
          ejecucionPendienteEsReintento = true;
          paginaPrevia = pagina ?? { campos: [], texto: '' };
          deps.logger.info(
            'tarea web: reintento irreversible autorizado tras re-verificacion (unico de la corrida)',
            { jobId: job.id, connectionId: sitio.id, etiqueta },
          );
          return permitir({ tipo: 'permitir', confirmar: true });
        } catch (error) {
          deps.logger.error('tarea web: la re-verificacion del reintento fallo; la accion NO se ejecuta', {
            jobId: job.id,
            connectionId: sitio.id,
            err: describir(error),
          });
          return bloquearRegistrando(detencionDirecta('politicaNoDisponible'));
        }
      }
      try {
        const { veredicto, pagina, habriaDetenido } = await resolverVerificacion(
          deps,
          job,
          sitio,
          sesionExternaId,
          {
            politica: opciones.politica,
            verboBloqueado: opciones.verboBloqueado,
            textoParametros: opciones.textoParametros,
            // D2 sobre la intencion RECONOCIDA: es el hueco que la medicion encontro en borrar y en
            // publicar, que no exigen ningun parametro y resolvian 'ejecutar' sin comparar nada.
            exigeComparacion: true,
          },
        );
        contarObservacion(habriaDetenido);
        // El resultado queda como UN PASO de la trayectoria (valores comparados + veredicto), ya
        // censurado, en el punto exacto del flujo en que se comparo.
        verificaciones.push({ accionesPrevias, paso: construirPasoDeVerificacion(veredicto) });
        if (veredicto.tipo === 'detener') {
          deps.logger.warn(
            'tarea web DETENIDA antes de ejecutar la accion (verificacion determinista)',
            {
              jobId: job.id,
              connectionId: sitio.id,
              dominio: sitio.dominio,
              motivo: veredicto.detencion.motivo,
              etiqueta,
              parametrosComparados: veredicto.comparaciones.length,
              parametrosDeclarados: declarados,
            },
          );
          return bloquear(veredicto);
        }
        if (veredicto.tipo === 'incompleto') {
          // CAMBIO 1: la accion NO pasa, pero esto no es un fallo. La tarea sigue para que el agente
          // termine de llenar los campos y vuelva a intentarla con todo escrito.
          ultimosFaltantes = veredicto.faltantes;
          deps.logger.warn(
            'tarea web: la verificacion previa NO se supera todavia; faltan datos por escribir y la accion no pasa',
            {
              jobId: job.id,
              connectionId: sitio.id,
              dominio: sitio.dominio,
              etiqueta,
              parametrosComparados: veredicto.comparaciones.filter((c) => c.coincide).length,
              parametrosDeclarados: declarados,
              faltantes: veredicto.faltantes,
            },
          );
          return { tipo: 'incompleto', mensaje: mensajeDeIncompleto(veredicto) };
        }
        ultimosFaltantes = null;
        const corte = await revisarIdentidad();
        if (corte !== null) return corte;
        // La EJECUCION se cuenta aqui (desde este punto la accion va al navegador); el CUPO se
        // consume recien al CONFIRMAR el efecto (FIX A): irreversiblesConfirmadas es la barrera.
        estado.irreversiblesEjecutadas += 1;
        ejecucionPendienteEsReintento = false;
        // La foto que se acaba de comparar es la referencia contra la que se confirmara el efecto.
        paginaPrevia = pagina ?? { campos: [], texto: '' };
        deps.logger.info('tarea web: verificacion determinista superada; la accion pasa al navegador', {
          jobId: job.id,
          connectionId: sitio.id,
          dominio: sitio.dominio,
          parametrosComparados: veredicto.comparaciones.length,
          parametrosDeclarados: declarados,
          etiqueta,
        });
        return permitir({ tipo: 'permitir', confirmar: true });
      } catch (error) {
        // Falla CERRADA: si la comprobacion no se pudo completar, la accion no pasa.
        deps.logger.error('tarea web: la verificacion previa fallo; la accion NO se ejecuta', {
          jobId: job.id,
          connectionId: sitio.id,
          err: describir(error),
        });
        return bloquearRegistrando(detencionDirecta('politicaNoDisponible'));
      }
    },
    confirmar: async (): Promise<ResultadoDeConfirmacion> => {
      const antes = paginaPrevia;
      // Nada que confirmar: o no hubo accion verificada, o esta ya se confirmo. Confirmar dos veces
      // la misma accion no puede sumar dos al contador.
      if (antes === null || estado.irreversiblesConfirmadas >= estado.irreversiblesEjecutadas) {
        return { confirmada: true };
      }
      const esReintento = ejecucionPendienteEsReintento;
      for (let intento = 0; intento < INTENTOS_DE_CONFIRMACION; intento++) {
        if (intento > 0) await esperar(ESPERA_ENTRE_CONFIRMACIONES_MS);
        const despues = await leerEstadoDeLaPagina(deps, job, sesionExternaId);
        if (despues === null) continue;
        if (!accionSurtioEfecto({ parametros, antes, despues })) continue;
        estado.irreversiblesConfirmadas += 1;
        deps.logger.info('tarea web: la accion irreversible surtio efecto en la pagina (confirmada)', {
          jobId: job.id,
          connectionId: sitio.id,
          dominio: sitio.dominio,
          intentos: intento + 1,
          irreversiblesConfirmadas: estado.irreversiblesConfirmadas,
        });
        return { confirmada: true };
      }
      if (!esReintento) {
        // FIX A: la primera ejecucion sin efecto confirmado NO termina la corrida ni consume el
        // cupo: el agente recibe la instruccion de reintentar UNA vez, con act y localizador por
        // rol/aria-label (los clicks por coordenadas quedan fuera del toolset con guardia).
        deps.logger.warn(
          'tarea web: la accion se ejecuto sin efecto confirmado; se autoriza UN unico reintento verificado',
          { jobId: job.id, connectionId: sitio.id, dominio: sitio.dominio },
        );
        return { confirmada: false, terminal: false, mensaje: MENSAJE_REINTENTO_AUTORIZADO };
      }
      deps.logger.warn(
        'tarea web: el reintento tampoco confirmo efecto; la corrida termina y NO se vuelve a intentar',
        { jobId: job.id, connectionId: sitio.id, dominio: sitio.dominio },
      );
      return { confirmada: false, terminal: true, mensaje: MENSAJE_SIN_CONFIRMAR };
    },
  };
}

/**
 * Mensaje del cierre cuando la accion se ejecuto (incluido su unico reintento) y el sitio no mostro
 * que surtiera efecto (CAMBIO 4 + FIX A). Dice exactamente eso, sin afirmar ni negar que haya
 * ocurrido, y deja claro que el sistema no la va a repetir: repetir a ciegas una accion irreversible
 * es como se duplica un envio o un pago. Viaja con el prefijo ACCION_SIN_EFECTO_CONFIRMADO.
 */
const MENSAJE_SIN_CONFIRMAR =
  'la accion se intento pero no se pudo confirmar que surtiera efecto en el sitio (ni se cerro el ' +
  'formulario ni aparecio una confirmacion); la tarea termina aqui y NO se reintenta ' +
  'automaticamente, para no repetir una accion que quiza ya se ejecuto. Revisa el sitio antes de ' +
  'volver a pedirla';

/**
 * Mensaje que vuelve al agente tras la PRIMERA ejecucion sin efecto confirmado (FIX A): el sistema
 * autoriza UN unico reintento y fija el COMO (act con localizador por rol/aria-label, jamas
 * coordenadas: en produccion el click por coordenadas golpeo la cabecera del compose, no Enviar).
 */
const MENSAJE_REINTENTO_AUTORIZADO =
  'la accion se ejecuto pero el sitio NO muestra que haya surtido efecto (el formulario sigue igual). ' +
  'El sistema autoriza UN unico reintento: usa la herramienta act y localiza el boton objetivo por su ' +
  'rol y su aria-label (por ejemplo, el boton cuyo aria-label empieza con Enviar o Send). No uses ' +
  'coordenadas ni atajos de teclado, y no intentes ninguna otra ruta. Si el reintento tampoco surte ' +
  'efecto, la tarea terminara sola: no insistas.';

/**
 * Mensaje TERMINAL de la guardia cuando bloquea un intento irreversible con el reintento ya agotado
 * (FIX C): avisa que la corrida va a terminar. Si el agente insiste una vez mas, el worker corta con
 * el prefijo GUARDIA_BLOQUEO_REINTENTOS_IRREVERSIBLES.
 */
const MENSAJE_BLOQUEO_TERMINAL =
  'el sistema bloqueo esta accion: el unico reintento autorizado ya se uso y no se permite ninguno ' +
  'mas. La corrida va a terminar; NO intentes la accion de nuevo por ninguna via. Termina ahora y ' +
  'reporta lo que paso.';

/**
 * Mensaje que vuelve al agente cuando propone un CONTROL DE VENTANA del formulario (FIX A). Dice las
 * dos cosas que evitan que insista: que esos controles no cambian el contenido del formulario (asi
 * que accionarlos no acerca la tarea) y que la tarea sigue (no es un corte, no hay nada que reparar).
 */
const MENSAJE_CONTROL_DE_VENTANA =
  'el sistema no ejecuto esa accion: los controles de ventana del formulario (pantalla completa, ' +
  'expandir, minimizar, restaurar, cerrar) no cambian su contenido y no forman parte de esta tarea. ' +
  'La tarea sigue: continua con el objetivo sobre los campos y botones del formulario tal como esta.';

/** Mensaje del corte duro tras el segundo bloqueo consecutivo (FIX C): jamas un bucle. */
const MENSAJE_GUARDIA_AGOTADA =
  'la guardia bloqueo dos veces seguidas el reintento de la accion irreversible (el unico reintento ' +
  'autorizado ya se habia agotado) y la corrida se corto para no ciclar. Es posible que haya quedado ' +
  'un borrador o un estado a medias en el sitio: revisalo antes de volver a pedir la tarea';

/**
 * Mensaje del cierre por EFECTO PROBABLE (FIX A, doble seguridad): el formulario con los datos
 * verificados ya no esta, asi que la accion probablemente se ejecuto con retraso. NO se reintenta.
 */
const MENSAJE_EFECTO_PROBABLE =
  'la accion se ejecuto y, aunque el sitio no mostro una confirmacion inmediata, el formulario con ' +
  'los datos verificados ya no esta en la pagina: lo mas probable es que la accion SI se haya ' +
  'realizado. No se reintenta para no duplicarla. Verifica el resultado en el sitio antes de volver ' +
  'a pedir la tarea';

/**
 * CAMINO POR RECETA (CAMBIO 5): busca la receta ACTIVA de este owner, dominio y firma de objetivo.
 *
 * SE PRUEBAN DOS FIRMAS, las dos EXACTAS, las dos deterministas y ninguna cuesta un token: la del
 * objetivo que redacto el modelo conversacional y la del TEXTO LITERAL del usuario. Son textos
 * distintos (el modelo parafrasea) y la receta pudo quedar guardada bajo cualquiera de los dos: las
 * aprendidas solas firman el objetivo del modelo, las ensenadas desde una grabacion firman la
 * descripcion que escribio la persona. Probar las dos no relaja nada -- sigue siendo igualdad
 * exacta de firma canonica, y la receta encontrada pasa por el mismo `recetaAplicable`.
 *
 * Devuelve null (y la tarea corre con el motor, como siempre) cuando:
 *  - el camino determinista no esta cableado entero;
 *  - no hay receta para esa firma, o sus pasos no validan (una receta manipulada se ignora);
 *  - el objetivo pide una accion irreversible y la receta NO trae su paso de verificacion (D7: sin
 *    ese paso, ejecutarla se saltaria la comparacion previa; mejor no usarla);
 *  - la lectura falla (nunca se ejecuta a ciegas por un fallo de base).
 */
async function buscarRecetaAplicable(
  deps: TareaWebDeps,
  job: Job,
  sitio: SitioConectado,
  objetivo: string,
  textoParametros: string,
  verboBloqueado: string | null,
  dominios: readonly string[],
): Promise<RecetaWeb | null> {
  if (!deps.recetas || !deps.determinista || !deps.escalador) return null;
  // La firma incorpora el CONJUNTO DE DOMINIOS de la tarea: lo aprendido cruzando dos sitios no
  // puede confundirse con lo aprendido en uno solo, aunque el objetivo se lea igual.
  const firmas = [firmaDeObjetivo(objetivo, dominios)];
  const firmaDelUsuario = firmaDeObjetivo(textoParametros, dominios);
  if (!firmas.includes(firmaDelUsuario)) firmas.push(firmaDelUsuario);

  let receta: RecetaWeb | null = null;
  try {
    for (const firma of firmas) {
      receta = await deps.recetas.buscarActiva(job.ownerId, sitio.dominio, firma);
      if (receta !== null) break;
    }
  } catch (error) {
    deps.logger.warn('tarea web: no se pudo consultar lo aprendido del sitio; se ejecuta con el motor', {
      jobId: job.id,
      err: describir(error),
    });
    return null;
  }
  if (receta === null) return null;
  if (!recetaAplicable(receta.pasos, verboBloqueado)) {
    deps.logger.warn(
      'tarea web: lo aprendido no incluye el punto de verificacion que este objetivo exige; se ejecuta con el motor',
      { jobId: job.id, recetaId: receta.id },
    );
    return null;
  }
  return receta;
}

/** Una tarea ya ensenada que corresponde al pedido, con los datos con los que se ejecutaria. */
interface TareaEnsenadaElegida {
  receta: RecetaWeb;
  valores: ValoresDeParametros;
  parametros: ParametrosDeclarados;
}

/**
 * ELEGIR ENTRE LAS TAREAS YA ENSENADAS (CAMBIO 3). Corre SOLO cuando la firma exacta del objetivo no
 * encontro nada, y es UNA sola llamada al modelo: se le muestran las tareas ensenadas de los sitios
 * que ESTA tarea autorizo (que hacen y que datos necesitan) y contesta cual corresponde y con que
 * datos. No hay bucle, no hay herramientas y no navega nada.
 *
 * POR QUE EXISTE: una tarea ensenada como "enviar un correo" no se encontraba nunca cuando el usuario
 * pedia "manda un correo a X con el asunto Y y dile Z", porque la firma que se calcula de ese pedido
 * es otra. Pedir lo mismo con otras palabras es lo normal.
 *
 * TODO LO QUE EL MODELO DECIDE SE VUELVE A COMPROBAR, y ninguna comprobacion depende de el:
 *  - la lista ofrecida ya excluye toda tarea cuya accion irreversible no sea EXACTAMENTE la que pidio
 *    el usuario (deteccion determinista sobre los dos textos, `ofrecerTareasEnsenadas`);
 *  - la respuesta tiene que nombrar una tarea de la lista, con TODOS sus datos y ninguno de mas;
 *  - cada dato tiene que estar escrito en el texto del que salen los parametros de esta corrida -- el
 *    literal del usuario cuando llego (el ancla; sin ella el modelo podria proponer un destinatario
 *    que nadie pidio);
 *  - los datos se traducen a la forma de la verificacion determinista y si alguno no se puede
 *    interpretar, no hay eleccion;
 *  - la receta elegida pasa por el MISMO `recetaAplicable` que la del camino rapido: si el objetivo
 *    pide una accion irreversible y la receta no trae su punto de verificacion, no se usa.
 * Cualquier fallo -- del modelo, de la base, del formato -- devuelve null y la tarea corre con el
 * motor, que es el comportamiento de siempre.
 */
async function elegirTareaEnsenada(
  deps: TareaWebDeps,
  job: Job,
  textoParametros: string,
  verboBloqueado: string | null,
  dominios: readonly string[],
  apiKey: string,
  control?: ControlDeTareaWeb,
): Promise<TareaEnsenadaElegida | null> {
  const recetas = deps.recetas;
  const elector = deps.elector;
  if (!recetas || !elector || !deps.determinista || !deps.escalador) return null;

  let candidatas: RecetaWeb[];
  try {
    candidatas = await recetas.listarActivas(job.ownerId, dominios);
  } catch (error) {
    deps.logger.warn('tarea web: no se pudieron leer las tareas ya ensenadas; se ejecuta con el motor', {
      jobId: job.id,
      err: describir(error),
    });
    return null;
  }
  const ofrecidas = ofrecerTareasEnsenadas(candidatas, verboBloqueado);
  if (ofrecidas.length === 0) return null;

  const respuesta = await elector.consultar({
    peticion: construirPeticionDeEleccion({ texto: textoParametros, tareas: ofrecidas }),
    // La key es la del OWNER, la MISMA que usa el motor y que sale de su boveda. No se guarda.
    apiKey,
    signal: control?.signal,
  });
  const eleccion = parsearEleccion(respuesta, ofrecidas, textoParametros);
  if (eleccion === null) {
    deps.logger.info('tarea web: ninguna de las tareas ya ensenadas corresponde a lo pedido', {
      jobId: job.id,
      ofrecidas: ofrecidas.length,
    });
    return null;
  }
  const receta = candidatas.find((candidata) => candidata.id === eleccion.id);
  if (receta === undefined) return null;
  if (!recetaAplicable(receta.pasos, verboBloqueado)) {
    deps.logger.warn(
      'tarea web: la tarea ensenada elegida no incluye el punto de verificacion que este objetivo exige; se ejecuta con el motor',
      { jobId: job.id, recetaId: receta.id },
    );
    return null;
  }
  const parametros = parametrosDeclaradosDesdeValores(eleccion.valores);
  if (parametros === null) {
    deps.logger.warn(
      'tarea web: los datos de la tarea ensenada elegida no se pueden comparar; se ejecuta con el motor',
      { jobId: job.id, recetaId: receta.id },
    );
    return null;
  }
  deps.logger.info('tarea web: lo pedido corresponde a una tarea que el usuario ya enseno', {
    jobId: job.id,
    recetaId: receta.id,
    dominio: receta.dominio,
    ofrecidas: ofrecidas.length,
    // Solo los NOMBRES de los datos: cuales se resolvieron explica la decision; los valores no.
    datos: nombresDeParametrosDeclarados(parametros),
  });
  return { receta, valores: eleccion.valores, parametros };
}

/** Lo que el camino por receta le devuelve a `procesarTareaWeb`. */
type DesenlaceDelCaminoPorReceta =
  /** La receta completo la tarea: el job se cierra aqui. */
  | { tipo: 'completada' }
  /**
   * La receta no sirve (o se agoto): se sigue con el motor en la MISMA sesion. `paginaTocada` dice
   * si la receta llego a actuar sobre la pagina antes de rendirse; en ese caso el llamador la
   * DEVUELVE a la URL de inicio antes de arrancar el motor (el motor jamas recibe una pagina a
   * medio camino) o corta la tarea si no lo consigue.
   */
  | { tipo: 'seguir_con_motor'; paginaTocada: boolean };

/** Tope de espera de UN intento del reset previo al motor: corto a proposito (ver renavegarAInicio). */
const TIMEOUT_DEL_RESET_MS = 8_000;

/** Intentos del reset previo al motor: el primero mas UN reintento. Dos timeouts ya son respuesta. */
const INTENTOS_DEL_RESET = 2;

/** Espera acotada de una promesa. La original sigue su curso sin dejar rechazos sin manejar. */
async function conTiempoLimite<T>(promesa: Promise<T>, ms: number, que: string): Promise<T> {
  promesa.catch(() => undefined);
  let temporizador: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promesa,
      new Promise<never>((_, reject) => {
        temporizador = setTimeout(() => reject(new Error(`timeout de ${ms}ms en ${que}`)), ms);
      }),
    ]);
  } finally {
    if (temporizador !== undefined) clearTimeout(temporizador);
  }
}

/**
 * DEVUELVE la pagina a la URL de inicio de la tarea despues de que la ejecucion por receta la tocara
 * y se rindiera (CAMBIO 6). Entregarle al motor una pagina a medio camino es peor que empezar
 * limpio: el motor razona sobre un estado que no pidio.
 *
 * TOLERANTE (FIX fallback, caso real de produccion del 28 jul 2026): este reset SE OMITE si no sale.
 * Antes cortaba la tarea con un fallo PERMANENTE, y en produccion la receta cedio correctamente al
 * motor libre pero el job murio igual con "timeout esperando la respuesta CDP de Page.navigate": la
 * red de seguridad se mataba con su propio paso de preparacion. Ahora se intenta con un tope corto y
 * un reintento y, si aun asi no vuelve, se CONTINUA con el motor desde donde este la pagina (el motor
 * percibe el estado real antes de actuar, y su guardia sigue verificando toda accion irreversible).
 * Una navegacion que no responde JAMAS produce un fallo permanente del job teniendo el motor
 * disponible. Devuelve true si la pagina volvio al inicio, false si el reset se omitio.
 */
async function renavegarAInicio(
  deps: TareaWebDeps,
  job: Job,
  sitio: SitioConectado,
  sesionExternaId: string,
  url: string,
): Promise<boolean> {
  const determinista = deps.determinista;
  let motivo = 'el worker no tiene navegador determinista con el que renavegar';
  for (let intento = 1; determinista && intento <= INTENTOS_DEL_RESET; intento++) {
    try {
      const resultado = await conTiempoLimite(
        determinista.ejecutarPasoDeterminista(sesionExternaId, {
          accion: 'navegar',
          estrategias: [],
          texto: null,
          teclas: null,
          url,
          esperaMs: null,
        }),
        TIMEOUT_DEL_RESET_MS,
        'la renavegacion al inicio',
      );
      if (resultado.estado === 'ok') {
        deps.logger.info('tarea web: pagina devuelta a su estado inicial antes de arrancar el motor', {
          jobId: job.id,
          connectionId: sitio.id,
          dominio: sitio.dominio,
          intento,
        });
        return true;
      }
      motivo = `la renavegacion termino ${resultado.estado}`;
    } catch (error) {
      motivo = describir(error);
    }
  }
  deps.logger.warn(
    'tarea web: el reset previo al motor se omitio; la tarea sigue con el motor desde el estado actual de la pagina',
    { jobId: job.id, connectionId: sitio.id, dominio: sitio.dominio, motivo },
  );
  return false;
}

/**
 * DESCARTE GENERICO del estado a medio llenar que un intento de plantilla dejo en la pagina: una
 * pulsacion de Escape sobre el foco, que cierra el dialogo o el compose abierto en la mayoria de los
 * sitios SIN un solo selector especifico. Best-effort a proposito: si no sale, el goto obligatorio
 * que viene despues sigue siendo la limpieza minima y esto solo queda en el log.
 */
async function descartarEstadoAMedioLlenarBestEffort(
  deps: TareaWebDeps,
  job: Job,
  abierto: SitioAbierto,
): Promise<void> {
  const determinista = deps.determinista;
  if (!determinista) return;
  try {
    await conTiempoLimite(
      determinista.ejecutarPasoDeterminista(abierto.sesionExternaId, {
        accion: 'teclas',
        estrategias: [],
        texto: null,
        teclas: 'Escape',
        sobreElFoco: true,
        url: null,
        esperaMs: null,
      }),
      TIMEOUT_DEL_RESET_MS,
      'el descarte del estado a medio llenar',
    );
  } catch (error) {
    deps.logger.warn('tarea web: no se pudo descartar el estado a medio llenar (se sigue con el goto)', {
      jobId: job.id,
      connectionId: abierto.sitio.id,
      dominio: abierto.sitio.dominio,
      err: describir(error),
    });
  }
}

/**
 * RESET OBLIGATORIO previo al motor libre tras un procedimiento aprendido que TOCO el DOM y se
 * rindio: plantilla ajena (FIX B, caso real de produccion del 3 ago 2026: el motor arranco sobre el
 * compose a medio llenar de la plantilla abandonada, abrio OTRO compose y la corrida termino
 * atribuyendole al usuario un fallo de sesion) Y TAMBIEN receta propia (D2 de resiliencia: toda
 * caida al motor libre arranca desde un estado inicial conocido; hasta este cambio el camino por
 * receta solo renavegaba de forma tolerante, sin descarte generico y sin reapertura de una sesion
 * degradada). Tres pasos por sitio abierto, en este orden:
 *
 *  1. el DESCARTE GENERICO del estado a medio llenar (Escape sobre el foco, best-effort);
 *  2. la RENAVEGACION al inicio de siempre (renavegarAInicio);
 *  3. si la sesion NO respondio al reset -- el caso `resumedOk:false` de Browserbase: el target CDP
 *     queda a medio inicializar y todo comando cuelga hasta su timeout -- se REABRE la sesion del
 *     sitio en vez de continuar sobre la degradada. `reabrir` pasa por la misma puerta que `abrir`:
 *     mismo contexto externo, mismo proxy, el pais pineado verificado y el contexto reinyectado.
 *
 * Devuelve el SitioAbierto VIGENTE del sitio activo (el mismo, o el reabierto): es lo que el motor
 * libre tiene que usar de aqui en adelante.
 */
async function resetObligatorioPrevioAlMotor(
  deps: TareaWebDeps,
  job: Job,
  gestor: GestorDeSitios,
  activo: SitioAbierto,
): Promise<SitioAbierto> {
  let vigente = activo;
  for (const abierto of gestor.abiertos()) {
    await descartarEstadoAMedioLlenarBestEffort(deps, job, abierto);
    const volvio = await renavegarAInicio(
      deps,
      job,
      abierto.sitio,
      abierto.sesionExternaId,
      abierto.urlInicial,
    );
    if (volvio) continue;
    deps.logger.warn(
      'tarea web: la sesion no respondio al reset; se abre una sesion nueva con el mismo pais pineado',
      { jobId: job.id, connectionId: abierto.sitio.id, dominio: abierto.sitio.dominio },
    );
    const reabierto = await gestor.reabrir(abierto.sitio);
    if (reabierto.sitio.id === vigente.sitio.id) vigente = reabierto;
  }
  return vigente;
}

/** Como termino la sonda de reconocimiento previa sobre un procedimiento aprendido. */
type VeredictoDeSonda =
  /** Todas las clases observables del procedimiento existen en la pagina: se ejecuta como hoy. */
  | { tipo: 'coincide'; ms: number }
  /** El procedimiento no tiene ninguna clase observable en la pagina inicial: no hay que sondear. */
  | { tipo: 'sin_clases_observables' }
  /** La sonda no se pudo evaluar (sin puerto, lectura rota o excepcion): se ejecuta como hoy. */
  | { tipo: 'no_evaluable' }
  /** Falta alguna clase observable en DOS lecturas: NO se ejecuta ningun paso. */
  | { tipo: 'desajuste'; faltantes: string[]; ms: number };

/**
 * SONDA DE RECONOCIMIENTO PREVIA (pre-flight, sonda-interfaz.ts): antes de ejecutar un procedimiento
 * aprendido, comprueba SIN MODELO Y SIN ACCIONES que las clases de elemento observables del
 * procedimiento existan en la pagina de partida, con la misma derivacion canonica de clase que la
 * barrera de identidad. Es una compuerta ADICIONAL: solo puede impedir que un procedimiento corra
 * (y mandarlo al motor libre con la pagina limpia), jamas autorizar nada nuevo.
 *
 * ANTI FALSO POSITIVO: dos lecturas separadas por un intervalo corto antes de declarar desajuste
 * (una pagina hidratando puede pintar sus controles despues del load), presencia aceptada con el
 * elemento oculto y TODO en try/catch propio: cualquier fallo deja la sonda en 'no_evaluable' y la
 * ejecucion corre exactamente como hoy. Declarar desajuste por una pagina a medio cargar seria peor
 * que no tener sonda.
 */
async function sondearInterfazBestEffort(
  deps: TareaWebDeps,
  job: Job,
  sesionExternaId: string,
  dominio: string,
  pasos: readonly PasoDeReceta[],
): Promise<VeredictoDeSonda> {
  const leer = deps.determinista?.leerCandidatosDeSonda;
  if (deps.determinista === undefined || leer === undefined) return { tipo: 'no_evaluable' };
  const descriptores = descriptoresDeSonda(clasesObservablesEnInicio(pasos, dominio));
  if (descriptores.length === 0) return { tipo: 'sin_clases_observables' };
  const esperar = deps.esperar ?? esperarMs;
  const inicio = Date.now();
  try {
    let faltantes: string[] = [];
    for (let lectura = 1; lectura <= LECTURAS_DE_SONDA; lectura++) {
      if (lectura > 1) await esperar(ESPERA_ENTRE_LECTURAS_DE_SONDA_MS);
      const candidatos = await leer.call(deps.determinista, sesionExternaId, descriptores);
      // Una lectura rota no es evidencia de nada: jamas se declara desajuste sobre ella.
      if (candidatos === null) return { tipo: 'no_evaluable' };
      faltantes = clasesFaltantes(descriptores, candidatos);
      if (faltantes.length === 0) return { tipo: 'coincide', ms: Date.now() - inicio };
    }
    deps.logger.warn('tarea web: desajuste_de_interfaz detectado en pre-flight; no se ejecuta ningun paso', {
      jobId: job.id,
      dominio,
      clasesSondeadas: descriptores.length,
      clasesFaltantes: faltantes.length,
      ms: Date.now() - inicio,
    });
    return { tipo: 'desajuste', faltantes, ms: Date.now() - inicio };
  } catch (error) {
    deps.logger.warn('tarea web: la sonda de interfaz fallo; se ejecuta como siempre (no evaluable)', {
      jobId: job.id,
      dominio,
      err: describir(error),
    });
    return { tipo: 'no_evaluable' };
  }
}

/**
 * EJECUTA la tarea con la receta (CAMBIO 4). Registra su propia trayectoria, aplica la verificacion
 * determinista donde la receta la aprendio (D7), repara las estrategias que hayan cambiado (D5) y
 * jubila la receta si el sitio cambio demasiado (D6).
 *
 * Una DETENCION de la verificacion se propaga como fallo permanente, igual que en el camino con
 * motor: la tarea termina sin ejecutar y el usuario ve que se pidio y que se encontro.
 */
async function ejecutarPorReceta(
  deps: TareaWebDeps,
  job: Job,
  sitio: SitioConectado,
  objetivo: string,
  sesionExternaId: string,
  receta: RecetaWeb,
  opciones: {
    politica: PoliticaVigente | null;
    verboBloqueado: string | null;
    /** Texto del que salen los parametros: el LITERAL del usuario si llego (CAMBIO 3). */
    textoParametros: string;
    contexto: string;
    apiKey: string;
    control?: ControlDeTareaWeb | undefined;
    /** Gestor de sesiones por sitio: es lo unico con lo que una receta multisitio puede cambiar. */
    gestor?: GestorDeSitios | undefined;
    /**
     * DATOS YA RESUELTOS de la corrida (CAMBIO 3): los que dio la eleccion entre tareas ensenadas,
     * anclados al texto literal del usuario. Se usan PARA LOS DOS lados a la vez -- lo que la receta
     * teclea y lo que la verificacion determinista compara contra la pagina -- justamente para que no
     * puedan divergir: verificar contra una cosa y escribir otra seria la puerta trasera.
     * Ausente = el extractor determinista sobre el texto del usuario, como siempre.
     */
    datos?: { valores: ValoresDeParametros; parametros: ParametrosDeclarados } | undefined;
    /** ATLAS DE SITIOS (V040): pistas de localizacion del dominio. Ausente = como antes de V040. */
    atlas?: LectorDelAtlas | null | undefined;
    /** TELEMETRIA de la guardia con criterio generico (D3), compartida por toda la corrida. */
    observacion?: ObservacionDeLaGuardia | undefined;
  },
): Promise<DesenlaceDelCaminoPorReceta> {
  const recetas = deps.recetas;
  const determinista = deps.determinista;
  const escalador = deps.escalador;
  if (!recetas || !determinista || !escalador) {
    return { tipo: 'seguir_con_motor', paginaTocada: false };
  }

  // Los VALORES de esta corrida se resuelven UNA vez: son los que la receta teclea y, por eso mismo,
  // los que ninguna estrategia puede llevar dentro al llegar al atlas (paranoia de valores, V040).
  const valores =
    opciones.datos?.valores ??
    valoresDeParametros(extraerParametrosDeclarados(opciones.textoParametros));

  const iniciadaEn = new Date();
  const resultado = await ejecutarReceta(receta.pasos, valores, {
    navegador: determinista,
    escalador,
    // El paso `verificar` de la receta resuelve con la MISMA funcion que el camino con motor. Una
    // verificacion INCOMPLETA aqui SI detiene: la receta repite un flujo cerrado, no tiene con que
    // "seguir llenando campos"; si al llegar a este punto faltan datos, lo aprendido ya no sirve.
    //
    // NO RECIBE EL ATLAS, y es deliberado: lo que se compara contra la pagina antes de una accion
    // irreversible sale del objetivo de ESTA corrida y del DOM de ese momento, jamas de lo que la
    // plataforma aprendio de otros. La verificacion es ignorante del atlas.
    verificar: async (activo): Promise<VeredictoDeVerificacion> => {
      // La verificacion corre contra el DOM del sitio en el que la receta esta AHORA, con el
      // dominio de ESE sitio (la politica del usuario se aplica por dominio).
      const sitioActivo = opciones.gestor?.porDominio(activo.dominio) ?? sitio;
      const { veredicto, habriaDetenido } = await resolverVerificacion(
        deps,
        job,
        sitioActivo,
        activo.sesionExternaId,
        {
          politica: opciones.politica,
          verboBloqueado: opciones.verboBloqueado,
          textoParametros: opciones.textoParametros,
          // D2: este paso precede a la accion irreversible que la receta aprendio (D7), asi que no
          // es de solo lectura y cero comparaciones no puede resolver 'ejecutar'.
          exigeComparacion: true,
          // Los datos que la eleccion resolvio son los MISMOS que se comparan contra la pagina.
          parametros: opciones.datos?.parametros ?? null,
        },
      );
      if (habriaDetenido && opciones.observacion !== undefined) {
        opciones.observacion.habriaDetenido += 1;
      }
      if (veredicto.tipo === 'ejecutar') return { tipo: 'ejecutar' };
      return {
        tipo: 'detener',
        mensaje:
          veredicto.tipo === 'incompleto'
            ? mensajeDeDetencion(detencionPorDatosIncompletos(veredicto.faltantes))
            : mensajeDeDetencion(veredicto),
      };
    },
    sesionExternaId,
    apiKey: opciones.apiKey,
    dominio: sitio.dominio,
    // CAMBIO DE SITIO DE UNA RECETA: solo hacia un sitio que ESTE job autorizo. Sin gestor (o con
    // un dominio que no esta en la lista) devuelve null y la receta se abandona: una receta
    // manipulada no puede llevar la sesion del usuario a un sitio que la tarea no autorizo.
    cambiarASitio: async (dominio: string): Promise<string | null> => {
      const destino = opciones.gestor?.porDominio(dominio);
      if (destino === undefined || opciones.gestor === undefined) return null;
      try {
        return (await opciones.gestor.abrir(destino)).sesionExternaId;
      } catch (error) {
        deps.logger.warn('tarea web: no se pudo abrir el otro sitio de lo aprendido; se sigue con el motor', {
          jobId: job.id,
          dominio,
          err: describir(error),
        });
        return null;
      }
    },
    // ATLAS DE SITIOS (V040): pistas de localizacion para los pasos cuyas estrategias propias fallen.
    // Solo eso: encontrar un elemento. El paso `verificar` de arriba no lo recibe ni lo conoce.
    ...(opciones.atlas ? { atlas: opciones.atlas.pistas(sitio.dominio) } : {}),
    // BARRERA DE IDENTIDAD DEL ELEMENTO (TAREA_WEB_BARRERA_IDENTIDAD): en 'observacion' (default del
    // env) solo registra su veredicto en la trayectoria y el desenlace de la receta es identico al de
    // hoy. Recibe el verbo del OBJETIVO DEL USUARIO -- el unico dato que no redacta ningun modelo --
    // y las clases que el atlas tiene corroboradas para el dominio, que ya estan en memoria.
    barreraIdentidad: {
      modo: deps.barreraIdentidad ?? 'apagada',
      verboDelObjetivo: opciones.verboBloqueado,
      clasesCorroboradas: (dominio: string): ReadonlySet<string> =>
        opciones.atlas?.clasesCorroboradas(dominio) ?? new Set<string>(),
    },
    signal: opciones.control?.signal,
  });

  const completada = resultado.desenlace.tipo === 'completada';

  // AUTO REPARACION (D5) y JUBILACION (D6): las dos son best-effort; su fallo no cambia el desenlace.
  // Una receta que se rindio DESPUES de tocar la pagina se jubila aunque no haya llegado al umbral
  // de escaladas de D6: dejarla activa condenaria a la siguiente corrida a estrellarse igual.
  const seRindioAMedias =
    resultado.desenlace.tipo === 'abandonada' &&
    resultado.pasosEjecutados > 0 &&
    opciones.control?.signal?.aborted !== true;
  await mantenerRecetaBestEffort(deps, job, receta, resultado.pasosReparados, {
    tipo: resultado.desenlace.tipo,
    obsoleta:
      (resultado.desenlace.tipo === 'abandonada' && resultado.desenlace.obsoleta) || seRindioAMedias,
  });

  // PROMOCION DE ESTRATEGIAS (V038): solo tras un desenlace EXITOSO se registran las ganadoras y,
  // si la regla aplica, se reordena el paso. Corre DESPUES del mantenimiento de arriba (la lectura
  // fresca ve los pasos ya reparados y la version ya subida) y ANTES de persistir la trayectoria,
  // para que la etiqueta RECETA:PROMOVIDA quede en el detalle de pasos de ESTA ejecucion. Best-effort
  // total: cualquier fallo se loguea adentro y jamas cambia el desenlace del job.
  const promociones = completada
    ? await promoverEstrategiasBestEffort(deps, job, receta, resultado.ganadoras)
    : [];

  // ATLAS DE SITIOS (V040): la corrida cerro con exito, asi que las estrategias que GANARON en cada
  // paso son evidencia de como esta hecho el sitio, no de que hizo este usuario. Se agregan anonimas
  // al aprendizaje comun (dominio, clase de elemento, estrategias y un hash de origen no reversible)
  // con la MISMA fuente que la auto reparacion: `resultado.ganadoras`, que solo trae los pasos que
  // resolvieron su elemento sin motor. Best-effort total: el desenlace ya esta decidido.
  //
  // SOLO SI LAS ESTRATEGIAS DE LA RECETA SON LECTURA DEL DOM, y esta es la puerta que cierra el
  // ENVENENAMIENTO DEL POZO. `entradasDeCorridaPorReceta` deriva la clase de las estrategias que la
  // receta lleva guardadas, asi que una receta cuyas estrategias las escribio el MODELO (rol
  // `textbox`, nombre `field`) escribiria en una tabla GLOBAL una clase que ningun DOM tiene; con dos
  // cuentas llegaria al umbral de corroboracion y autorizaria a publicar una plantilla con ese nombre
  // inventado dentro.
  //
  // EL CRITERIO ES `creadaDesdeTrayectoria`, que es el mas simple que lo GARANTIZA y no necesita ni
  // campo nuevo ni migracion: el unico productor de estrategias derivadas de una descripcion es
  // `derivarEstrategiasDePaso` (promover-trayectoria.ts), y su unico llamador es la conversion de una
  // trayectoria PERSISTIDA, que promueve siempre con `creadaDesdeTrayectoria` no nulo. Los otros dos
  // productores de recetas (la promocion de una corrida en vivo y el grabador) leen el DOM y promueven
  // con null. Una receta de origen textual no aporta nada al atlas; ejecutarse le sigue saliendo
  // igual de bien.
  if (completada) {
    if (receta.creadaDesdeTrayectoria !== null) {
      deps.logger.info('tarea web: la receta se guardo desde el registro de una corrida y no aporta al aprendizaje comun', {
        jobId: job.id,
        connectionId: sitio.id,
        recetaId: receta.id,
      });
    } else {
      await registrarEnAtlasBestEffort(
        deps,
        job,
        entradasDeCorridaPorReceta({
          dominio: sitio.dominio,
          pasos: receta.pasos,
          ganadoras: resultado.ganadoras,
          valores: valoresTecleadosDeLaCorrida(valores),
        }),
      );
    }
  }

  await guardarTrayectoriaBestEffort(
    deps,
    job,
    sitio,
    objetivo,
    completada ? 'exitosa' : 'fallida',
    iniciadaEn,
    { acciones: [], tokensIn: resultado.tokensIn, tokensOut: resultado.tokensOut },
    promociones.length === 0 ? resultado.pasos : conEtiquetasDePromocion(resultado.pasos, promociones),
  );

  if (resultado.desenlace.tipo === 'detenida') {
    deps.logger.warn('tarea web DETENIDA antes de ejecutar la accion (ejecucion por receta)', {
      jobId: job.id,
      connectionId: sitio.id,
      recetaId: receta.id,
    });
    throw new PermanentExecutionError(resultado.desenlace.mensaje);
  }

  if (!completada) {
    deps.logger.info('tarea web: lo aprendido ya no describe el sitio; se sigue con el motor', {
      jobId: job.id,
      connectionId: sitio.id,
      recetaId: receta.id,
      escalados: resultado.escalados,
      pasosEjecutados: resultado.pasosEjecutados,
    });
    return { tipo: 'seguir_con_motor', paginaTocada: resultado.pasosEjecutados > 0 };
  }

  await refrescarContextoBestEffort(deps, sitio, job.ownerId, sesionExternaId, opciones.contexto);
  // El resultado del job declara POR DONDE corrio y cuanto costo: es lo que la consola convierte en
  // "Tarea aprendida" y lo que permite medir el ahorro contra una corrida con modelo.
  await deps.guardarResultado(job.id, {
    estado: 'ok',
    resumen: 'tarea completada con lo aprendido de una ejecucion anterior',
    via: 'receta',
    reparada: resultado.escalados > 0,
    tokensIn: resultado.tokensIn,
    tokensOut: resultado.tokensOut,
    sesionExternaId,
  });
  deps.logger.info('tarea web completada con lo aprendido, sin llamadas al modelo por paso', {
    jobId: job.id,
    connectionId: sitio.id,
    dominio: sitio.dominio,
    recetaId: receta.id,
    pasos: receta.pasos.length,
    escalados: resultado.escalados,
  });
  return { tipo: 'completada' };
}

/**
 * REGISTRA que estrategia gano en cada paso de una corrida EXITOSA por receta y, si la regla de
 * promocion aplica (promocion-estrategias.ts: la primaria no gano en las ultimas 2 exitosas y gano
 * SIEMPRE el mismo fallback), reordena ese paso poniendo la ganadora de primaria. Devuelve las
 * promociones aplicadas, para etiquetar la traza de ESTA ejecucion (RECETA:PROMOVIDA).
 *
 * Best-effort SIEMPRE: cualquier fallo (lectura, carrera de versiones, escritura) se loguea y
 * devuelve lista vacia; el desenlace del job ya esta decidido y esto no lo toca. La escritura es UN
 * update condicionado por la version leida (candado optimista del repositorio): si dos corridas de
 * la misma receta terminan a la vez, una gana y la otra solo pierde su registro de esta corrida.
 */
async function promoverEstrategiasBestEffort(
  deps: TareaWebDeps,
  job: Job,
  receta: RecetaWeb,
  ganadoras: Array<{ paso: number; indice: number }>,
): Promise<PromocionDeEstrategia[]> {
  const recetas = deps.recetas;
  if (!recetas?.leerAutoReparacion || !recetas.guardarAutoReparacion) return [];
  if (ganadoras.length === 0) return [];
  try {
    const fresco = await recetas.leerAutoReparacion(receta.id, job.ownerId);
    if (fresco === null) return [];
    // Las claves de las ganadoras salen de los pasos QUE SE EJECUTARON (los indices registrados
    // apuntan a esa lista); la regla y el reordenamiento corren sobre los pasos VIGENTES en la base,
    // que pudieron cambiar durante la corrida por la reparacion de selectores.
    const historial = registrarGanadoras(
      parsearHistorialGanadoras(fresco.ganadoras),
      ganadorasDeCorrida(receta.pasos, ganadoras),
      job.id,
      new Date().toISOString(),
    );
    const promociones = evaluarPromociones(historial, fresco.pasos);
    const pasosPromovidos =
      promociones.length === 0 ? null : aplicarPromociones(fresco.pasos, promociones);
    const escrito = await recetas.guardarAutoReparacion(
      receta.id,
      job.ownerId,
      fresco.version,
      historial,
      pasosPromovidos,
      promociones.length,
    );
    if (!escrito) {
      deps.logger.info(
        'tarea web: otra corrida actualizo lo aprendido primero; el registro de ganadoras de esta se descarta',
        { jobId: job.id, recetaId: receta.id },
      );
      return [];
    }
    for (const promocion of promociones) {
      deps.logger.info('tarea web: la tarea se ajusto sola (estrategia promovida a primaria)', {
        jobId: job.id,
        recetaId: receta.id,
        paso: promocion.pasoIdx,
        indicePromovido: promocion.indiceAnterior,
        estrategia: JSON.stringify(promocion.estrategia),
      });
    }
    return promociones;
  } catch (error) {
    deps.logger.warn(
      'tarea web: no se pudo registrar que estrategias ganaron (se ignora, best-effort)',
      { jobId: job.id, recetaId: receta.id, err: describir(error) },
    );
    return [];
  }
}

/**
 * Agrega a la traza de la corrida un paso sintetico RECETA:PROMOVIDA por cada promocion aplicada,
 * visible en /actividad igual que las etiquetas receta:determinista y receta:escalado. El selector
 * lleva la estrategia promovida (misma representacion que el selector de los demas pasos de receta).
 */
function conEtiquetasDePromocion(
  pasos: PasoCensurado[],
  promociones: PromocionDeEstrategia[],
): PasoCensurado[] {
  const etiquetas = promociones.map((promocion, i): PasoCensurado => ({
    idx: pasos.length + i,
    // La etiqueta es un VEREDICTO del sistema, no una accion sobre la pagina: se sella sintetica por
    // el mismo criterio con el que se sellan las de la guardia (ver `sintetico`, trayectoria.ts).
    sintetico: true,
    accion: {
      tipo: 'receta:promovida',
      instruccion: `la tarea se ajusto sola: el paso ${promocion.pasoIdx + 1} ahora se localiza primero de otra forma (${promocion.clave})`,
      metodo: null,
      argumentos: [],
    },
    selector: JSON.stringify(promocion.estrategia),
    valorCensurado: null,
    estrategias: [],
    url: null,
    exito: true,
  }));
  return [...pasos, ...etiquetas];
}

/** Repara, jubila y contabiliza la receta tras una corrida. Best-effort: nunca cambia el desenlace. */
async function mantenerRecetaBestEffort(
  deps: TareaWebDeps,
  job: Job,
  receta: RecetaWeb,
  pasosReparados: PasoDeReceta[] | null,
  desenlace: { tipo: string; obsoleta?: boolean },
): Promise<void> {
  const recetas = deps.recetas;
  if (!recetas) return;
  try {
    if (desenlace.obsoleta === true) {
      await recetas.marcarObsoleta(receta.id, job.ownerId);
    } else if (pasosReparados !== null) {
      await recetas.reemplazarPasos(receta.id, job.ownerId, pasosReparados);
    }
    await recetas.registrarEjecucion(receta.id, job.ownerId, desenlace.tipo === 'completada');
  } catch (error) {
    deps.logger.warn('tarea web: no se pudo actualizar lo aprendido (se ignora, best-effort)', {
      jobId: job.id,
      err: describir(error),
    });
  }
}

/**
 * PROMOCION AUTOMATICA (CAMBIO 3, D4): al terminar con exito una tarea que corrio CON EL MOTOR, la
 * traza acumulada del job se convierte en receta activa para (owner, dominio, firma del objetivo).
 * Sin intervencion del usuario y SIEMPRE best-effort: promover es una optimizacion, no parte del
 * desenlace de la tarea.
 *
 * Se promueve la traza de TODO el job, no la de la ultima corrida: cuando hay una accion irreversible
 * de por medio, la preparacion vive en la primera corrida y la ejecucion verificada en la segunda;
 * una receta con solo la segunda mitad haria algo distinto de lo aprendido.
 *
 * NO PUBLICA NADA. La publicacion de plantillas (V041) colgaba de esta funcion y por eso no habia
 * producido ni una fila: se decide y se ejecuta por su cuenta en el cierre del job (ver
 * `publicarPlantillaBestEffort`).
 */
async function promoverRecetaBestEffort(
  deps: TareaWebDeps,
  job: Job,
  sitio: SitioConectado,
  objetivo: string,
  pasos: PasoCensurado[],
  verboBloqueado: string | null,
  dominios: readonly string[],
): Promise<void> {
  const recetas = deps.recetas;
  if (!recetas || !deps.determinista || !deps.escalador) return;
  const promocion = promoverTrayectoria({
    pasos,
    dominio: sitio.dominio,
    objetivo,
    estado: 'exitosa',
    exigeVerificacion: verboBloqueado !== null,
  });
  if (!promocion.promovida) {
    deps.logger.info('tarea web: la corrida no se pudo convertir en algo repetible', {
      jobId: job.id,
      connectionId: sitio.id,
      motivo: promocion.motivo,
    });
    return;
  }
  try {
    const receta = await recetas.promover({
      ownerId: job.ownerId,
      dominio: sitio.dominio,
      firmaObjetivo: firmaDeObjetivo(objetivo, dominios),
      pasos: promocion.pasos,
      creadaDesdeTrayectoria: null,
    });
    deps.logger.info('tarea web: la corrida quedo aprendida para repetirla sin modelo', {
      jobId: job.id,
      connectionId: sitio.id,
      dominio: sitio.dominio,
      recetaId: receta?.id ?? null,
      pasos: promocion.pasos.length,
    });
  } catch (error) {
    deps.logger.warn('tarea web: no se pudo guardar lo aprendido (se ignora, best-effort)', {
      jobId: job.id,
      err: describir(error),
    });
  }
}

/**
 * EL VEREDICTO DE LA PUBLICACION de una corrida (OBSERVABILIDAD, 30 jul 2026). Queda en el log Y en
 * `jobs.resultado`, campo `plantilla`, SIEMPRE: publicada o no, y por que no.
 *
 * POR QUE EXISTE: la publicacion de plantillas (V041) no habia producido ni una fila en produccion y
 * averiguar por que costo una auditoria entera, porque el veredicto no se registraba en ningun lado.
 * Es la SEGUNDA vez que la falta de observabilidad de un aprendizaje colectivo cuesta lo mismo (la
 * primera fue `resumenDeCorridaLibre`, atlas-sitios.ts, 29 jul 2026), asi que aqui el veredicto viaja
 * al resultado del job y no solo al log.
 *
 * NO ES un dato del usuario: un booleano, un motivo de vocabulario cerrado, un indice de paso y un
 * conteo. Nada de esto identifica al owner, al sitio ni a lo que la tarea escribio.
 */
interface VeredictoDePlantilla {
  publicada: boolean;
  /**
   * Por que no se publico. Son los motivos de `esPublicable` (packages/shared) y de
   * `plantillaDeLaCorrida`, mas los del CABLEADO, que son los que hasta hoy salian en silencio:
   * `sin_procedimiento_repetible` (la traza de la corrida no se pudo convertir en pasos),
   * `publicacion_no_cableada` (falta el puerto), `rechazada_por_el_backend` y `error_al_publicar`.
   * null cuando si se publico.
   */
  motivo: string | null;
  /**
   * EL SUB-MOTIVO: la REGLA concreta que corto, cuando `motivo` es un motivo que agrupa varias.
   * Hoy solo lo lleva `sin_procedimiento_repetible`, que son las TRECE reglas de `promoverTrayectoria`
   * metidas en una palabra (ver ReglaDeRechazo, receta-web.ts). null cuando el motivo ya es la regla.
   *
   * POR QUE EXISTE: es la SEGUNDA vez que la falta de detalle de este campo obliga a deducir el
   * diagnostico leyendo el conversor, porque ni la base ni el log lo tenian (la primera fue el
   * veredicto entero, 30 jul 2026). Vocabulario CERRADO igual que `motivo`: ni un dato del usuario,
   * del sitio ni de lo que la tarea escribio.
   */
  submotivo: string | null;
  /** `idx` del paso que la rechazo, o null cuando el rechazo no es de un paso concreto. */
  idx: number | null;
  /** Cuantas clases avaladas por origenes independientes habia para ese dominio. */
  clases: number;
}

/**
 * PUBLICA la version ANONIMA del procedimiento que ESTA corrida acaba de demostrar, en
 * `plantillas_compartidas` (V041).
 *
 * QUE VIAJA: el conjunto de dominios, el codigo de intencion, los pasos ya filtrados y un HASH de
 * origen. QUE NO VIAJA: el owner, la firma, el objetivo, la descripcion, los valores, los xpath, las
 * rutas y los ids. No es que no se manden: `esPublicable` (packages/shared) rechaza la plantilla
 * ENTERA si alguno de ellos aparece, el puerto no tiene parametro para ellos y la tabla no tiene
 * columna donde ponerlos.
 *
 * DE DONDE SALEN LAS CLASES, y es la mitad del arreglo de este PR: de `pasos`, que el llamador arma
 * con `pasosConEstrategiasPercibidas`, o sea la MISMA lista que alimenta el atlas. Antes salian de la
 * receta promovida, cuyas estrategias, cuando existen, las derivo el modelo de su propia descripcion:
 * en ingles y sobre otro eje ("field", "compose window") frente a lo que el atlas lee del DOM
 * ("asunto", "cuerpo del mensaje"). No coincidia ninguna, asi que ninguna receta destilada del motor
 * libre podia publicar. La conversion a pasos de receta la hace `promoverTrayectoria`, que es la
 * MISMA de la promocion: aqui corre sobre la fuente buena.
 *
 * EL TEXTO DE LOS DATOS ES EL MISMO QUE USA EL CONSUMO, y esta es la mitad simetrica del arreglo:
 * `textoParametros` es el literal del usuario cuando llego, con el objetivo del modelo de respaldo
 * (ver el paso 0.5 de `procesarTareaWeb`). Antes entraba el `objetivo` que REDACTA el modelo
 * conversacional, y los dos textos divergen en produccion: la parafrasis del modelo pierde los
 * rotulos y las comillas de las que depende el extractor determinista, asi que del mismo envio la
 * PUBLICACION reconocia menos datos que el CONSUMO. La clave que se publicaba decia entonces que la
 * plantilla necesita menos de lo que va a pedir de verdad al ejecutarse, que es exactamente lo que la
 * identidad existe para impedir. CAMBIO 3 ya habia corregido la verificacion para leer el texto del
 * usuario y no propago el cambio hasta aqui.
 *
 * EL TEXTO NO SALE DE ESTA FUNCION. Entra solo porque `promoverTrayectoria` lo necesita para
 * reconocer los datos que el usuario declaro y convertirlos en marcadores; lo que se publica pasa
 * despues por `esPublicable`, que rechaza la plantilla entera ante cualquier literal.
 *
 * LA PRIMERA DE LAS DOS PUERTAS. `plantillaDeLaCorrida` corre `esPublicable` aqui, en el worker, antes
 * de mandar nada; el repositorio del backend la vuelve a correr antes del insert. Cinturon y tirantes:
 * la del worker es la que tiene el atlas en memoria y evita el viaje, la del backend es la que sigue
 * en pie si un dia escribe otro productor.
 *
 * BEST-EFFORT TOTAL, y es una linea roja: el desenlace del job YA esta decidido cuando se llama a
 * esto. Cualquier fallo se loguea aqui adentro y no se propaga -- ni el de la puerta, ni el de la
 * base, ni el de un puerto mal cableado. Compartir es una mejora para la proxima persona, jamas parte
 * del desenlace de la tarea de esta.
 *
 * SIEMPRE DEVUELVE VEREDICTO, tambien cuando no publica: un fallo de la publicacion es exactamente lo
 * que hay que poder leer despues.
 */
async function publicarPlantillaBestEffort(
  deps: TareaWebDeps,
  job: Job,
  entrada: {
    /** La traza del job con las estrategias que la PERCEPCION leyo del DOM ya puestas. */
    pasos: readonly PasoCensurado[];
    /** EL MISMO TEXTO del que el consumo saca sus datos: el literal del usuario si llego. */
    textoParametros: string;
    dominio: string;
    dominios: readonly string[];
    verboBloqueado: string | null;
    /**
     * LA RESOLUCION DE LA CORRIDA (D4), cuando el peldano de consumo interpreto el objetivo: los
     * MISMOS valores con los que se busco plantilla. La publicacion deriva sus marcadores de esta
     * resolucion y no re-deriva solo con el extractor: es lo que cierra la asimetria entre lo que se
     * publica y lo que el mismo fraseo encuentra. null = no hubo resolucion y manda el extractor.
     */
    resolucion: { valores: ValoresDeParametros } | null;
    clasesCorroboradas: ReadonlySet<string>;
  },
): Promise<VeredictoDePlantilla> {
  const clases = entrada.clasesCorroboradas.size;
  const registrar = (
    motivo: string,
    idx: number,
    submotivo: string | null = null,
  ): VeredictoDePlantilla => {
    // Con `sin_intencion_irreversible` no hay nada que reportar como anomalia: es la mitad de las
    // tareas y es la decision de diseno de V041, no un fallo.
    const nivel = motivo === 'sin_intencion_irreversible' ? 'debug' : 'info';
    deps.logger[nivel]('tarea web: la corrida no se pudo compartir como plantilla', {
      jobId: job.id,
      dominio: entrada.dominio,
      motivo,
      submotivo,
      paso: idx,
      clasesCorroboradas: clases,
    });
    return { publicada: false, motivo, submotivo, idx: idx < 0 ? null : idx, clases };
  };
  try {
    // LA INTENCION PRIMERO, antes de convertir nada. `plantillaDeLaCorrida` ya corta aqui, pero sin
    // verbo no hay forma de que la conversion cambie el desenlace y si de que lo disfrace: una tarea
    // REVERSIBLE cuya traza tampoco convierta quedaria registrada como un problema de conversion,
    // cuando lo suyo es la decision de diseno de V041, y ademas subiria a `info` un motivo que es la
    // mitad de las tareas. Es un subconjunto estricto de lo que decide `codigoDeIntencion`: sin verbo
    // el codigo es null con total seguridad, asi que ningun caso cambia de veredicto.
    if (entrada.verboBloqueado === null) return registrar('sin_intencion_irreversible', -1);
    // EL PROCEDIMIENTO de esta corrida, con la MISMA conversion que usa la promocion a receta. Que el
    // usuario conserve o no una receta propia ya NO es condicion: ver el comentario del llamador.
    const material = promoverTrayectoria({
      pasos: [...entrada.pasos],
      dominio: entrada.dominio,
      objetivo: entrada.textoParametros,
      estado: 'exitosa',
      exigeVerificacion: entrada.verboBloqueado !== null,
      // D4: la MISMA resolucion del consumo, cuando existe. Un valor que la interpretacion resolvio
      // (el cuerpo sin comillas) se reconoce en lo tecleado y se publica como PARAMETRO, con lo que
      // entra a la clave; sin esto quedaba como ranura y la clave publicada no coincidia con la que
      // el mismo fraseo usa para buscar.
      ...(entrada.resolucion !== null ? { valores: entrada.resolucion.valores } : {}),
    });
    // EL SUB-MOTIVO de la conversion: la regla que corto y el paso que la disparo, que es lo que
    // hasta hoy no quedaba en ningun lado. El `motivo` de la conversion NO viaja: lleva dentro la
    // descripcion que el modelo escribio del paso, y el resultado de un job no es lugar para eso.
    if (!material.promovida) {
      return registrar('sin_procedimiento_repetible', material.paso ?? -1, material.regla);
    }
    // Campo por campo y NUNCA con un spread de `entrada`: `plantillaDeLaCorrida` no recibe el
    // objetivo, y que no lo reciba es su primer invariante (ver la cabecera de
    // plantillas-compartidas.ts). El objetivo muere en la conversion de arriba.
    const veredicto = plantillaDeLaCorrida({
      pasos: material.pasos,
      dominio: entrada.dominio,
      dominios: entrada.dominios,
      verboBloqueado: entrada.verboBloqueado,
      clasesCorroboradas: entrada.clasesCorroboradas,
    });
    if (!veredicto.publicable) return registrar(veredicto.motivo, veredicto.idx);
    // El puerto ausente (migracion sin aplicar) tambien queda registrado: es el otro caso en el que
    // la publicacion no escribia ni una fila ni una linea de log.
    const plantillas = deps.plantillas;
    if (plantillas === undefined) return registrar('publicacion_no_cableada', -1);
    return await publicar(deps, job, plantillas, veredicto.plantilla, clases);
  } catch (error) {
    deps.logger.warn('tarea web: no se pudo compartir la plantilla (se ignora, best-effort)', {
      jobId: job.id,
      err: describir(error),
    });
    return { publicada: false, motivo: 'error_al_publicar', submotivo: null, idx: null, clases };
  }
}

/** El upsert anonimo y su log. Separado para que la funcion de arriba se lea como sus dos puertas. */
async function publicar(
  deps: TareaWebDeps,
  job: Job,
  plantillas: { repo: RepositorioPlantillasParaWorker; clave: string },
  plantilla: PlantillaDeLaCorrida,
  clases: number,
): Promise<VeredictoDePlantilla> {
  const resultado = await plantillas.repo.publicar({
    dominiosClave: plantilla.dominiosClave,
    codigoDeIntencion: plantilla.codigoDeIntencion,
    pasos: plantilla.pasos,
    // El HASH del origen de ESTA corrida, con la clave de plantillas: incomparable con el del atlas
    // para el mismo owner, que es lo que impide unir las dos tablas globales por el hash.
    origenHash: hashDeOrigenDePlantilla(job.ownerId, plantillas.clave),
  });
  if (!resultado.publicada) {
    // La SEGUNDA puerta rechazo. Si pasa, es un bug de la primera: se loguea con su motivo exacto.
    deps.logger.warn('tarea web: el backend rechazo la plantilla (se ignora, best-effort)', {
      jobId: job.id,
      motivo: resultado.motivo ?? null,
    });
    // El motivo del backend es texto libre y se queda en el log; lo que se registra en el resultado
    // del job es el vocabulario acotado del veredicto.
    return { publicada: false, motivo: 'rechazada_por_el_backend', submotivo: null, idx: null, clases };
  }
  if (resultado.rehabilitada === true) {
    // D5: la publicacion cayo sobre una fila RETIRADA y la regreso a candidata (racha y consumidores
    // en cero; los origenes se conservan). Identidad de la fila, jamas hashes.
    deps.logger.info('tarea web: la plantilla retirada quedo rehabilitada como candidata', {
      jobId: job.id,
      dominios: plantilla.dominiosClave,
      intencion: plantilla.codigoDeIntencion,
      marcadores: plantilla.marcadoresClave,
    });
  }
  deps.logger.info('tarea web: el procedimiento de la corrida quedo compartido como plantilla', {
    jobId: job.id,
    dominios: plantilla.dominiosClave,
    intencion: plantilla.codigoDeIntencion,
    marcadores: plantilla.marcadoresClave,
    // D2: los datos abiertos que el procedimiento pide y que viajan FUERA de la clave.
    abiertos: plantilla.marcadoresAbiertos.join('+'),
    pasos: plantilla.pasos.length,
  });
  return { publicada: true, motivo: null, submotivo: null, idx: null, clases };
}

// --- CONSUMO DE PLANTILLAS COMPARTIDAS (V041) -----------------------------------------------------

/**
 * EL CUARTO PELDANO. El orden de esta tarea es, y sigue siendo: firma exacta propia -> eleccion entre
 * tareas propias ensenadas -> PLANTILLA AJENA -> motor libre. Lo propio gana por CONTROL DE FLUJO y no
 * por convencion: si `rapida` o `elegida` devolvieron algo, la consulta de plantillas no se hace, ni
 * siquiera para diagnosticar.
 *
 * NO HAY MODELO EN NINGUN PUNTO DE ESTE CAMINO. La busqueda es un WHERE de tres columnas
 * (`identidadDeConsumo`), la aplicabilidad es codigo puro (`plantillaAplicable`), la ejecucion es
 * determinista y la escalada esta deshabilitada. Por eso `construirPeticionDeEleccion` no se toca, su
 * prompt es byte a byte el mismo con y sin plantillas disponibles, MAX_TAREAS_OFRECIDAS sigue
 * acotando exactamente lo mismo (una plantilla no entra a ese catalogo) y no existe el canal de
 * inyeccion de prompt: en `plantillas_compartidas` no hay un solo texto libre.
 */

/** Una plantilla AJENA que aplica a esta tarea, con todo lo necesario para ofrecerla y ejecutarla. */
interface PlantillaParaEstaTarea {
  id: string;
  estado: string;
  origenes: number;
  /** Los pasos ya convertidos a pasos de receta, todos en el dominio de la conexion. */
  pasos: PasoDeReceta[];
  /** Marcadores OMITIBLES que la plantilla pedia y el objetivo no declaro (D3): pasos omitidos. */
  omitidos: MarcadorParametro[];
  /** Lo que se le muestra al usuario, en codigo cerrado (ver descripcionDeOfrecimiento). */
  ofrecimiento: OfrecimientoDePlantilla;
}

/**
 * EL VEREDICTO DEL CUARTO PELDANO, con el mismo criterio que `VeredictoDePlantilla` (el de la
 * publicacion): vocabulario CERRADO, cero datos del usuario, del sitio y de la tabla, y SIEMPRE
 * presente. Viaja en `jobs.resultado`, que es el canal de diagnostico que ya existe, bajo su propia
 * clave; el log lleva lo mismo.
 *
 * POR QUE EXISTE: es la tercera vez que un aprendizaje colectivo se despliega sin forma de responder
 * "por que esta corrida no lo uso" (el atlas, 29 jul; la publicacion, 30 jul). Aqui el veredicto nace
 * con el camino.
 */
interface VeredictoDeConsumo {
  /** ¿La tarea corrio con la plantilla ajena? */
  consumida: boolean;
  /**
   * Por que no. Son los siete motivos de `plantillaAplicable` mas los del cableado y del flujo:
   * `via_propia` (alguna via propia resolvio y ni se consulto), `no_cableado`, `sin_identidad` (la
   * tarea no pide una accion irreversible, o no hay dominios), `sin_plantilla`, `error_al_leer` y
   * `abandonada` (se ejecuto y no resolvio; la termino el motor libre) y `desajuste_de_interfaz`
   * (la sonda pre-flight detecto que la pagina ya no tiene las clases observables del procedimiento
   * y NO se ejecuto un solo paso). null cuando si se consumio.
   * Los motivos del checkpoint (`rechazada_por_el_usuario`, `checkpoint_no_persistido`,
   * `ofrecimiento_distinto`) ya no existen: el consumo ejecuta directo, sin aprobacion humana.
   */
  motivo: string | null;
  /** `idx` del paso que la rechazo, o null cuando el rechazo no es de un paso concreto. */
  idx: number | null;
  /**
   * LA CLAVE CON LA QUE SE BUSCO, sus tres partes. Solo viaja en el miss ('sin_plantilla'), que es
   * cuando hace falta para saber que se pregunto.
   *
   * NO ABRE NINGUN CANAL: los componentes son vocabulario CERRADO de la plataforma (uno de los ocho
   * codigos de intencion, un subconjunto de los marcadores y los hostnames que el propio usuario
   * conecto). Ni un caracter sale de `plantillas_compartidas` ni del texto de nadie.
   *
   * `marcadores` son los DEL NUCLEO, que es con los que se busco de verdad (D1); `abiertos` son los
   * datos abiertos que el objetivo trae y que NO participan de la busqueda (D2). Separarlos es lo que
   * permite leer un miss sin auditar: un corte por marcadores solo puede venir de los del nucleo.
   */
  clave?: { dominios: string; intencion: string; marcadores: string; abiertos: string };
  /** En cual de los filtros se corto la busqueda (`CorteDelConsumo`). Solo en el miss. */
  corte?: string;
  /** Cuantos origenes tiene la fila que SI matcheo la clave, o null si ninguna. Solo en el miss. */
  origenes?: number | null;
  /**
   * COMO LE FUE a la interpretacion del objetivo (D1/D5), y solo aparece cuando se intento: lo
   * determinista no alcanzo y se le pregunto al modelo UNA vez. Vocabulario cerrado
   * (`MotivoDeInterpretacion`): es lo que responde "se intento interpretar y por que no salio".
   */
  interpretacion?: string;
  /**
   * D5: la INTENCION que la interpretacion AGREGO (uno de los ocho codigos cerrados). Solo aparece
   * cuando la regex no habia visto verbo y el modelo mapeo uno. Jamas texto libre.
   */
  intencionInterpretada?: string;
  /**
   * D5: los NOMBRES de los datos con los que quedo la resolucion (extractor + modelo), del
   * vocabulario cerrado de marcadores. Nunca los valores.
   */
  datosInterpretados?: string[];
}

/**
 * COMO LE FUE a la INTERPRETACION del objetivo. Vocabulario CERRADO, y todos menos `resuelta` terminan
 * igual: la tarea sigue por el motor libre, sin ruido, con el motivo en el diagnostico.
 */
type MotivoDeInterpretacion =
  /** No hizo falta: el extractor alcanzo, o el miss no era de los que la interpretacion arregla. */
  | 'no_intentada'
  /** No hay puerto de consulta cableado en este worker. */
  | 'no_cableada'
  /** El modelo no contesto (error, deadline o respuesta vacia). */
  | 'sin_respuesta'
  /** La respuesta no trae el objeto JSON esperado. */
  | 'no_parseable'
  /** Un nombre fuera del vocabulario, un valor vacio/no textual/largo, o una intencion invalida. */
  | 'dato_invalido'
  /** UN VALOR QUE NO ESTA EN EL TEXTO DEL USUARIO. Invalida la interpretacion entera (el ancla). */
  | 'dato_no_anclado'
  /** Ni la regex ni el modelo resolvieron una intencion: no hay clave de busqueda posible. */
  | 'sin_intencion'
  /** El modelo no agrego nada que el extractor no tuviera: volver a buscar daria lo mismo. */
  | 'sin_datos_nuevos'
  /** Los datos resueltos no se pueden traducir a la forma que compara la verificacion determinista. */
  | 'no_comparables'
  /** Se resolvieron intencion y/o datos nuevos y la busqueda se repitio con ellos. */
  | 'resuelta';

/**
 * LOS MOTIVOS DE MISS QUE UN DATO MAS PODRIA ARREGLAR. `sin_plantilla` es no haber encontrado fila
 * para el conjunto declarado; `dato_sin_declarar` es haberla encontrado y que pida un dato que el
 * objetivo no trae. Los demas motivos que no dependen de los datos ni de la intencion (sin cableado,
 * clase sin corroborar, dominio ajeno, contrato invalido, sin verificacion) no disparan la consulta:
 * seria gastar tokens en algo que no puede cambiar.
 */
const MISS_QUE_UN_DATO_ARREGLA: ReadonlySet<string> = new Set(['sin_plantilla', 'dato_sin_declarar']);

/**
 * ¿Este miss lo puede arreglar la INTERPRETACION (D1/D2)? Son los dos misses que un dato arregla MAS
 * el `sin_identidad` por falta de verbo: la regex de verbos no vio ninguna intencion en el texto
 * ("avisale a martin que su pedido esta listo") y el modelo si puede mapearla a un codigo del
 * vocabulario cerrado. Un `sin_identidad` con verbo detectado no entra aqui: ahi lo que falta son los
 * dominios, y eso ningun modelo lo arregla.
 */
function missQueLaInterpretacionArregla(
  motivo: string | null,
  verboBloqueado: string | null,
): boolean {
  if (MISS_QUE_UN_DATO_ARREGLA.has(motivo ?? '')) return true;
  return motivo === 'sin_identidad' && verboBloqueado === null;
}

/**
 * LA INTERPRETACION DEL OBJETIVO (D1/D2): UNA consulta al modelo que resuelve DE UNA VEZ la intencion
 * canonica y todos los datos anclados del pedido, cuando el extractor determinista no alcanzo para
 * encontrar una plantilla. Ya no es un segundo escalon solo de datos: es el traductor completo del
 * lenguaje natural del usuario al esquema cerrado de la plataforma.
 *
 * CUANDO CORRE, y son tres condiciones a la vez: las dos vias PROPIAS no resolvieron (si no, ni se
 * llega aqui), la busqueda con lo determinista fallo, y fallo por un motivo que la interpretacion
 * puede arreglar (un dato que falta, o una intencion que la regex no vio). Cuando el extractor y la
 * regex alcanzan, esto NO se llama y la corrida sigue costando cero tokens, igual que hoy. MAXIMO UNA
 * llamada por corrida (D6): el resultado se cachea en la corrida y lo comparten el consumo y la
 * publicacion (D4).
 *
 * LA INTENCION SOLO AGREGA (restriccion 2): `verboBloqueado` -- la deteccion determinista -- es el
 * PISO. Si la regex ya detecto un verbo, la intencion del modelo se IGNORA por completo; solo cuando
 * la regex no vio ninguno la intencion interpretada convierte la tarea en irreversible (con guardia y
 * verificacion). No existe la rama en que el modelo apague la guardia.
 *
 * QUE SE REUSA Y QUE NO. Se reusa el PUERTO (`deps.elector`), que es una consulta puntual al modelo
 * sin herramientas, sin historial y sin bucle, con temperatura 0 y deadline propio, y se reusan el
 * ANCLA al texto del usuario y el tope de largo del valor. NO se reusa nada del elector de tareas
 * propias: ni su catalogo, ni `construirPeticionDeEleccion`, ni `parsearEleccion`. La peticion es
 * OTRA (ver `construirPeticionDeDatos`) y por ella no viaja ni un id, ni una descripcion, ni nada que
 * el usuario no haya escrito.
 *
 * FALLA CERRADA SIEMPRE: cualquier desenlace que no sea `resuelta` deja los datos y el verbo como
 * estaban y la tarea sigue por el motor libre, que es la linea base y que entiende lenguaje natural
 * por si mismo. Sin reintentos (D6).
 */
async function interpretarObjetivo(
  deps: TareaWebDeps,
  job: Job,
  opciones: {
    /** El texto del que salen los datos: el literal del usuario si llego (CAMBIO 3). */
    textoParametros: string;
    /** El PISO de la guardia: la forma canonica que detecto la regex, o null. */
    verboBloqueado: string | null;
    /** Lo que el extractor determinista YA reconocio. El modelo solo puede agregar sobre esto. */
    delExtractor: ValoresDeParametros;
    apiKey: string;
    control?: ControlDeTareaWeb | undefined;
  },
): Promise<{
  datos: { valores: ValoresDeParametros; parametros: ParametrosDeclarados } | null;
  /** Intencion que el modelo AGREGO (solo cuando la regex no vio verbo). null en cualquier otro caso. */
  intencion: CodigoDeIntencion | null;
  motivo: MotivoDeInterpretacion;
}> {
  const sinDatos = (
    motivo: MotivoDeInterpretacion,
  ): { datos: null; intencion: null; motivo: MotivoDeInterpretacion } => ({
    datos: null,
    intencion: null,
    motivo,
  });
  const elector = deps.elector;
  if (!elector) return sinDatos('no_cableada');

  let respuesta: string;
  try {
    respuesta = await elector.consultar({
      peticion: construirPeticionDeDatos({ texto: opciones.textoParametros }),
      // La key es la del OWNER, la MISMA que usa el motor y que sale de su boveda. No se guarda.
      apiKey: opciones.apiKey,
      signal: opciones.control?.signal,
    });
  } catch (error) {
    deps.logger.warn('tarea web: no se pudo interpretar el objetivo; se ejecuta con el motor', {
      jobId: job.id,
      err: describir(error),
    });
    return sinDatos('sin_respuesta');
  }
  if (respuesta.trim() === '') return sinDatos('sin_respuesta');

  const leido = parsearResolucionDelObjetivo(respuesta, opciones.textoParametros);
  if (!leido.ok) {
    deps.logger.info('tarea web: la interpretacion del objetivo no se pudo usar; sigue el motor', {
      jobId: job.id,
      motivo: leido.motivo,
    });
    return sinDatos(leido.motivo);
  }

  // LA INTENCION QUE SE AGREGA: solo existe cuando la regex no detecto verbo. Con verbo detectado, la
  // intencion del modelo ni se mira: el piso manda para la guardia Y para la clave (restriccion 2).
  const intencion = opciones.verboBloqueado === null ? leido.intencion : null;
  if (opciones.verboBloqueado === null && intencion === null) {
    // Ni la regex ni el modelo mapearon una intencion: no hay clave de busqueda posible y la tarea
    // sigue por el motor libre sin ruido. Nada se pierde: el motor entiende lenguaje natural solo.
    return sinDatos('sin_intencion');
  }

  const valores = datosConLoQueElModeloAgrego(opciones.delExtractor, leido.valores);
  const agregoDatos = Object.keys(valores).length > Object.keys(opciones.delExtractor).length;
  if (!agregoDatos && intencion === null) return sinDatos('sin_datos_nuevos');
  // A la forma que consume la VERIFICACION DETERMINISTA. Si un valor no se puede interpretar como lo
  // que dice ser, no hay con que compararlo contra la pagina y no se usa (misma regla que el camino
  // de tareas propias).
  const parametros = parametrosDeclaradosDesdeValores(valores);
  if (parametros === null) return sinDatos('no_comparables');

  deps.logger.info('tarea web: el objetivo se interpreto para buscar un procedimiento compartido', {
    jobId: job.id,
    // Solo los NOMBRES de los datos y el codigo de intencion: los valores no se loguean.
    datos: nombresDeParametrosDeclarados(parametros),
    intencion,
  });
  return { datos: { valores, parametros }, intencion, motivo: 'resuelta' };
}

/**
 * ESCALADA DESHABILITADA para el camino de plantillas ajenas, y es una linea roja de este cambio.
 *
 * POR QUE: `ejecutarPasoConModelo` (stagehand.ts) llama `act` DIRECTO, sin guardia y sin verificacion
 * determinista. En una receta PROPIA eso es una reparacion sobre un procedimiento que el propio dueno
 * demostro; en un procedimiento AJENO seria un bypass completo de todo lo que este PR construye: un
 * paso cuya clase no resuelve terminaria resuelto por un modelo mirando la pagina, sin la barrera de
 * identidad de por medio.
 *
 * NO CUESTA NADA: un paso que no se resuelve de forma determinista (ni con sus estrategias ni con las
 * pistas del atlas) ABANDONA la plantilla y la tarea la termina el motor libre, que era la linea base.
 *
 * Es un puerto que NO LLAMA A NADIE, no un flag: la unica forma de escalar es a traves de este objeto,
 * y este objeto no tiene con que. Ademas el ejecutor recibe la apiKey vacia por este camino, asi que
 * ni siquiera habria con que llamar.
 */
const ESCALADOR_DESHABILITADO: EscaladorDePaso = {
  ejecutarPasoConModelo: async () => ({ ok: false, selector: null, tokensIn: null, tokensOut: null }),
};

/**
 * BUSCA la plantilla ajena que aplica a esta tarea. BEST-EFFORT de punta a punta: sin cableado, sin
 * fila, con un fallo de lectura o con cualquiera de los motivos de no aplicabilidad, devuelve null y
 * la tarea sigue por el motor libre EXACTAMENTE como hoy. Nunca lanza.
 *
 * LA EXCLUSION DEL PROPIO ORIGEN la resuelve la query (`buscarServible`): una plantilla entre cuyos
 * `origenes_hash` esta el del consumidor no se le sirve como ajena, porque la produjo el mismo y ya la
 * tiene por sus propias recetas. El hash no sale de la base para compararse aqui.
 */
async function buscarPlantillaAjena(
  deps: TareaWebDeps,
  job: Job,
  sitio: SitioConectado,
  atlas: LectorDelAtlas | null,
  opciones: {
    dominios: readonly string[];
    verboBloqueado: string | null;
    valores: ValoresDeParametros;
  },
): Promise<{ plantillas: PlantillaParaEstaTarea[]; veredicto: VeredictoDeConsumo }> {
  const sin = (motivo: string, idx: number | null = null): {
    plantillas: PlantillaParaEstaTarea[];
    veredicto: VeredictoDeConsumo;
  } => ({ plantillas: [], veredicto: { consumida: false, motivo, idx } });

  const plantillas = deps.plantillas;
  // Sin puerto de lectura, sin navegador determinista o sin recetas no hay camino que ofrecer: la
  // copia a receta propia del desenlace exitoso necesita el repositorio de recetas.
  if (!plantillas?.repo.buscarServible || !deps.determinista || !deps.recetas) {
    return sin('no_cableado');
  }
  const identidad = identidadDeConsumo({
    dominios: opciones.dominios,
    verboBloqueado: opciones.verboBloqueado,
    // Los marcadores son los que ESTE objetivo declara: la clave se calcula con lo que el consumidor
    // tiene en la mano, antes de haber visto una sola fila.
    marcadores: Object.keys(opciones.valores) as MarcadorParametro[],
  });
  if (identidad === null) return sin('sin_identidad');

  let filas: Array<{ id: string; estado: string; pasos: unknown; origenes: number }>;
  try {
    const clave = {
      dominiosClave: identidad.dominiosClave,
      codigoDeIntencion: identidad.codigoDeIntencion,
      // CONTENCION, no igualdad: la plantilla aplica si sus marcadores estan CONTENIDOS en los que
      // este objetivo declara. `marcadoresClave` (el conjunto exacto) no viaja a la consulta.
      marcadoresPosibles: identidad.marcadoresPosibles,
      origenHash: hashDeOrigenDePlantilla(job.ownerId, plantillas.clave),
    };
    // D5 (coexistencia de variantes): con el metodo nuevo llegan hasta MAX_CANDIDATAS_DE_CONSUMO
    // candidatas en el orden del desempate; con el viejo, una sola, exactamente como hasta hoy.
    if (plantillas.repo.buscarServibles) {
      filas = await plantillas.repo.buscarServibles(clave);
    } else {
      const fila = await plantillas.repo.buscarServible(clave);
      filas = fila === null ? [] : [fila];
    }
  } catch (error) {
    deps.logger.warn('tarea web: no se pudo consultar el procedimiento compartido; se ejecuta con el motor', {
      jobId: job.id,
      err: describir(error),
    });
    return sin('error_al_leer');
  }
  if (filas.length === 0) {
    return { plantillas: [], veredicto: await veredictoDelMiss(deps, job, plantillas.repo, identidad) };
  }

  // La aplicabilidad se evalua candidata por candidata, EN EL ORDEN DEL DESEMPATE, y el orden se
  // conserva: la sonda pre-flight del llamador descarta las que no describen la pagina de enfrente
  // y se ejecuta la primera que si. Con cero aplicables, el motivo es el de la PRIMERA candidata,
  // que es la fila que la consulta de una sola candidata habria devuelto.
  const aplicables: PlantillaParaEstaTarea[] = [];
  let primerRechazo: { motivo: string; idx: number | null } | null = null;
  for (const fila of filas) {
    const veredicto = plantillaAplicable({
      pasos: fila.pasos,
      dominio: sitio.dominio,
      valores: opciones.valores,
      verboBloqueado: opciones.verboBloqueado,
      // LAS CLASES CORROBORADAS DE ESTE CONSUMIDOR, no las del que publico: lo que el atlas avala
      // para este dominio y este origen. Vacio (y con eso nada aplica) si el atlas no esta cableado.
      clasesCorroboradas: atlas?.clasesCorroboradas(sitio.dominio) ?? new Set<string>(),
    });
    if (!veredicto.aplica) {
      deps.logger.info('tarea web: hay un procedimiento compartido para esta tarea pero no aplica aqui', {
        jobId: job.id,
        dominio: sitio.dominio,
        motivo: veredicto.motivo,
        paso: veredicto.idx,
      });
      primerRechazo ??= { motivo: veredicto.motivo, idx: veredicto.idx < 0 ? null : veredicto.idx };
      continue;
    }
    aplicables.push({
      id: fila.id,
      estado: fila.estado,
      origenes: fila.origenes,
      pasos: veredicto.pasos,
      omitidos: veredicto.omitidos,
      ofrecimiento: {
        codigoDeIntencion: identidad.codigoDeIntencion,
        marcadores: veredicto.marcadores,
        dominio: sitio.dominio,
      },
    });
  }
  if (aplicables.length === 0) {
    return sin(primerRechazo?.motivo ?? 'sin_plantilla', primerRechazo?.idx ?? null);
  }
  return { plantillas: aplicables, veredicto: { consumida: false, motivo: null, idx: null } };
}

/**
 * EL VEREDICTO DE UN MISS, con lo que hace falta para no tener que auditar: las TRES PARTES de la
 * clave que se buscaron y EN CUAL DE LOS FILTROS se corto.
 *
 * POR QUE: 'sin_plantilla' a secas ya obligo a tres investigaciones read-only completas para
 * averiguar la causa (el origen propio que excluia para siempre, la igualdad exacta de marcadores y
 * la divergencia entre los textos de los dos lados). No debe haber una cuarta.
 *
 * LA CONSULTA DEL CORTE SOLO CORRE AQUI, o sea despues de que la lectura del consumo ya devolvio
 * vacio: el camino feliz no paga ni una query de mas. Y es best-effort: sin el puerto, o si falla, el
 * veredicto sale igual con su clave y sin el corte.
 */
async function veredictoDelMiss(
  deps: TareaWebDeps,
  job: Job,
  repo: RepositorioPlantillasParaWorker,
  identidad: IdentidadDePlantilla,
): Promise<VeredictoDeConsumo> {
  const veredicto: VeredictoDeConsumo = {
    consumida: false,
    motivo: 'sin_plantilla',
    idx: null,
    clave: {
      dominios: identidad.dominiosClave,
      intencion: identidad.codigoDeIntencion,
      // El conjunto EXACTO del nucleo que el objetivo declara. Los subconjuntos con los que se busco
      // de verdad se derivan de este sin ambiguedad, asi que no hace falta repetirlos.
      marcadores: identidad.marcadoresClave,
      // Los datos ABIERTOS del objetivo, que no entraron a la busqueda: quedan a la vista para que un
      // miss no se confunda con un corte por marcadores, que solo el nucleo puede provocar.
      abiertos: identidad.marcadoresAbiertos.join('+'),
    },
  };
  if (!repo.diagnosticarMiss) return veredicto;
  try {
    const diagnostico = await repo.diagnosticarMiss({
      dominiosClave: identidad.dominiosClave,
      codigoDeIntencion: identidad.codigoDeIntencion,
      marcadoresPosibles: identidad.marcadoresPosibles,
    });
    return { ...veredicto, corte: diagnostico.corte, origenes: diagnostico.origenes };
  } catch (error) {
    deps.logger.warn('tarea web: no se pudo diagnosticar por que no habia procedimiento compartido', {
      jobId: job.id,
      err: describir(error),
    });
    return veredicto;
  }
}

/**
 * Mensaje del cierre cuando la plantilla se ABANDONO a mitad pero su accion irreversible SI surtio
 * efecto. No se sigue con el motor libre a proposito: el motor volveria a intentar la accion y ese es
 * exactamente el camino por el que se duplica un envio o un pago.
 */
const MENSAJE_PLANTILLA_CON_EFECTO =
  'el procedimiento se interrumpio despues de que la accion ya surtiera efecto en el sitio; la tarea ' +
  'termina aqui y NO se reintenta automaticamente para no repetirla. Revisa el resultado en el sitio';

/**
 * La traza de la ejecucion con ETIQUETA PROPIA: `plantilla:determinista` / `plantilla:atlas` /
 * `plantilla:verificado` / `plantilla:escalado`, para que en /actividad se distinga de una receta
 * propia de un vistazo (la consola muestra el tipo del paso tal cual). Los pasos de la BARRERA DE
 * IDENTIDAD se dejan INTACTOS: su etiqueta es la misma en los tres caminos a proposito, que es lo que
 * permite comparar la medicion de uno contra la de otro (ver resumenDeIdentidad).
 */
function conEtiquetaDePlantilla(pasos: PasoCensurado[]): PasoCensurado[] {
  const prefijo = 'receta:';
  return pasos.map((paso) =>
    paso.accion.tipo.startsWith(prefijo)
      ? {
          ...paso,
          accion: { ...paso.accion, tipo: `plantilla:${paso.accion.tipo.slice(prefijo.length)}` },
        }
      : paso,
  );
}

/**
 * ¿La accion irreversible de la plantilla SURTIO EFECTO? Con la MISMA funcion determinista que usa la
 * guardia del motor libre (`accionSurtioEfecto`, verificacion.ts) y con la MISMA politica de
 * relecturas: el sitio tarda en cerrar el redactor o en pintar su aviso. El MODELO no participa.
 *
 * `antes` es la foto que tomo el paso `verificar` de la plantilla, o sea la misma contra la que se
 * comparo cada dato antes de dejar pasar la accion. Sin esa foto no hay nada que comparar y la
 * respuesta es NO (jamas se asume exito).
 */
async function confirmarEfectoDeLaPlantilla(
  deps: TareaWebDeps,
  job: Job,
  sesionExternaId: string,
  antes: EstadoDeLaPagina | null,
  parametros: ParametrosDeclarados,
): Promise<boolean> {
  if (antes === null) return false;
  const esperar = deps.esperar ?? esperarMs;
  for (let intento = 0; intento < INTENTOS_DE_CONFIRMACION; intento++) {
    if (intento > 0) await esperar(ESPERA_ENTRE_CONFIRMACIONES_MS);
    const despues = await leerEstadoDeLaPagina(deps, job, sesionExternaId);
    if (despues === null) continue;
    if (accionSurtioEfecto({ parametros, antes, despues })) return true;
  }
  return false;
}

/**
 * Contadores agregados de la plantilla y sus TRANSICIONES de estado. Best-effort: el desenlace del
 * job ya esta decidido. `motivo` (V042) dice por que fallo el ultimo intento, con el vocabulario
 * cerrado del contrato; solo viaja en los fallos, y un exito lo limpia en la fila.
 *
 * EN EL EXITO viaja ademas el hash del CONSUMIDOR de esta corrida (V043, la misma derivacion que el
 * hash de origen: incomparable con el del atlas), que es la evidencia con la que 'candidata' pasa a
 * 'corroborada'. Las transiciones (corroborada, retirada) se LOGUEAN aqui con la IDENTIDAD de la
 * fila -- dominios, intencion, marcadores -- y jamas con un hash.
 */
async function registrarEjecucionDePlantillaBestEffort(
  deps: TareaWebDeps,
  job: Job,
  plantillaId: string,
  exitosa: boolean,
  motivo?: MotivoDeFallaDePlantilla,
): Promise<void> {
  const registrar = deps.plantillas?.repo.registrarEjecucion;
  if (registrar === undefined || deps.plantillas === undefined) return;
  try {
    const consumidorHash = exitosa
      ? hashDeOrigenDePlantilla(job.ownerId, deps.plantillas.clave)
      : undefined;
    const registro = await registrar.call(
      deps.plantillas.repo,
      plantillaId,
      exitosa,
      motivo,
      consumidorHash,
    );
    if (registro !== null && registro !== undefined && registro.estado !== registro.estadoPrevio) {
      const nivel = registro.estado === 'retirada' ? 'warn' : 'info';
      deps.logger[nivel]('tarea web: la plantilla compartida cambio de estado', {
        jobId: job.id,
        dominios: registro.dominiosClave,
        intencion: registro.codigoDeIntencion,
        marcadores: registro.marcadoresClave,
        de: registro.estadoPrevio,
        a: registro.estado,
      });
    }
  } catch (error) {
    deps.logger.warn('tarea web: no se pudo contabilizar la plantilla (se ignora, best-effort)', {
      jobId: job.id,
      err: describir(error),
    });
  }
}

/**
 * DESAJUSTE DE INTERFAZ de una plantilla (V044, D4), detectado por la sonda pre-flight ANTES de
 * ejecutar un solo paso. Best-effort con el mismo criterio que registrarEjecucionDePlantillaBestEffort;
 * las transiciones (retirada con dos consumidores distintos) se loguean con la IDENTIDAD de la fila,
 * jamas con un hash.
 */
async function registrarDesajusteDePlantillaBestEffort(
  deps: TareaWebDeps,
  job: Job,
  plantillaId: string,
): Promise<void> {
  const registrar = deps.plantillas?.repo.registrarDesajuste;
  if (registrar === undefined || deps.plantillas === undefined) return;
  try {
    const registro = await registrar.call(
      deps.plantillas.repo,
      plantillaId,
      hashDeOrigenDePlantilla(job.ownerId, deps.plantillas.clave),
    );
    if (registro !== null && registro !== undefined && registro.estado !== registro.estadoPrevio) {
      deps.logger.warn('tarea web: la plantilla compartida quedo retirada por desajuste de interfaz', {
        jobId: job.id,
        dominios: registro.dominiosClave,
        intencion: registro.codigoDeIntencion,
        marcadores: registro.marcadoresClave,
        de: registro.estadoPrevio,
        a: registro.estado,
      });
    }
  } catch (error) {
    deps.logger.warn('tarea web: no se pudo registrar el desajuste de interfaz (se ignora, best-effort)', {
      jobId: job.id,
      err: describir(error),
    });
  }
}

/**
 * COPIA la plantilla como RECETA PROPIA del consumidor, con origen 'plantilla_compartida' (el CHECK de
 * V041 ya lo admite, asi que no hace falta migracion).
 *
 * SOLO SE LLAMA CON EFECTO CONFIRMADO. La condicion no es "corrio sin error" sino "la accion que el
 * usuario pidio surtio efecto EN SU CUENTA, medido por la funcion determinista": es la misma evidencia
 * que la publicacion exige para compartir, aplicada ahora al otro sentido. Copiar un procedimiento que
 * no se demostro condenaria a la proxima corrida a repetirlo.
 *
 * A partir de la copia deja de ser una plantilla ajena: la proxima vez la encuentra `buscarActiva` por
 * firma exacta, en el PRIMER peldano, sin checkpoint y sin consultar la tabla global. Se guarda con la
 * MISMA firma que usa la promocion automatica (`firmaDeObjetivo` sobre el objetivo y el conjunto de
 * dominios) para que las dos vias no siembren dos recetas distintas de la misma tarea.
 *
 * BEST-EFFORT: el desenlace del job ya esta decidido cuando esto corre.
 */
async function copiarPlantillaComoRecetaBestEffort(
  deps: TareaWebDeps,
  job: Job,
  sitio: SitioConectado,
  objetivo: string,
  dominios: readonly string[],
  pasos: PasoDeReceta[],
): Promise<void> {
  const recetas = deps.recetas;
  if (!recetas) return;
  try {
    const receta = await recetas.promover({
      ownerId: job.ownerId,
      dominio: sitio.dominio,
      firmaObjetivo: firmaDeObjetivo(objetivo, dominios),
      pasos,
      creadaDesdeTrayectoria: null,
      origen: 'plantilla_compartida',
    });
    deps.logger.info('tarea web: el procedimiento compartido quedo aprendido como tarea propia', {
      jobId: job.id,
      connectionId: sitio.id,
      dominio: sitio.dominio,
      recetaId: receta?.id ?? null,
      pasos: pasos.length,
    });
  } catch (error) {
    deps.logger.warn('tarea web: no se pudo copiar el procedimiento compartido (se ignora, best-effort)', {
      jobId: job.id,
      err: describir(error),
    });
  }
}

/**
 * EJECUTA la plantilla ajena que paso todas las puertas tecnicas, DIRECTO y sin checkpoint (el
 * consentimiento vive en los documentos legales aceptados al conectar sitios). Es el MISMO ejecutor
 * determinista de una receta propia (`ejecutarReceta`), con la MISMA verificacion determinista en su
 * paso `verificar` y la MISMA politica del usuario, y con TRES diferencias, todas hacia el lado
 * estricto:
 *
 *  1. LA BARRERA DE IDENTIDAD CORRE EN MODO 'activa' SIEMPRE, sea cual sea el valor global de
 *     TAREA_WEB_BARRERA_IDENTIDAD (hoy 'observacion'). No se cambia el env ni el comportamiento de
 *     ningun otro camino: el modo es un parametro de esta llamada. Y corre en TODOS los pasos que
 *     tocan el DOM, no solo en el irreversible, que es lo que contiene el paso EXTRA INTERCALADO (ver
 *     `plantillaAplicable`). Un bloqueo ABANDONA la plantilla.
 *  2. LA ESCALADA ESTA DESHABILITADA (ver ESCALADOR_DESHABILITADO). La apiKey viaja VACIA por este
 *     camino: no hay con que llamar a un modelo aunque alguien lo intentara.
 *  3. LA TRAZA lleva etiqueta propia, para que /actividad no confunda esto con una receta propia.
 *
 * NO REPARA, NO JUBILA Y NO ALIMENTA EL ATLAS. Una plantilla no es de este owner: no hay pasos suyos
 * que reparar, y las estrategias que le funcionaron aqui vienen de una fila global, asi que
 * devolverlas al atlas seria corroborar una entrada consigo misma.
 */
async function ejecutarPorPlantilla(
  deps: TareaWebDeps,
  job: Job,
  sitio: SitioConectado,
  objetivo: string,
  sesionExternaId: string,
  plantilla: PlantillaParaEstaTarea,
  opciones: {
    politica: PoliticaVigente | null;
    verboBloqueado: string | null;
    textoParametros: string;
    contexto: string;
    dominios: readonly string[];
    valores: ValoresDeParametros;
    parametros: ParametrosDeclarados;
    control?: ControlDeTareaWeb | undefined;
    atlas?: LectorDelAtlas | null | undefined;
    /** TELEMETRIA de la guardia con criterio generico (D3), compartida por toda la corrida. */
    observacion?: ObservacionDeLaGuardia | undefined;
  },
): Promise<DesenlaceDelCaminoPorReceta> {
  const determinista = deps.determinista;
  if (!determinista) return { tipo: 'seguir_con_motor', paginaTocada: false };

  // LA FOTO PREVIA la deja el paso `verificar`: es la misma contra la que se comparo cada dato, y la
  // referencia contra la que despues se confirma el efecto. En un objeto y no en una variable suelta
  // para que la asignacion desde el callback sea visible al terminar.
  const foto: { antes: EstadoDeLaPagina | null } = { antes: null };
  const iniciadaEn = new Date();
  const resultado = await ejecutarReceta(plantilla.pasos, opciones.valores, {
    navegador: determinista,
    escalador: ESCALADOR_DESHABILITADO,
    verificar: async (activo): Promise<VeredictoDeVerificacion> => {
      const { veredicto, pagina, habriaDetenido } = await resolverVerificacion(
        deps,
        job,
        sitio,
        activo.sesionExternaId,
        {
          politica: opciones.politica,
          verboBloqueado: opciones.verboBloqueado,
          textoParametros: opciones.textoParametros,
          // D2: el paso `verificar` de una plantilla precede a su accion irreversible, igual que en
          // una receta propia. Cero comparaciones no puede resolver 'ejecutar' sobre un
          // procedimiento que ademas descubrio otra cuenta.
          exigeComparacion: true,
          // LOS DATOS DE ESTA CORRIDA, que son los MISMOS que la plantilla teclea. Con los del
          // extractor determinista es exactamente lo que esta funcion calcularia sola; con los que
          // resolvio el modelo (FIX E) es lo unico que hace que se compare contra la pagina lo que se
          // va a escribir en ella, y no contra un extracto mas pobre del mismo texto.
          parametros: opciones.parametros,
        },
      );
      foto.antes = pagina;
      if (habriaDetenido && opciones.observacion !== undefined) {
        opciones.observacion.habriaDetenido += 1;
      }
      if (veredicto.tipo === 'ejecutar') return { tipo: 'ejecutar' };
      return {
        tipo: 'detener',
        mensaje:
          veredicto.tipo === 'incompleto'
            ? mensajeDeDetencion(detencionPorDatosIncompletos(veredicto.faltantes))
            : mensajeDeDetencion(veredicto),
      };
    },
    sesionExternaId,
    // VACIA a proposito: con la escalada deshabilitada no hay a quien llamar, y que la key ni siquiera
    // este disponible por este camino es la segunda garantia de que no se llama.
    apiKey: '',
    dominio: sitio.dominio,
    // Sin `cambiarASitio`: `plantillaAplicable` ya exige que todos los pasos corran en el dominio de
    // esta conexion, y un paso que nombrara otro abandona la plantilla.
    ...(opciones.atlas ? { atlas: opciones.atlas.pistas(sitio.dominio) } : {}),
    barreraIdentidad: {
      modo: 'activa',
      verboDelObjetivo: opciones.verboBloqueado,
      clasesCorroboradas: (dominio: string): ReadonlySet<string> =>
        opciones.atlas?.clasesCorroboradas(dominio) ?? new Set<string>(),
    },
    signal: opciones.control?.signal,
  });

  const completada = resultado.desenlace.tipo === 'completada';
  await guardarTrayectoriaBestEffort(
    deps,
    job,
    sitio,
    objetivo,
    completada ? 'exitosa' : 'fallida',
    iniciadaEn,
    { acciones: [], tokensIn: resultado.tokensIn, tokensOut: resultado.tokensOut },
    // D3c: los pasos ejecutados mas -- al final y con su propia etiqueta -- los OMITIDOS por dato no
    // declarado, para que la tarjeta de /actividad diga que un dato omitible no se tecleo. Solo viaja
    // el NOMBRE del marcador (vocabulario cerrado), jamas un valor.
    [
      ...conEtiquetaDePlantilla(resultado.pasos),
      ...plantilla.omitidos.map((marcador, i) => ({
        idx: resultado.pasos.length + i,
        accion: {
          tipo: 'plantilla:omitido',
          instruccion: null,
          metodo: null,
          argumentos: [marcador],
        },
        selector: null,
        valorCensurado: null,
        url: null,
        exito: true,
        estrategias: [],
      })),
    ],
  );

  if (resultado.desenlace.tipo === 'detenida') {
    // LA VERIFICACION DETERMINISTA DETUVO la accion. No mueve NINGUN contador de la plantilla a
    // proposito: lo que corto fue la politica del usuario o la comparacion contra su pagina, y eso no
    // dice nada sobre el procedimiento. Contarlo como fallo retiraria plantillas buenas por decisiones
    // de sus consumidores. Mismo cierre que el camino por receta.
    deps.logger.warn('tarea web DETENIDA antes de ejecutar la accion (procedimiento compartido)', {
      jobId: job.id,
      connectionId: sitio.id,
      plantillaId: plantilla.id,
    });
    throw new PermanentExecutionError(resultado.desenlace.mensaje);
  }

  const efectoConfirmado = await confirmarEfectoDeLaPlantilla(
    deps,
    job,
    sesionExternaId,
    foto.antes,
    opciones.parametros,
  );

  if (completada && efectoConfirmado) {
    await registrarEjecucionDePlantillaBestEffort(deps, job, plantilla.id, true);
    await copiarPlantillaComoRecetaBestEffort(
      deps,
      job,
      sitio,
      objetivo,
      opciones.dominios,
      plantilla.pasos,
    );
    await refrescarContextoBestEffort(deps, sitio, job.ownerId, sesionExternaId, opciones.contexto);
    deps.logger.info('tarea web completada con un procedimiento que descubrio otra cuenta', {
      jobId: job.id,
      connectionId: sitio.id,
      dominio: sitio.dominio,
      plantillaId: plantilla.id,
      pasos: plantilla.pasos.length,
    });
    return { tipo: 'completada' };
  }

  // EL MOTIVO DEL FALLO (V042), derivado del desenlace con el vocabulario cerrado del contrato:
  // corrio entera sin efecto confirmado -> 'sin_efecto'; la barrera bloqueo un paso ->
  // 'barrera_bloqueada'; el navegador lanzo al ejecutar (sesion caida o CDP sin respuesta) ->
  // 'sesion'; cualquier otro abandono determinista -> 'abandonada'. Es lo que alimenta el retiro.
  const causa =
    resultado.desenlace.tipo === 'abandonada' ? (resultado.desenlace.causa ?? null) : null;
  const motivoDeFalla: MotivoDeFallaDePlantilla = completada
    ? 'sin_efecto'
    : causa === 'barrera'
      ? 'barrera_bloqueada'
      : causa === 'navegador'
        ? 'sesion'
        : 'abandonada';
  await registrarEjecucionDePlantillaBestEffort(deps, job, plantilla.id, false, motivoDeFalla);

  if (completada) {
    // Corrio entera y el sitio NO muestra que la accion surtiera efecto. NO se copia como receta (el
    // procedimiento no se demostro) y la tarea NO sigue con el motor: repetir a ciegas una accion
    // irreversible es como se duplica un envio. Mismo cierre y mismo mensaje que el motor libre.
    deps.logger.warn('tarea web: el procedimiento compartido corrio sin efecto confirmado', {
      jobId: job.id,
      connectionId: sitio.id,
      plantillaId: plantilla.id,
    });
    throw new AccionSinEfectoConfirmadoError(MENSAJE_SIN_CONFIRMAR);
  }
  if (efectoConfirmado) {
    deps.logger.warn('tarea web: el procedimiento compartido se abandono con la accion ya consumada', {
      jobId: job.id,
      connectionId: sitio.id,
      plantillaId: plantilla.id,
    });
    throw new PermanentExecutionError(MENSAJE_PLANTILLA_CON_EFECTO);
  }
  deps.logger.info('tarea web: el procedimiento compartido no resolvio aqui; se sigue con el motor', {
    jobId: job.id,
    connectionId: sitio.id,
    plantillaId: plantilla.id,
    motivo: resultado.desenlace.tipo === 'abandonada' ? resultado.desenlace.motivo : null,
    pasosEjecutados: resultado.pasosEjecutados,
    // Con la escalada deshabilitada esto es SIEMPRE 0: es la asercion en produccion de que este
    // camino no llamo al modelo ni una vez.
    escalados: resultado.escalados,
  });
  return { tipo: 'seguir_con_motor', paginaTocada: resultado.pasosEjecutados > 0 };
}

/**
 * LECTOR DEL ATLAS DE SITIOS (V040) de ESTA corrida: lo que la plataforma ya observo de la estructura
 * de los dominios que la tarea autoriza, filtrado por la regla de corroboracion contra el hash del
 * origen de esta corrida (atlas-sitios.ts: dos origenes distintos, o el propio origen).
 *
 * Se lee UNA vez por tarea, al arrancar, y no se vuelve a consultar: los inyectores son sincronos
 * (una pista no puede costarle una query a la mitad de un paso) y lo aprendido de un dominio no cambia
 * dentro de la misma corrida de forma relevante.
 *
 * BEST-EFFORT de punta a punta: un fallo de lectura deja ese dominio SIN pistas y la tarea corre
 * exactamente como antes de V040.
 */
interface LectorDelAtlas {
  /** Entradas servibles a este origen para ese dominio. Vacio si no hay o si la lectura fallo. */
  entradasDe(dominio: string): EntradaConocida[];
  /** Puerto sincrono para el ejecutor de recetas. `dominioBase` es el de los pasos sin dominio propio. */
  pistas(dominioBase: string): PistasDelAtlas;
  /**
   * Las CLASES DE ELEMENTO que este dominio tiene corroboradas, para la barrera de identidad. Es una
   * vista de lo que `entradasDe` ya trae en memoria (esServible ya aplicado): no lee la base ni abre
   * nada, y por eso puede consultarse a mitad de un paso.
   */
  clasesCorroboradas(dominio: string): ReadonlySet<string>;
  /**
   * Las clases que este dominio tiene avaladas por VARIOS ORIGENES INDEPENDIENTES, sin el atajo del
   * propio origen que `clasesCorroboradas` si concede. Es lo que autoriza a PUBLICAR una plantilla
   * (V041), y el umbral es mas duro a proposito: en la barrera de identidad la clase solo se COMPARA
   * contra el DOM del propio usuario, mientras que en una plantilla la clase acaba ESCRITA en una
   * tabla global, dentro del nombre de sus ranuras. Publicarla con un solo origen revelaria un nombre
   * accesible con menos aval del que el propio atlas exige para servirlo.
   *
   * Es otra vista de lo que `entradasDe` ya trae en memoria: no lee la base ni abre nada.
   */
  clasesParaPublicar(dominio: string): ReadonlySet<string>;
}

async function crearLectorDelAtlas(
  deps: TareaWebDeps,
  job: Job,
  dominios: readonly string[],
): Promise<LectorDelAtlas | null> {
  const atlas = deps.atlas;
  if (atlas === undefined || dominios.length === 0) return null;
  const hashDelOrigen = hashDeOrigen(job.ownerId, atlas.clave);
  const porDominio = new Map<string, EntradaConocida[]>();
  for (const dominio of dominios) {
    try {
      const crudas = await atlas.repo.listarPorDominio(dominio);
      porDominio.set(dominio, entradasServibles(crudas, hashDelOrigen));
    } catch (error) {
      deps.logger.warn('tarea web: no se pudo leer lo aprendido del sitio (se sigue sin pistas)', {
        jobId: job.id,
        dominio,
        err: describir(error),
      });
    }
  }
  const entradasDe = (dominio: string): EntradaConocida[] => porDominio.get(dominio) ?? [];
  return {
    entradasDe,
    pistas: (dominioBase: string): PistasDelAtlas => ({
      pistasParaPaso: (paso) => pistasParaPaso(paso, entradasDe(paso.dominio ?? dominioBase)),
    }),
    clasesCorroboradas: (dominio: string): ReadonlySet<string> =>
      new Set(entradasDe(dominio).map((entrada) => entrada.claseDeElemento)),
    clasesParaPublicar: (dominio: string): ReadonlySet<string> =>
      new Set(
        entradasDe(dominio)
          .filter((entrada) => entrada.origenesHash.length >= ORIGENES_PARA_COMPARTIR)
          .map((entrada) => entrada.claseDeElemento),
      ),
  };
}

/**
 * AGREGA al ATLAS DE SITIOS lo que la corrida acaba de demostrar sobre la ESTRUCTURA de un sitio.
 *
 * Lo unico que se escribe por entrada es dominio, clase de elemento, estrategias y el HASH del
 * origen. No hay parametro en esta funcion, ni columna en la tabla, para un owner, un valor tecleado
 * o un id de trayectoria: las entradas ya llegan armadas por atlas-sitios.ts, que descarta toda
 * estrategia que coincida con un valor de la corrida y trunca los nombres accesibles.
 *
 * BEST-EFFORT TOTAL, y es una linea roja: el desenlace del job YA esta decidido cuando se llama a
 * esto. Cualquier fallo se loguea aqui adentro y no se propaga. Aprender es una mejora, jamas parte
 * del desenlace de la tarea del usuario.
 */
async function registrarEnAtlasBestEffort(
  deps: TareaWebDeps,
  job: Job,
  entradas: readonly EntradaDeAtlas[],
): Promise<void> {
  const atlas = deps.atlas;
  if (atlas === undefined || entradas.length === 0) return;
  try {
    const origenHash = hashDeOrigen(job.ownerId, atlas.clave);
    for (const entrada of entradas) {
      await atlas.repo.registrarObservacion({
        dominio: entrada.dominio,
        claseDeElemento: entrada.claseDeElemento,
        estrategias: entrada.estrategias,
        origenHash,
      });
    }
    deps.logger.info('tarea web: la estructura observada del sitio quedo en el aprendizaje comun', {
      jobId: job.id,
      entradas: entradas.length,
    });
  } catch (error) {
    deps.logger.warn('tarea web: no se pudo agregar lo observado del sitio (se ignora, best-effort)', {
      jobId: job.id,
      err: describir(error),
    });
  }
}

/**
 * LA ENTRADA DEL CONTROL QUE CONSUMO LA ACCION IRREVERSIBLE, para el aprendizaje comun.
 *
 * EL HUECO QUE CIERRA. Las acciones finales (enviar, comprar, publicar, borrar, pagar, transferir,
 * firmar, cancelar) DESTRUYEN SU PROPIO CONTEXTO: al accionarlas el sitio desmonta el formulario, asi
 * que la lectura de percepcion -- que corre DESPUES de cada paso -- ya no encuentra el elemento y ese
 * control jamas llegaba al atlas. La barrera de identidad si lo lee, porque corre ANTES, y hasta hoy
 * su lectura moria en un paso sintetico con `estrategias: []`. Sin esa clase, la barrera exigia una
 * corroboracion que solo ella misma podia producir: un circuito cerrado.
 *
 * POR QUE SE ESCRIBE AQUI Y NO EN LA GUARDIA. En el cierre la corrida ya paso los dos cortes (salio
 * bien Y el efecto irreversible quedo CONFIRMADO), que es la MISMA evidencia que el atlas exige para
 * todo lo demas que aprende. Desde la guardia se registraria un boton LOCALIZADO que quiza nunca se
 * acciono, o que se acciono sin efecto.
 *
 * CANDIDATOS === 1 PARA ESCRIBIR. Con mas de un control de la familia en la pagina, la expresion
 * devuelve el PRIMER VISIBLE y no hay certeza de cual se acciono: aprender de una suposicion
 * contaminaria una tabla global. La COMPROBACION de la barrera no cambia (ahi el dato se compara
 * contra el DOM del propio usuario y no se persiste en ningun lado).
 *
 * BEST-EFFORT: cualquier fallo propio queda en el log y devuelve la lista vacia. Aprender es una
 * mejora, jamas parte del desenlace de la tarea del usuario.
 */
function entradasDelControlAccionado(
  deps: TareaWebDeps,
  job: Job,
  control: ControlDeLaAccionIrreversible | null,
  valores: readonly string[],
  yaAgregadas: readonly EntradaDeAtlas[],
): EntradaDeAtlas[] {
  if (control === null) return [];
  try {
    if (control.candidatos !== 1) {
      deps.logger.info(
        'tarea web: el control de la accion no era unico en la pagina; su clase NO se aprende',
        { jobId: job.id, dominio: control.dominio, candidatos: control.candidatos },
      );
      return [];
    }
    const entrada = entradaDelControlLeido(control, valores);
    if (entrada === null) {
      deps.logger.info('tarea web: el control de la accion no dejo una clase utilizable', {
        jobId: job.id,
        dominio: control.dominio,
      });
      return [];
    }
    const repetida = yaAgregadas.some(
      (otra) => otra.dominio === entrada.dominio && otra.claseDeElemento === entrada.claseDeElemento,
    );
    return repetida ? [] : [entrada];
  } catch (error) {
    deps.logger.warn('tarea web: no se pudo armar la clase del control accionado (se ignora)', {
      jobId: job.id,
      err: describir(error),
    });
    return [];
  }
}

/**
 * Prefijo de los tipos de paso SINTETICO que deja la barrera de identidad en la traza
 * ('identidad:permitida', 'identidad:bloqueada', 'identidad:habria_bloqueado', 'identidad:no_evaluable';
 * ver `resumenDeIdentidad`, barrera-identidad.ts, que es su unico productor).
 */
const PREFIJO_PASO_DE_IDENTIDAD = 'identidad:';

/**
 * POR QUE el paso de la accion irreversible quedo (o no) completado, en vocabulario CERRADO: ni un
 * dato del usuario, del sitio ni de lo que la tarea escribio. Va al log con el mismo criterio que el
 * resto de los veredictos de este cierre.
 */
type MotivoDelControlEnLaTraza =
  | 'completado'
  | 'sin_control_leido'
  | 'control_no_unico'
  | 'sin_paso_identificable'
  | 'paso_ya_localizado'
  | 'sin_estrategia_utilizable';

/** El resultado de completar el paso final: la lista a publicar y por que quedo como quedo. */
export interface ControlEnLaTraza {
  pasos: readonly PasoCensurado[];
  motivo: MotivoDelControlEnLaTraza;
  /** `idx` del paso completado, o null si no se completo ninguno. */
  idx: number | null;
  /** La clase que ese paso pasa a declarar. Es la MISMA que el atlas escribe. null si no se completo. */
  clase: string | null;
}

/**
 * A que accion del vocabulario de las recetas corresponde un paso ACT de la traza del motor. Mismo
 * criterio que la promocion y que el agregador del atlas: el metodo manda y un act sin metodo
 * resuelto (Stagehand lo resolvio por vision) es un click.
 */
function accionDelActDeLaTraza(paso: PasoCensurado): 'click' | 'escribir' | null {
  return paso.accion.metodo === null ? 'click' : (ACCION_POR_METODO[paso.accion.metodo] ?? null);
}

/**
 * DONDE esta, en la traza ya armada, el paso que consumo la accion irreversible.
 *
 * COMO SE SABE, y es el punto delicado de todo esto. El veredicto de la barrera de identidad queda
 * JUSTO ANTES del act que la barrera dejo pasar: la barrera se evalua UNICAMENTE en los dos puntos
 * por los que la accion irreversible sale al navegador (el primer intento y su unico reintento) y el
 * canal que intercala los pasos del sistema los pone delante de la accion numero N+1
 * (`intercalarVerificaciones`). Una accion que la guardia NO deja pasar jamas llega a la traza
 * (stagehand.ts: "la accion NO se registra en la traza"), asi que la cuenta de acciones de la
 * guardia y la de acts de la traza son la misma cuenta.
 *
 * SE TOMA EL ULTIMO veredicto de la barrera, que es el de la lectura que `controlAccionado`
 * conserva (cada lectura pisa a la anterior), y NO se busca hacia atras si no encaja: adivinar cual
 * de dos candidatos fue el que se acciono es exactamente lo que no se puede hacer aqui.
 *
 * SUS CUATRO CONDICIONES, todas necesarias: el paso siguiente EXISTE, no es otro paso del sistema,
 * es un ACT de CLICK y es del MISMO dominio en el que la barrera leyo (multisitio: la corrida pudo
 * seguir en otro sitio). Si falla una sola, devuelve null y no se completa nada.
 */
function posicionDelPasoIrreversible(
  pasos: readonly PasoCensurado[],
  dominio: string,
): number | null {
  for (let posicion = pasos.length - 1; posicion >= 0; posicion--) {
    if (!(pasos[posicion]?.accion.tipo ?? '').startsWith(PREFIJO_PASO_DE_IDENTIDAD)) continue;
    const siguiente = pasos[posicion + 1];
    if (siguiente === undefined || siguiente.sintetico === true) return null;
    if (siguiente.accion.tipo !== 'act' || accionDelActDeLaTraza(siguiente) !== 'click') return null;
    if ((siguiente.dominio ?? dominio) !== dominio) return null;
    return posicion + 1;
  }
  return null;
}

/**
 * EL LOCALIZADOR DEL CLICK FINAL, tomado de lo que la barrera ya habia leido del DOM.
 *
 * EL HUECO QUE CIERRA, y es el ultimo de esta cadena. El paso del CLICK FINAL de la traza del motor
 * libre llega SIN NINGUNA ESTRATEGIA: la percepcion lee el elemento DESPUES de la accion y para
 * entonces el sitio ya desmonto el formulario (ni el xpath resuelve ni el foco apunta al control), y
 * el complemento por selector solo alcanza a los selectores que llevan predicados de atributo
 * escritos, que en las corridas recientes son posicionales puros. La destilacion lo rechaza entonces
 * con 'click_sin_localizacion_sin_cobertura' y la corrida no publica nada, aunque haya salido bien y
 * con el efecto confirmado (corrida real del 31 jul 2026, 03:27 UTC: 17 pasos, correo enviado).
 *
 * EL DATO YA EXISTE Y ES DEL DOM. La barrera de identidad LEE ese mismo control ANTES de la accion,
 * cuando todavia existe, y esa lectura (rol accesible y nombre accesible) es la que este cierre ya
 * escribe en el atlas. Aqui se arma con la MISMA funcion (`entradaDelControlLeido`), asi que el paso
 * completado declara EXACTAMENTE la clase que el atlas corrobora: si divergieran, la plantilla se
 * caeria por 'clase_no_corroborada' y esto no serviria de nada. Ninguna descripcion del modelo
 * participa en ningun punto.
 *
 * LAS DOS CONDICIONES son las MISMAS con las que la clase entra al atlas: la corrida cerro con el
 * efecto irreversible CONFIRMADO (lo garantiza el llamador, que corre despues de los dos cortes del
 * cierre) y la barrera localizo UN UNICO candidato de la familia del verbo. Con mas de uno no hay
 * certeza de cual se acciono, y atribuirle a un paso un elemento que no acciono seria peor que no
 * publicar.
 *
 * UN PASO QUE YA TRAE LOCALIZADOR NO SE TOCA: lo que la percepcion alcanzo a leer contra el selector
 * del motor es al menos tan bueno como esto, y es el mismo criterio de `pasosConEstrategiasPercibidas`.
 *
 * NO TOCA NADA MAS: se aplica SOLO a la lista que va a la publicacion. Ni el atlas ni la promocion a
 * receta ven esta lista, y por eso las dos siguen decidiendo exactamente lo mismo que antes.
 */
export function completarPasoDeLaAccionIrreversible(
  pasos: readonly PasoCensurado[],
  control: ControlDeLaAccionIrreversible | null,
  valores: readonly string[],
): ControlEnLaTraza {
  const intacta = (motivo: MotivoDelControlEnLaTraza): ControlEnLaTraza => ({
    pasos,
    motivo,
    idx: null,
    clase: null,
  });
  if (control === null) return intacta('sin_control_leido');
  if (control.candidatos !== 1) return intacta('control_no_unico');
  const posicion = posicionDelPasoIrreversible(pasos, control.dominio);
  const paso = posicion === null ? undefined : pasos[posicion];
  if (posicion === null || paso === undefined) return intacta('sin_paso_identificable');
  if (paso.estrategias.length > 0) return intacta('paso_ya_localizado');
  // Por la MISMA puerta que el atlas: saneo del nombre accesible, filtro de tipos, recorte y
  // paranoia de valores. Lo que no pueda entrar a la tabla global tampoco completa el paso.
  const entrada = entradaDelControlLeido(control, valores);
  if (entrada === null) return intacta('sin_estrategia_utilizable');
  const completados = [...pasos];
  completados[posicion] = { ...paso, estrategias: entrada.estrategias };
  return {
    pasos: completados,
    motivo: 'completado',
    idx: paso.idx,
    clase: entrada.claseDeElemento,
  };
}

/**
 * El cableado best-effort de lo de arriba: completa, deja el veredicto en el log y NUNCA lanza. Un
 * fallo aqui devuelve la traza intacta, o sea el comportamiento previo a este cambio: el desenlace
 * del job ya esta decidido cuando esto corre.
 */
function pasosParaPublicar(
  deps: TareaWebDeps,
  job: Job,
  corrida: { pasos: readonly PasoCensurado[]; valores: readonly string[] },
  control: ControlDeLaAccionIrreversible | null,
): readonly PasoCensurado[] {
  try {
    const completado = completarPasoDeLaAccionIrreversible(corrida.pasos, control, corrida.valores);
    // Sin control leido no hay anomalia que reportar: es toda tarea reversible y toda corrida con la
    // barrera apagada, o sea la mitad de las tareas.
    const nivel = completado.motivo === 'sin_control_leido' ? 'debug' : 'info';
    deps.logger[nivel]('tarea web: el paso de la accion irreversible y su localizador', {
      jobId: job.id,
      motivo: completado.motivo,
      paso: completado.idx,
      clase: completado.clase,
    });
    return completado.pasos;
  } catch (error) {
    deps.logger.warn(
      'tarea web: no se pudo completar el localizador del paso final (se ignora, best-effort)',
      { jobId: job.id, err: describir(error) },
    );
    return corrida.pasos;
  }
}

/** Un sitio de la tarea con su sesion YA abierta, verificada e inyectada. */
interface SitioAbierto {
  sitio: SitioConectado;
  /** Contexto DESCIFRADO de ESE sitio. Vive solo en memoria y JAMAS se comparte con otro sitio. */
  contexto: string;
  sesionExternaId: string;
  urlInicial: string;
}

/**
 * GESTOR DE SESIONES POR SITIO (multisitio). Una sesion de navegador POR SITIO, abierta LA PRIMERA
 * VEZ que el agente la necesita y cerrada al terminar la tarea.
 *
 * LO QUE NO HACE, y es el invariante central de este cambio: NO comparte nada entre sitios. Cada
 * sitio abre su propia sesion contra SU contexto externo, con SU proxy y SU pais pineado, y recibe
 * SOLO su propio contexto descifrado. Las cookies de un sitio no entran nunca en la sesion de otro:
 * no hay un unico navegador con varias pestanas, hay N sesiones aisladas en el proveedor.
 *
 * APERTURA BAJO DEMANDA: una tarea que autoriza tres sitios y termina usando uno paga UNA sesion. Es
 * la diferencia entre ofrecer sitios de mas y cobrarlos de mas.
 *
 * CIERRE: `cerrarTodas` corre en el finally del handler, con la MISMA ruta de cierre de siempre
 * (cerrarSesionBestEffort, un cierre por sesion, sin propagar). Una sesion queda registrada en cuanto
 * el proveedor la crea -- ANTES de verificar el pais y de inyectar el contexto -- para que un fallo
 * de verificacion no deje una sesion viva sin dueno.
 */
interface GestorDeSitios {
  /** Abre (o reutiliza) la sesion del sitio. Lanza igual que el camino de un solo sitio. */
  abrir(sitio: SitioConectado): Promise<SitioAbierto>;
  /**
   * CIERRA la sesion del sitio (best-effort) y abre UNA NUEVA por la misma puerta que `abrir`: mismo
   * contexto externo, mismo proxy y mismo pais pineado, con el pais observado verificado y el
   * contexto reinyectado. Es la salida del caso `resumedOk:false` de Browserbase (FIX B): una sesion
   * cuyo target CDP quedo a medio inicializar no responde a ningun comando, y continuar sobre ella
   * solo produce timeouts que despues se le atribuyen al usuario.
   */
  reabrir(sitio: SitioConectado): Promise<SitioAbierto>;
  /** El sitio autorizado con ese dominio, o undefined. */
  porDominio(dominio: string): SitioConectado | undefined;
  /** Los sitios cuya sesion llego a abrirse, en el orden en que se abrieron. */
  abiertos(): SitioAbierto[];
  /** Cierra TODAS las sesiones abiertas de la tarea. Best-effort, nunca lanza. */
  cerrarTodas(): Promise<void>;
}

function crearGestorDeSitios(
  deps: TareaWebDeps,
  job: Job,
  autorizados: readonly SitioConectado[],
  control?: ControlDeTareaWeb,
): GestorDeSitios {
  const abiertos = new Map<string, SitioAbierto>();
  const abrir = async (sitio: SitioConectado): Promise<SitioAbierto> => {
    const yaAbierto = abiertos.get(sitio.id);
    if (yaAbierto !== undefined) {
      // REUTILIZACION: volver a un sitio ya visitado NO reabre su sesion (perderia el estado de la
      // pagina y volveria a pagar la apertura). La sesion sigue viva desde la primera vez.
      control?.alCambiarSesion?.(yaAbierto.sesionExternaId);
      return yaAbierto;
    }
    if (!sitio.contextoExternoId || !sitio.proxyRef || !sitio.proxyCountry) {
      throw new PermanentExecutionError(MENSAJE_RECONECTAR);
    }
    // El contexto se descifra RECIEN AQUI y solo el de este sitio: el claro vive en memoria entre
    // el descifrado y la inyeccion, y no hay un momento en que convivan los de todos los sitios.
    const contexto = await deps.repo.obtenerContextoDescifrado(sitio.id, job.ownerId, deps.vaultSecret);
    if (contexto === null) {
      throw new PermanentExecutionError(MENSAJE_RECONECTAR);
    }
    const sesion = await deps.navegador.abrirSesionParaTarea({
      contextoExternoId: sitio.contextoExternoId,
      proxyRef: sitio.proxyRef,
      proxyCountry: sitio.proxyCountry,
    });
    const abierto: SitioAbierto = {
      sitio,
      contexto,
      sesionExternaId: sesion.sesionExternaId,
      urlInicial: `https://${sitio.dominio}/`,
    };
    // Se registra ANTES de verificar el pais: si la verificacion aborta, el finally del handler
    // tiene que poder cerrar esta sesion igual.
    abiertos.set(sitio.id, abierto);
    control?.alCambiarSesion?.(sesion.sesionExternaId);
    deps.logger.info('tarea web: sesion abierta con el pais pineado', {
      jobId: job.id,
      connectionId: sitio.id,
      dominio: sitio.dominio,
      sesionExternaId: sesion.sesionExternaId,
      pais: sesion.egressCountry,
      egressIp: sesion.egressIp,
    });

    // PAIS de salida ANTES de navegar: el pin es POR SITIO y se verifica POR SITIO. Un sitio con
    // pais distinto al pineado aborta la tarea entera y queda marcado para reconectar.
    if (sesion.egressCountry !== sitio.proxyCountry) {
      await marcarSitioBestEffort(deps, sitio, job.ownerId, 'error');
      throw new SalidaDeRedNoDisponibleError(
        `no hay ruta de red disponible para tu region (pais pineado al dominio ${sitio.dominio}: ` +
          `${sitio.proxyCountry}; pais observado: ${sesion.egressCountry ?? 'ninguno'}); la tarea NO ` +
          'se ejecuto y no se degrada a otro pais. Reintenta mas tarde o reconecta el sitio.',
      );
    }

    // Contexto (cookies) del sitio en SU sesion, y pre-chequeo de caducidad SIN modelo.
    await deps.navegador.inyectarContexto(sesion.sesionExternaId, contexto);
    const pantallaDeLogin = await deps.navegador.detectarPantallaDeLogin(
      sesion.sesionExternaId,
      abierto.urlInicial,
    );
    if (pantallaDeLogin) {
      await marcarSitioBestEffort(deps, sitio, job.ownerId, 'caducado');
      throw new PermanentExecutionError(
        `la sesion del sitio ${sitio.dominio} caduco (el sitio pide login de nuevo); ` +
          'vuelve a conectarlo desde la consola para reanudar las tareas',
      );
    }
    return abierto;
  };
  return {
    porDominio: (dominio) => autorizados.find((sitio) => sitio.dominio === dominio),
    abiertos: () => [...abiertos.values()],
    abrir,
    reabrir: async (sitio: SitioConectado): Promise<SitioAbierto> => {
      const abierto = abiertos.get(sitio.id);
      if (abierto !== undefined) {
        await cerrarSesionBestEffort(deps, abierto.sesionExternaId);
        abiertos.delete(sitio.id);
      }
      return abrir(sitio);
    },
    cerrarTodas: async (): Promise<void> => {
      for (const abierto of abiertos.values()) {
        await cerrarSesionBestEffort(deps, abierto.sesionExternaId);
      }
      abiertos.clear();
    },
  };
}

/**
 * SITIOS AUTORIZADOS de la tarea, cargados y validados ANTES de abrir una sola sesion.
 *
 * El PRIMERO es donde arranca la tarea y es innegociable: si no existe, no es del owner o no esta
 * 'activo', la tarea falla con el mensaje accionable de siempre. Los DEMAS que no esten en
 * condiciones se EXCLUYEN de la lista con un aviso, en vez de tumbar la tarea: la lista de sitios que
 * el agente ve en su prompt y la lista contra la que se autoriza un cambio tienen que ser LA MISMA, y
 * ofrecerle un sitio que no se va a poder abrir solo produce pasos tirados.
 */
async function cargarSitiosAutorizados(
  deps: TareaWebDeps,
  job: Job,
  connectionIds: readonly string[],
): Promise<SitioConectado[]> {
  const sitios: SitioConectado[] = [];
  for (const connectionId of connectionIds) {
    const sitio = await deps.repo.obtenerPorId(connectionId, job.ownerId);
    const usable =
      sitio !== null &&
      sitio.estado === 'activo' &&
      Boolean(sitio.contextoExternoId) &&
      Boolean(sitio.proxyRef) &&
      Boolean(sitio.proxyCountry);
    if (usable && sitio !== null) {
      // Un mismo dominio autorizado dos veces por conexiones distintas volveria ambiguo el destino de
      // un cambio de sitio: se queda la primera conexion, que es la que el usuario puso primero.
      if (!sitios.some((previo) => previo.dominio === sitio.dominio)) sitios.push(sitio);
      continue;
    }
    if (sitios.length === 0) {
      // Es el sitio de arranque: sin el no hay tarea.
      throw new PermanentExecutionError(MENSAJE_RECONECTAR);
    }
    deps.logger.warn('tarea web: un sitio autorizado no esta en condiciones y queda fuera de la tarea', {
      jobId: job.id,
      connectionId,
    });
  }
  return sitios;
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
  const { connectionId, objetivo, textoUsuario } = parsed.data;
  // SITIOS AUTORIZADOS de esta tarea, en orden (el primero es donde arranca). Un payload sin lista
  // autoriza exactamente uno: el de siempre.
  const connectionIds = sitiosAutorizadosDePayload(parsed.data);

  // 0.5. EL TEXTO LITERAL DEL USUARIO (CAMBIO 3). `objetivo` lo REDACTA el modelo conversacional al
  //      llamar a su tool, y en produccion parafraseo lo que el usuario habia escrito: los rotulos y
  //      las comillas del mensaje original desaparecieron y el extractor determinista, que depende
  //      justo de eso, saco 1 parametro de los 3 declarados. `textoUsuario` es el mensaje del usuario
  //      TAL CUAL, adjuntado por codigo en el backend (nunca pedido al modelo). Es la fuente de los
  //      parametros; el objetivo del modelo queda de respaldo para los jobs que no lo traigan (los
  //      encolados antes de este cambio) y sigue siendo lo unico que viaja al motor como instruccion.
  //
  //      EXCEPCION, y es de seguridad: si el texto del usuario no declara NINGUN parametro, manda el
  //      objetivo del modelo. Pasa cuando el ultimo mensaje del usuario cierra un pedido que el
  //      hizo antes ("hazlo ya", "si, dale"): ese texto no tiene datos que comparar y usarlo dejaria
  //      la verificacion con CERO comparaciones, es decir sin comparar nada, justo en los verbos que
  //      no exigen un dato fijo (comprar, borrar, publicar). Comparar contra la parafrasis del
  //      modelo es peor que comparar contra el texto del usuario, pero es mucho mejor que no
  //      comparar. Cuando el usuario SI declaro datos -- el caso de produccion -- manda su texto.
  const parametrosDelUsuario =
    textoUsuario === undefined ? 0 : contarParametrosDeclarados(extraerParametrosDeclarados(textoUsuario));
  const textoParametros = textoUsuario !== undefined && parametrosDelUsuario > 0 ? textoUsuario : objetivo;

  // 0. EL OBJETIVO, TAL COMO LLEGO. Hasta ahora no se logueaba en ningun punto, asi que una tarea
  //    que terminaba mal no se podia ni empezar a diagnosticar: no habia forma de saber que se
  //    habia pedido. Va por la CENSURA que ya se le aplica antes de persistirlo en la trayectoria
  //    (censurarObjetivo: tarjetas y credenciales dictadas quedan como [CENSURADO]). De los
  //    parametros declarados se loguean solo los NOMBRES: cuales extrajo el sistema es lo que
  //    explica un veredicto de la verificacion, y los valores no hacen falta para eso.
  deps.logger.info('tarea web: objetivo recibido', {
    jobId: job.id,
    connectionId,
    sitiosAutorizados: connectionIds.length,
    objetivo: censurarObjetivo(objetivo),
    // De donde salieron los parametros: sin esto, un extractor que devuelve menos de lo que el
    // usuario declaro es indistinguible de un usuario que declaro menos.
    conTextoDelUsuario: textoUsuario !== undefined,
    parametrosDelTextoDelUsuario: parametrosDelUsuario,
    parametros: nombresDeParametrosDeclarados(extraerParametrosDeclarados(textoParametros)),
  });

  // 1. Las conexiones deben existir, ser del owner del job y estar 'activo'. Cualquier otra cosa en
  //    la de ARRANQUE falla con el mensaje accionable ANTES de crear sesion alguna (no se gasta ni un
  //    minuto de navegador); las demas simplemente quedan fuera de la lista autorizada. Sin contexto,
  //    sin salida pineada o sin PAIS pineado (fila legada anterior a V028) no hay sesion que reanudar
  //    ni pin que verificar: reconectar el sitio pinea el pais.
  const sitiosAutorizados = await cargarSitiosAutorizados(deps, job, connectionIds);
  const sitio = sitiosAutorizados[0] as SitioConectado;
  const dominiosAutorizados = sitiosAutorizados.map((s) => s.dominio);

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
  // 2.6. UNA APROBACION LEGADA DE OFRECIMIENTO DE PLANTILLA (V041, consumo con checkpoint) NO se
  //      reanuda por `reanudarTrasDecision`: esa funcion exige la sesion de navegador VIVA porque un
  //      checkpoint clasico pausa a mitad de una accion, y el ofrecimiento pausaba ANTES de tocar el
  //      DOM. El checkpoint de plantillas YA NO EXISTE (el consumo ejecuta directo), pero un job
  //      pausado antes de ese cambio puede traer todavia su fila: se detecta por el codigo cerrado de
  //      la descripcion y se cae al camino normal, donde el cuarto peldano decide solo. Cualquier
  //      OTRA aprobacion (las de V027 de otros origenes) se reanuda exactamente como siempre.
  const aprobacionDePlantillaLegada =
    aprobacion !== null && parsearOfrecimiento(aprobacion.descripcion) !== null;
  if (aprobacion !== null && aprobacion.estado !== 'expirada' && !aprobacionDePlantillaLegada) {
    // La reanudacion es SIEMPRE de un solo sitio: el checkpoint guarda UNA sesion y esa sesion es de
    // UN sitio. Su contexto se descifra aqui, igual que antes.
    const contexto = await deps.repo.obtenerContextoDescifrado(sitio.id, job.ownerId, deps.vaultSecret);
    if (contexto === null) {
      throw new PermanentExecutionError(MENSAJE_RECONECTAR);
    }
    return reanudarTrasDecision(deps, job, sitio, objetivo, credential, contexto, aprobacion, control);
  }

  // 2.7. DETECCION DETERMINISTA (D2a) sobre el TEXTO DEL USUARIO: si el objetivo contiene un verbo de
  //      accion bloqueada, la corrida lleva GUARDIA y ninguna accion que corresponda a ese verbo
  //      llega al navegador sin que el worker compare antes. Solo aplica a la corrida INICIAL: en una
  //      reanudacion el humano ya decidio sobre este objetivo.
  //      El texto LITERAL del usuario manda (CAMBIO 3) y el objetivo del modelo queda como red: la
  //      union de los dos es lo unico seguro, porque perder el verbo por una parafrasis dejaria la
  //      corrida ENTERA sin guardia, que es el falso negativo inaceptable.
  const verboBloqueado = detectarVerboBloqueado(textoParametros) ?? detectarVerboBloqueado(objetivo);
  if (verboBloqueado !== null) {
    deps.logger.info('tarea web: el objetivo contiene una accion bloqueada; se verificara antes de ejecutar', {
      jobId: job.id,
      connectionId: sitio.id,
      verbo: verboBloqueado,
    });
  }

  // 2.8. POLITICA DE EJECUCION del owner (D3): se lee UNA vez, al INICIO de la tarea, y no se
  //      vuelve a preguntar nada durante la ejecucion. null = no se pudo leer -> la verificacion
  //      detiene la accion (falla cerrada).
  const politica = await leerPoliticaVigente(deps, job.ownerId);

  // 2.9. TRAZA ACUMULADA de todo el job: la corrida del motor la va llenando y, si la tarea termina
  //      bien, es lo que se promueve a receta. El paso de verificacion entra en el LUGAR en que
  //      ocurrio, para que la receta aprenda a volver a comparar justo antes de la accion (D7).
  const pasosDelJob: PasoCensurado[] = [];

  // 3. GESTOR DE SESIONES POR SITIO: una sesion por sitio, abierta LA PRIMERA VEZ que hace falta.
  //    La del sitio de ARRANQUE se abre ya (es donde corre el primer tramo); las de los demas sitios
  //    autorizados NO se abren hasta que el agente pida cambiar a ellos, asi una tarea que termina
  //    usando un solo sitio no paga por los otros. Cada apertura reconecta el contexto de SU sitio y
  //    fuerza SU proxy con SU pais pineado (SalidaDeRedNoDisponibleError si el pin no es reconstruible).
  const gestor = crearGestorDeSitios(deps, job, sitiosAutorizados, control);
  // ESTADO POR SITIO del cupo de accion irreversible. Vive fuera de las guardias porque una tarea
  // multisitio crea una guardia por tramo y el cupo NO se reabre al volver a un sitio ya visitado.
  const registro: RegistroDeSitios = crearRegistroDeSitios();
  // TELEMETRIA DE LA GUARDIA SIN INTENCION (D3): la comparte la corrida entera -- los tres caminos y
  // todos los tramos multisitio -- porque lo que se reporta al final es cuantas acciones de ESTA
  // tarea habrian sido detenidas, no cuantas de un tramo.
  const observacion = crearObservacionDeLaGuardia();

  // ATLAS DE SITIOS (V040): lo que la plataforma ya observo de la ESTRUCTURA de los dominios que esta
  // tarea autoriza, ya filtrado por la regla de corroboracion contra el origen de esta corrida. Se lee
  // UNA sola vez, antes de abrir ninguna sesion, y alimenta los DOS inyectores: el mapa que viaja al
  // contexto de percepcion del motor libre y las pistas de localizacion del ejecutor de recetas.
  // Best-effort: sin cableado o sin entradas servibles, la tarea corre exactamente como antes de V040.
  const atlas = await crearLectorDelAtlas(deps, job, dominiosAutorizados);

  // Las sesiones de la corrida INICIAL se cierran SIEMPRE: la verificacion determinista resuelve en
  // la misma corrida (ejecuta o detiene) y ya no queda nadie esperando para decidir sobre esas
  // paginas. La sesion que SI sobrevive es la de un checkpoint de aprobacion humana, y esa la abre y
  // la cierra el camino de reanudacion (reanudarTrasDecision).
  try {
    // 4 y 5. Apertura del sitio de arranque: verificacion del PAIS antes de navegar, inyeccion del
    //        contexto y PRE-CHEQUEO de caducidad sin modelo (todo dentro del gestor, y por sitio).
    let activo = await gestor.abrir(sitio);

    // 5.5. CAMINO POR RECETA (CAMBIO 5): si este owner ya hizo esta misma tarea con exito con este
    //      mismo CONJUNTO de sitios, se repite lo aprendido SIN llamar al modelo. Si la receta se
    //      agota (el sitio cambio demasiado, D6), se sigue con el motor en LA MISMA sesion, sin
    //      reabrir nada, pero NUNCA sobre la pagina que la receta dejo a medio camino: se renavega a
    //      la URL de inicio antes de arrancar el motor, y si eso no se puede, la tarea se corta.
    //
    //      LA FIRMA EXACTA ES LA VIA RAPIDA (CAMBIO 3): si coincide, no se consulta a nadie. Solo
    //      cuando NO coincide se le pregunta al modelo, UNA vez, cual de las tareas que el usuario ya
    //      enseno corresponde a lo que pidio -- porque pedir lo mismo con otras palabras es lo normal
    //      y la firma no lo perdona. Los datos que el modelo resuelva se ejecutan y se verifican con
    //      las MISMAS reglas: no hay un camino privilegiado.
    const rapida = await buscarRecetaAplicable(
      deps,
      job,
      sitio,
      objetivo,
      textoParametros,
      verboBloqueado,
      dominiosAutorizados,
    );
    const elegida =
      rapida !== null
        ? null
        : await elegirTareaEnsenada(
            deps,
            job,
            textoParametros,
            verboBloqueado,
            dominiosAutorizados,
            credential.apiKey,
            control,
          );
    const receta = rapida ?? elegida?.receta ?? null;
    // ¿ALGUNA sonda pre-flight de esta corrida detecto un desajuste de interfaz? Es lo que el cierre
    // registra en el resultado (D6): el usuario debe poder ver que el sitio cambio y que su agente
    // se adapto solo.
    let huboDesajusteDeInterfaz = false;
    if (receta !== null) {
      // La tarea ensenada puede vivir en OTRO de los sitios autorizados: alli es donde hay que
      // ejecutarla, con su propia sesion. El sitio de arranque sigue siendo el del camino rapido.
      const sitioDeLaReceta = gestor.porDominio(receta.dominio) ?? sitio;
      const abierto =
        sitioDeLaReceta.id === activo.sitio.id ? activo : await gestor.abrir(sitioDeLaReceta);
      // SONDA DE RECONOCIMIENTO PREVIA (D1): con la pagina de partida cargada y ANTES del primer
      // paso, se comprueba que las clases observables de la receta existan en la pagina. Con
      // desajuste NO se ejecuta ningun paso: la tarea pasa al motor libre con la pagina limpia (no
      // se toco el DOM) y la siguiente corrida exitosa promueve la receta de la interfaz vigente,
      // que reemplaza a esta (promover ya marca obsoleta la anterior).
      const sondaDeReceta = await sondearInterfazBestEffort(
        deps,
        job,
        abierto.sesionExternaId,
        abierto.sitio.dominio,
        receta.pasos,
      );
      if (sondaDeReceta.tipo === 'desajuste') {
        huboDesajusteDeInterfaz = true;
        deps.logger.warn('tarea web: la tarea aprendida no coincide con la interfaz actual; se sigue con el motor', {
          jobId: job.id,
          connectionId: abierto.sitio.id,
          dominio: abierto.sitio.dominio,
          recetaId: receta.id,
          motivo: 'desajuste_de_interfaz',
        });
      } else {
      const porReceta = await ejecutarPorReceta(deps, job, abierto.sitio, objetivo, abierto.sesionExternaId, receta, {
        politica,
        verboBloqueado,
        textoParametros,
        contexto: abierto.contexto,
        apiKey: credential.apiKey,
        control,
        // Una receta multisitio cambia de sesion sola. El destino se resuelve contra la lista
        // AUTORIZADA de ESTE job: una receta que nombre un sitio que esta tarea no autoriza se
        // abandona y la tarea la termina el motor.
        gestor,
        atlas,
        observacion,
        ...(elegida !== null
          ? { datos: { valores: elegida.valores, parametros: elegida.parametros } }
          : {}),
      });
      if (porReceta.tipo === 'completada') return 'completada';
      if (porReceta.paginaTocada) {
        // D2 (resiliencia): el reset previo al motor es OBLIGATORIO tambien aqui, igual que tras
        // una plantilla ajena, y sobre TODOS los sitios que la receta llego a tocar (una receta
        // multisitio pudo dejar a medio camino la pagina de otro sitio): descarte generico del
        // estado a medio llenar (Escape sobre el foco, sin un solo selector de ningun sitio),
        // renavegacion al inicio y, si la sesion no responde, reapertura con el mismo pais pineado
        // en vez de entregarle al motor una sesion degradada. Hasta este cambio el reset era solo
        // la renavegacion tolerante, que ante dos timeouts se omitia y el motor arrancaba sobre la
        // pagina a medio camino.
        activo = await resetObligatorioPrevioAlMotor(deps, job, gestor, activo);
      }
      }
    }

    // 5.6. CUARTO PELDANO: UN PROCEDIMIENTO QUE DESCUBRIO OTRA CUENTA (V041, consumo). Corre SOLO
    //      cuando las dos vias PROPIAS no devolvieron nada (`receta === null`), y esa precedencia es
    //      de control de flujo: con una receta propia en la mano la tabla global ni se consulta. Corre
    //      ademas ANTES del motor libre, que es la linea base a la que se vuelve ante cualquier duda.
    //
    //      SIN CHECKPOINT DE APROBACION HUMANA, por decision de producto: el consentimiento vive en
    //      los documentos legales que el usuario acepto al conectar sitios, y la proteccion en runtime
    //      es TECNICA. Si `buscarServible` encuentra plantilla y `plantillaAplicable` pasa, se ejecuta
    //      DIRECTO. A cambio, la transparencia es obligatoria: el resultado del job y la tarjeta de
    //      /actividad llevan la etiqueta de que la tarea uso un procedimiento aprendido por otra
    //      cuenta (via 'plantilla_compartida' + plantillaAjena.consumida).
    //
    //      LIMITE DOCUMENTADO (no implementado a proposito): sin humano en el circuito, la defensa
    //      contra una plantilla MALICIOSA es la cadena tecnica de plantillaAplicable y del ejecutor:
    //       - contrato cerrado sin valores, sin xpath y sin rutas (parsearPasosPublicables);
    //       - dominio por paso igual a la conexion sobre la que se ejecuta;
    //       - clase corroborada en el atlas DEL CONSUMIDOR en todos los pasos con elemento, y clase
    //         declarada igual a la que producen las propias estrategias del paso;
    //       - blindaje estructural: exactamente UN click de la familia del verbo, ultimo paso, con
    //         `verificar` inmediatamente antes (estructura_no_permitida);
    //       - barrera de identidad en modo 'activa' en todos los pasos, escalada deshabilitada y
    //         apiKey vacia, verificacion determinista con los datos anclados al texto del usuario;
    //       - retiro automatico a los 3 fallos imputables consecutivos (unica defensa contra
    //         plantillas rotas) y corroboracion por origenes y consumidores distintos.
    //      La corroboracion por hashes es VULNERABLE A SYBIL: quien controle varias cuentas puede
    //      fabricar origenes y consumidores "distintos". Se deja constancia y no se agrega ninguna
    //      defensa nueva fuera de las anteriores.
    //
    //      El veredicto se registra SIEMPRE, se haya consumido o no: es el campo de diagnostico que
    //      responde "por que esta corrida no uso el procedimiento compartido" sin una auditoria.
    //
    //      DOS ESCALONES PARA LOS DATOS (FIX E). El extractor determinista PRIMERO: si con lo que saca
    //      se encuentra una plantilla, se usa, y cuesta cero tokens igual que hasta hoy. Solo si NO
    //      alcanza -- y solo por un motivo que un dato mas pueda arreglar -- se le pregunta al modelo
    //      UNA vez, con el mismo anclaje al texto del usuario que ya usa la eleccion entre tareas
    //      propias. Lo que resuelva pasa por las mismas puertas que todo lo demas.
    let parametrosDelObjetivo = extraerParametrosDeclarados(textoParametros);
    let valoresDelObjetivo = valoresDeParametros(parametrosDelObjetivo);
    // EL VERBO EFECTIVO de la corrida (D2, restriccion 2): la deteccion determinista es el PISO y la
    // interpretacion solo puede AGREGAR un verbo donde la regex no vio ninguno. Todo lo que viene
    // despues del peldano de consumo -- la guardia, la barrera, los cortes de cierre y la
    // publicacion -- habla de este verbo: mas verificacion que hoy, jamas menos.
    let verboEfectivo = verboBloqueado;
    // LA RESOLUCION DE LA CORRIDA (D4): se calcula UNA vez aqui y, cuando existe, la reutiliza la
    // publicacion del cierre exitoso. null = no hubo interpretacion resuelta y la publicacion deriva
    // sus marcadores con el extractor, exactamente como hoy.
    let resolucionDeLaCorrida: { valores: ValoresDeParametros } | null = null;
    let veredictoDeConsumo: VeredictoDeConsumo = {
      consumida: false,
      // El unico motivo que se decide antes de mirar la tabla: alguna via propia ya resolvio. En
      // cualquier otro caso lo reemplaza la busqueda de abajo.
      motivo: 'via_propia',
      idx: null,
    };
    if (receta === null) {
      let consulta = await buscarPlantillaAjena(deps, job, activo.sitio, atlas, {
        dominios: dominiosAutorizados,
        verboBloqueado,
        valores: valoresDelObjetivo,
      });
      let interpretacion: MotivoDeInterpretacion = 'no_intentada';
      let intencionInterpretada: CodigoDeIntencion | null = null;
      if (
        consulta.plantillas.length === 0 &&
        missQueLaInterpretacionArregla(consulta.veredicto.motivo, verboBloqueado)
      ) {
        const interpretada = await interpretarObjetivo(deps, job, {
          textoParametros,
          verboBloqueado,
          delExtractor: valoresDelObjetivo,
          apiKey: credential.apiKey,
          control,
        });
        interpretacion = interpretada.motivo;
        if (interpretada.datos !== null) {
          // LOS DATOS DE LA CORRIDA pasan a ser estos, PARA LOS DOS LADOS a la vez: lo que la
          // plantilla teclea y lo que la verificacion determinista compara contra la pagina. Que no
          // puedan divergir es lo que impide verificar contra una cosa y escribir otra.
          valoresDelObjetivo = interpretada.datos.valores;
          parametrosDelObjetivo = interpretada.datos.parametros;
          intencionInterpretada = interpretada.intencion;
          // LA INTENCION AGREGADA (D2): convierte la corrida en irreversible A EFECTOS DE
          // VERIFICACION. Nunca al reves: con verbo de la regex, `interpretada.intencion` es null
          // por construccion y el piso queda intacto.
          verboEfectivo =
            verboBloqueado ??
            (interpretada.intencion !== null ? verboDeIntencion(interpretada.intencion) : null);
          resolucionDeLaCorrida = { valores: valoresDelObjetivo };
          consulta = await buscarPlantillaAjena(deps, job, activo.sitio, atlas, {
            dominios: dominiosAutorizados,
            verboBloqueado: verboEfectivo,
            valores: valoresDelObjetivo,
          });
        }
      }
      veredictoDeConsumo =
        interpretacion === 'no_intentada'
          ? consulta.veredicto
          : {
              ...consulta.veredicto,
              interpretacion,
              // D5: el detalle de la interpretacion, en vocabulario cerrado. Solo NOMBRES de datos y
              // el codigo de intencion: ni un valor del usuario.
              ...(intencionInterpretada !== null ? { intencionInterpretada } : {}),
              ...(resolucionDeLaCorrida !== null
                ? { datosInterpretados: Object.keys(resolucionDeLaCorrida.valores).sort() }
                : {}),
            };
      // SONDA DE RECONOCIMIENTO PREVIA (D1) sobre cada candidata aplicable, en el orden del
      // desempate (D5, coexistencia de variantes): la primera cuyas clases observables SI estan en
      // la pagina de enfrente se ejecuta; cada una desajustada queda registrada con su propio
      // contador (D4) y se descarta SIN tocar el DOM. Si ninguna coincide, la tarea sigue por el
      // motor libre con la pagina limpia: la sonda es de solo lectura.
      let candidata: PlantillaParaEstaTarea | null = null;
      for (const viable of consulta.plantillas) {
        const sondaDePlantilla = await sondearInterfazBestEffort(
          deps,
          job,
          activo.sesionExternaId,
          activo.sitio.dominio,
          viable.pasos,
        );
        if (sondaDePlantilla.tipo === 'desajuste') {
          huboDesajusteDeInterfaz = true;
          veredictoDeConsumo = { consumida: false, motivo: 'desajuste_de_interfaz', idx: null };
          await registrarDesajusteDePlantillaBestEffort(deps, job, viable.id);
          continue;
        }
        candidata = viable;
        break;
      }
      if (candidata !== null) {
        // EJECUCION DIRECTA, sin ofrecimiento y sin pausa: las puertas tecnicas ya pasaron todas.
        const porPlantilla = await ejecutarPorPlantilla(
          deps,
          job,
          activo.sitio,
          objetivo,
          activo.sesionExternaId,
          candidata,
          {
            politica,
            // El verbo EFECTIVO (piso de la regex + intencion agregada): es lo que la barrera y la
            // verificacion de la plantilla comparan, y nunca es menos que el de la regex.
            verboBloqueado: verboEfectivo,
            textoParametros,
            contexto: activo.contexto,
            dominios: dominiosAutorizados,
            valores: valoresDelObjetivo,
            parametros: parametrosDelObjetivo,
            control,
            atlas,
            observacion,
          },
        );
        if (porPlantilla.tipo === 'completada') {
          await deps.guardarResultado(job.id, {
            estado: 'ok',
            resumen: 'tarea completada con un procedimiento que descubrio otra cuenta',
            via: 'plantilla_compartida',
            tokensIn: 0,
            tokensOut: 0,
            sesionExternaId: activo.sesionExternaId,
            // LA ETIQUETA DE TRANSPARENCIA: consumida + el estado de la fila que se uso, para que
            // /actividad pueda decir "procedimiento de otra cuenta" (y "corroborado" cuando lo es)
            // sin exponer nada mas de la tabla.
            plantillaAjena: { consumida: true, motivo: null, idx: null, estado: candidata.estado },
            // D6 (resiliencia): una variante coexistente se descarto por desajuste antes de que
            // esta se ejecutara. El sitio cambio para parte de sus usuarios y el agente lo noto.
            ...(huboDesajusteDeInterfaz ? { desajusteDeInterfaz: true } : {}),
            // D4 (guardia sin intencion): la misma constancia que deja el cierre por motor.
            ...escalarDeLaObservacion(observacion, deps.guardiaSinIntencion ?? 'apagada'),
          });
          return 'completada';
        }
        veredictoDeConsumo = { consumida: false, motivo: 'abandonada', idx: null };
        if (porPlantilla.paginaTocada) {
          // FIX B, generalizado por D2: el reset OBLIGATORIO previo al motor, el mismo que corre
          // tras una receta que toco la pagina: se descarta el estado a medio llenar, se navega al
          // inicio y, si la sesion no responde, se abre una nueva en vez de una degradada.
          activo = await resetObligatorioPrevioAlMotor(deps, job, gestor, activo);
        }
      }
    }
    deps.logger.info('tarea web: veredicto del procedimiento compartido', {
      jobId: job.id,
      dominio: activo.sitio.dominio,
      desajusteDeInterfaz: huboDesajusteDeInterfaz,
      ...veredictoDeConsumo,
    });

    // 6. Ejecutar el objetivo ENTERO con el motor de navegacion, bajo el deadline de pared del worker
    //    y el cap DURO de pasos, con la GUARDIA interpuesta: la accion irreversible se verifica
    //    dentro de esta misma corrida, justo antes de llegar al navegador. La ejecucion queda
    //    REGISTRADA como trayectoria (V030) sea cual sea el desenlace.
    //
    //    MULTISITIO: el bucle del agente esta atado a la sesion en la que arranca, asi que un cambio
    //    de sitio TERMINA el tramo y aqui empieza otro sobre la sesion del destino. El presupuesto de
    //    pasos y el deadline de pared son de la TAREA, no del tramo: repartirlos por tramo
    //    multiplicaria por el numero de sitios lo que la tarea puede gastar. Con un solo sitio hay un
    //    solo tramo y el presupuesto entero es suyo, exactamente como antes de este cambio.
    const cambiador: CambiadorDeSitio | undefined =
      dominiosAutorizados.length > 1
        ? {
            dominios: dominiosAutorizados,
            solicitar: (dominio: string): ResolucionDeDominio =>
              resolverDominioAutorizado(dominio, dominiosAutorizados),
          }
        : undefined;
    const systemPrompt = construirSystemPromptTareaWeb(dominiosAutorizados);
    const finEnMs = Date.now() + deps.runTimeoutMs;
    let instruccion = objetivo;
    let pasosRestantes = deps.maxPasos;
    let cambios = 0;
    let guardia: GuardiaDeTareaWeb;
    let resultado: ResultadoMotor;
    let desenlace: DesenlaceTareaWeb;
    // El control de la accion irreversible sobrevive al cambio de tramo: la guardia se crea de nuevo
    // en cada uno y la accion pudo consumarse en un sitio del que la tarea despues se fue.
    let controlAccionado: ControlDeLaAccionIrreversible | null = null;

    for (;;) {
      guardia = crearGuardiaDeAccion(deps, job, activo.sitio, activo.sesionExternaId, {
        politica,
        // EL VERBO EFECTIVO (D2, restriccion 2): el de la regex cuando existe (el piso, intacto) y el
        // de la intencion interpretada solo cuando la regex no vio ninguno. La interpretacion es un
        // DISPARADOR ADICIONAL de verificacion, jamas un supresor: no hay rama que pase null aqui
        // cuando la deteccion determinista detecto un verbo.
        verboBloqueado: verboEfectivo,
        textoParametros,
        // FIX A: el texto del usuario, con el objetivo del modelo conversacional sumado como
        // respaldo (los jobs viejos no traen el literal). Es contra esto, y nunca contra lo que el
        // agente escriba en cada paso, que se resuelve el permiso para accionar la ventana.
        objetivoDelUsuario: `${textoUsuario ?? ''} ${objetivo}`,
        control,
        estado: registro.estadoDe(activo.sitio.id),
        // BARRERA DE IDENTIDAD DEL ELEMENTO (TAREA_WEB_BARRERA_IDENTIDAD): el MISMO cableado que
        // recibe la ejecucion por receta, con las clases que el atlas ya tiene en memoria. En
        // 'observacion' (default del env) solo registra su veredicto y el desenlace de la corrida es
        // identico al de hoy.
        barreraIdentidad: {
          modo: deps.barreraIdentidad ?? 'apagada',
          clasesCorroboradas: (dominio: string): ReadonlySet<string> =>
            atlas?.clasesCorroboradas(dominio) ?? new Set<string>(),
        },
        // GUARDIA SIN INTENCION RECONOCIDA (TAREA_WEB_GUARDIA_SIN_INTENCION): el acumulador de la
        // corrida entera, no el del tramo. El modo lo lee la guardia de `deps`.
        observacion,
      });
      const enCurso = activo;
      try {
        ({ resultado, desenlace } = await ejecutarMotorConRegistro(
          deps,
          job,
          enCurso.sitio,
          objetivo,
          enCurso.sesionExternaId,
          credential.apiKey,
          { objetivo: instruccion, systemPrompt },
          control?.signal,
          guardia,
          pasosDelJob,
          {
            cambiador,
            maxPasos: pasosRestantes,
            timeoutMs: Math.max(0, finEnMs - Date.now()),
            // ATLAS DE SITIOS (V040): el mapa del sitio en el que corre ESTE tramo. Se recalcula por
            // tramo porque una tarea multisitio cambia de dominio, y el mapa es por dominio. Vacio
            // cuando no hay entradas servibles para este origen: el contexto queda como antes.
            mapaDelSitio: bloqueDelMapa(atlas?.entradasDe(enCurso.sitio.dominio) ?? []),
          },
        ));
      } catch (error) {
        // CIERRE ORDENADO DE UN BLOQUEO (CAMBIO 3): la guardia detuvo la accion, asi que la corrida
        // TERMINA -- pero termina como una tarea que llego a un desenlace, no como una que se cayo a
        // medias. La trayectoria completa ya quedo guardada (ejecutarMotorConRegistro) y aqui se
        // escriben el resultado del job y el contexto de la sesion ANTES de propagar el cierre. Sin
        // esto, el unico rastro del bloqueo era el last_error y la corrida quedaba sin resultado.
        await cerrarCorridaDetenida(
          deps,
          job,
          enCurso.sitio,
          enCurso.sesionExternaId,
          enCurso.contexto,
          guardia,
        );
        throw error;
      }
      controlAccionado = guardia.controlAccionado() ?? controlAccionado;

      const cambio = resultado.cambioDeSitio ?? null;
      if (cambio === null) break;

      // El presupuesto de pasos consumido en este tramo NO vuelve: es de la tarea entera.
      pasosRestantes = Math.max(0, pasosRestantes - resultado.acciones.length);
      cambios += 1;
      const destino = gestor.porDominio(cambio.dominio);
      if (destino === undefined) {
        // Imposible por construccion (el destino ya se resolvio contra la lista autorizada), pero es
        // la clase de invariante que no se deja implicita en una superficie de seguridad.
        throw new PermanentExecutionError(
          'el agente pidio cambiar a un sitio que esta tarea no autoriza; la tarea NO continua',
        );
      }
      // Los dos topes se nombran POR SEPARADO: decir "agoto los cambios de sitio" cuando lo que se
      // agoto fueron los pasos manda al usuario a diagnosticar lo que no fue.
      if (cambios > MAX_CAMBIOS_DE_SITIO_POR_TAREA) {
        deps.logger.warn('tarea web: la tarea agoto su presupuesto de cambios de sitio', {
          jobId: job.id,
          cambios,
          pasosRestantes,
        });
        throw new PermanentExecutionError(
          `la tarea cambio de sitio ${cambios} veces sin completarse (el tope es ` +
            `${MAX_CAMBIOS_DE_SITIO_POR_TAREA}) y se corto para no seguir recorriendo las cuentas ` +
            'del usuario; no se reintenta automaticamente',
        );
      }
      if (pasosRestantes === 0) {
        deps.logger.warn('tarea web: la tarea agoto su limite de pasos al cambiar de sitio', {
          jobId: job.id,
          cambios,
        });
        throw new PermanentExecutionError(
          `la tarea agoto el limite de pasos configurado (${deps.maxPasos}) antes de terminar en el ` +
            'otro sitio; no se reintenta automaticamente para no repetir acciones sobre la cuenta ' +
            'del usuario',
        );
      }
      const anterior = activo.sitio.dominio;
      // APERTURA BAJO DEMANDA (o reutilizacion si ya se visito este sitio).
      activo = await gestor.abrir(destino);
      instruccion = construirContinuacionEnOtroSitio({
        objetivo,
        dominioAnterior: anterior,
        dominioNuevo: activo.sitio.dominio,
        resumenPrevio: cambio.resumen,
      });
      deps.logger.info('tarea web: el agente cambio a otro sitio autorizado de la tarea', {
        jobId: job.id,
        connectionId: activo.sitio.id,
        dominio: activo.sitio.dominio,
        cambios,
        pasosRestantes,
      });
    }

    if (desenlace.tipo === 'sesion_caducada') {
      await marcarSitioBestEffort(deps, activo.sitio, job.ownerId, 'caducado');
      throw new PermanentExecutionError(
        `la sesion del sitio ${activo.sitio.dominio} caduco a mitad de la tarea (aparecio una ` +
          'pantalla de login o verificacion); vuelve a conectarlo desde la consola para reanudar las tareas',
      );
    }

    // 7. DONE PREMATURO (CAMBIO 3): el objetivo pedia una accion bloqueada y la tarea termino sin
    //    que esa accion pasara por la guardia EN NINGUNO de sus sitios. No se ejecuto y tampoco la
    //    detuvo el sistema: el agente se paro solo. Causa PROPIA y mensaje propio, distinto del fallo
    //    generico del motor. Un desenlace 'requiere_aprobacion' cuenta como lo mismo: el prompt ya no
    //    pide ese marcador, asi que emitirlo es exactamente pararse solo ante la accion.
    //    EXCEPCION: si la senal externa ya aborto, el job dejo de ser 'running' porque su dueno lo
    //    TERMINO desde la consola; ahi no hay nada que diagnosticar.
    // El corte usa el VERBO EFECTIVO: una intencion que la interpretacion agrego (D2) exige el mismo
    // cierre veraz que una detectada por la regex. Es un disparador mas, nunca un supresor.
    if (
      verboEfectivo !== null &&
      !registro.algunaAutorizada() &&
      (desenlace.tipo === 'requiere_aprobacion' || resultado.completado) &&
      control?.signal?.aborted !== true
    ) {
      const faltantes = guardia.faltantes();
      deps.logger.warn('tarea web: el agente termino sin ejecutar la accion que el objetivo pedia', {
        jobId: job.id,
        connectionId: activo.sitio.id,
        verbo: verboEfectivo,
        faltantes,
      });
      throw new PermanentExecutionError(
        faltantes === null
          ? describirAccionNoVerificada(verboEfectivo, resultado, deps.maxPasos)
          : describirDatosNuncaCompletados(verboEfectivo, faltantes, resultado, deps.maxPasos),
      );
    }

    if (desenlace.tipo === 'requiere_aprobacion' || !resultado.exito) {
      // FALTA DE ACCESO AL MODELO: `agent.execute` de Stagehand ATRAPA todo fallo que no sea un abort
      // y lo devuelve como un resultado sin exito (v3AgentHandler), asi que por este camino no llega
      // el error crudo sino su TEXTO. La marca que el middleware de modelo planto en el mensaje es lo
      // unico que sobrevive, y se exige exactamente esa marca (nunca frases sueltas: el mensaje final
      // del agente puede arrastrar contenido de la pagina). Va ANTES del mensaje generico: decir
      // "la tarea se detuvo sin exito" cuando lo que paso es que la llave se quedo sin saldo manda al
      // usuario a diagnosticar un objetivo que estaba bien.
      const sinAcceso = corteDeAccesoAlModelo(deps, job, activo.sitio, resultado);
      if (sinAcceso !== null) throw sinAcceso;
      // BUG C: mensaje VERAZ por causa (limite real de pasos / DONE sin cumplir / otro corte),
      // siempre con los pasos consumidos y el limite configurado.
      throw new PermanentExecutionError(describirFalloDelMotor(resultado, deps.maxPasos));
    }

    // ACCION SIN EFECTO CONFIRMADO (FIX A): si una accion irreversible salio al navegador y su
    // efecto nunca se confirmo, la tarea NO puede cerrarse como exitosa aunque el agente haya
    // terminado con DONE (por ejemplo, tras recibir el aviso terminal de la guardia). Tampoco se
    // promueve receta de una corrida asi: repetirla repetiria el paso sin confirmar.
    if (verboEfectivo !== null && registro.algunaSinConfirmar()) {
      deps.logger.warn('tarea web: la corrida termino con la accion irreversible sin efecto confirmado', {
        jobId: job.id,
        connectionId: activo.sitio.id,
        dominio: activo.sitio.dominio,
      });
      throw new AccionSinEfectoConfirmadoError(MENSAJE_SIN_CONFIRMAR);
    }

    // 8. Exito: guardar el contexto ACTUALIZADO (re-cifrado) + refrescar ultimo_uso_en de CADA sitio
    //    que la tarea uso, no solo del ultimo: la sesion de un sitio visitado a mitad de camino
    //    tambien avanzo y sus cookies nuevas son las que evitan que caduque antes de tiempo.
    for (const abierto of gestor.abiertos()) {
      await refrescarContextoBestEffort(
        deps,
        abierto.sitio,
        job.ownerId,
        abierto.sesionExternaId,
        abierto.contexto,
      );
    }
    // PROMOCION AUTOMATICA (CAMBIO 3): lo que acaba de funcionar queda aprendido para la proxima.
    // La corrida del motor siempre arranca desde la pagina de inicio (una receta que se rindio a
    // medias renavega antes), asi que su traza describe la tarea entera y es promovible.
    await promoverRecetaBestEffort(
      deps,
      job,
      sitio,
      objetivo,
      pasosDelJob,
      // El verbo EFECTIVO: si la interpretacion agrego una intencion, la receta que quede exige su
      // paso de verificacion igual que si el verbo hubiera venido de la regex. Nunca exige menos.
      verboEfectivo,
      dominiosAutorizados,
    );
    // ATLAS DE SITIOS (V040): esta corrida llego hasta aqui, o sea que salio bien Y -- si pedia una
    // accion irreversible -- su efecto quedo CONFIRMADO (los dos cortes de arriba). Sus pasos
    // exitosos son evidencia de como esta hecho cada sitio que uso, asi que se agregan anonimos al
    // aprendizaje comun. Va DESPUES de la promocion y con la misma regla: aprender es una mejora, no
    // parte del desenlace, y su fallo se traga adentro.
    //
    // Las estrategias del motor libre las lee la PERCEPCION, en la evaluacion que ya corre despues
    // de cada paso, y llegan en un campo aparte para no alterar en nada lo que ve la promocion de
    // arriba: `pasosConEstrategiasPercibidas` es el unico punto donde se pasan a donde el agregador
    // las busca.
    const corridaLibre = {
      dominio: sitio.dominio,
      pasos: pasosConEstrategiasPercibidas(pasosDelJob),
      valores: valoresTecleadosDeLaCorrida(
        valoresDeParametros(extraerParametrosDeclarados(textoParametros)),
        pasosDelJob,
      ),
    };
    const entradasLibres = entradasDeCorridaLibre(corridaLibre);
    // OBSERVABILIDAD (29 jul 2026): una corrida exitosa que clickea y escribe y NO deja nada en el
    // aprendizaje comun es una anomalia, y hasta hoy salia sin una sola linea de log porque
    // `registrarEnAtlasBestEffort` corta antes de escribir cuando la lista viene vacia. El resumen
    // dice en cual de los filtros se perdio el dato, que es lo que hubo que reconstruir a mano.
    if (entradasLibres.length === 0) {
      deps.logger.info('tarea web: la corrida del motor no dejo nada para el aprendizaje comun', {
        jobId: job.id,
        dominio: sitio.dominio,
        ...resumenDeCorridaLibre(corridaLibre),
      });
    }
    // EL CONTROL DE LA ACCION IRREVERSIBLE, que la traza no puede aportar porque la accion se lleva
    // por delante su propio elemento: lo aporta lo que la barrera LEYO justo antes de accionarlo (ver
    // entradasDelControlAccionado). Va con las demas y por la misma puerta.
    await registrarEnAtlasBestEffort(deps, job, [
      ...entradasLibres,
      ...entradasDelControlAccionado(
        deps,
        job,
        controlAccionado,
        corridaLibre.valores,
        entradasLibres,
      ),
    ]);
    // PLANTILLAS COMPARTIDAS (V041): la version ANONIMA del procedimiento que esta corrida acaba de
    // demostrar. Va AQUI, en la rama de cierre exitoso del motor libre, y no colgando de la promocion
    // de receta: ese era el unico punto de llamada del repo y estaba en un camino muerto, porque la
    // promocion no promueve nada con el observador de pasos apagado (el default de produccion) y sin
    // receta propia la publicacion se cortaba. La publicacion se decide ahora por su cuenta, sobre
    // `corridaLibre.pasos`, que es la MISMA fuente que el atlas: las clases se leen del DOM.
    //
    // POR QUE ESTA POSICION Y NO OTRA: DESPUES de los dos cortes de arriba, asi que la corrida llego
    // hasta aqui solo si salio bien Y -- si pedia una accion irreversible -- su efecto quedo
    // CONFIRMADO; y ANTES de `guardarResultado`, que es donde el veredicto queda registrado. Que vaya
    // despues del agregador del atlas no cambia nada: `clasesParaPublicar` lee la instantanea que
    // `crearLectorDelAtlas` dejo en memoria al arrancar la tarea, asi que una clase corroborada por
    // ESTA corrida recien esta disponible para la SIGUIENTE.
    //
    // SE PUBLICA AUNQUE EL USUARIO NO CONSERVE UNA RECETA PROPIA, y es una decision de politica
    // tomada a proposito. Conservar la receta depende hoy de una palanca de COSTO (el observador de
    // pasos, que abre una conexion CDP mas por accion), no de ningun juicio sobre el procedimiento.
    // Lo que respalda a lo que se publica es otra cosa y sigue intacta: la corrida llego a esta linea
    // con el efecto irreversible confirmado, cada clase sigue exigiendo el aval de dos origenes
    // INDEPENDIENTES (`clasesParaPublicar`), lo que sale pasa por `esPublicable` en el worker y otra
    // vez en el backend, y el alcance esta declarado en los documentos legales vigentes.
    //
    // EL CLICK FINAL LLEGA AQUI CON SU LOCALIZADOR, y es lo unico que esta lista tiene de mas que la
    // que alimenta al atlas: el paso que consumo la accion irreversible se completa con lo que la
    // barrera LEYO del DOM justo antes de accionarlo (ver completarPasoDeLaAccionIrreversible). Sin
    // eso, la destilacion lo rechaza por 'click_sin_localizacion_sin_cobertura' -- la percepcion
    // corre DESPUES de la accion y el control ya no existe -- y ninguna corrida de envio publica.
    const veredictoDePlantilla = await publicarPlantillaBestEffort(deps, job, {
      pasos: pasosParaPublicar(deps, job, corridaLibre, controlAccionado),
      // EL MISMO TEXTO QUE LEE EL CONSUMO (y no el `objetivo` que redacta el modelo): de otro modo la
      // clave publicada dice que la plantilla necesita menos datos de los que va a pedir al ejecutarse.
      textoParametros,
      dominio: sitio.dominio,
      dominios: dominiosAutorizados,
      // El verbo EFECTIVO (D2/D4): una corrida cuya intencion la resolvio la interpretacion llego
      // hasta aqui con guardia y efecto confirmado igual que una con verbo de la regex, y publica
      // bajo el mismo codigo de intencion con el que el consumo busca.
      verboBloqueado: verboEfectivo,
      // D4: la resolucion compartida consumo-publicacion. null cuando la corrida no interpreto (la
      // publicacion deriva con el extractor, como siempre).
      resolucion: resolucionDeLaCorrida,
      clasesCorroboradas: atlas?.clasesParaPublicar(sitio.dominio) ?? new Set<string>(),
    });
    // `sesionExternaId` queda EN EL RESULTADO del job: es la unica forma de encontrar despues la
    // grabacion de la sesion en el proveedor a partir de una tarea concreta.
    await deps.guardarResultado(job.id, {
      estado: 'ok',
      resumen: desenlace.resumen,
      via: 'modelo',
      sesionExternaId: activo.sesionExternaId,
      // EL VEREDICTO DE LA PUBLICACION de plantilla, publicada o no (ver VeredictoDePlantilla). Es lo
      // que permite responder "por que esta corrida no dejo plantilla" mirando el job, sin auditoria.
      plantilla: veredictoDePlantilla,
      // Y el del CONSUMO: por que esta corrida no uso un procedimiento que otra cuenta ya descubrio.
      plantillaAjena: veredictoDeConsumo,
      // D6 (resiliencia): la sonda pre-flight detecto que el sitio cambio y esta corrida se adapto
      // sola (motor libre + reaprendizaje). Es el escalar del que la tarjeta de /actividad deriva su
      // aviso en lenguaje llano; ausente cuando no hubo desajuste, para no tocar ningun resultado.
      ...(huboDesajusteDeInterfaz ? { desajusteDeInterfaz: true } : {}),
      // D4 (guardia sin intencion): cuantas acciones evaluo el criterio generico y cuantas HABRIA
      // detenido. Ausente cuando no evaluo ninguna, para no tocar el resultado de las demas.
      ...escalarDeLaObservacion(observacion, deps.guardiaSinIntencion ?? 'apagada'),
    });
    deps.logger.info('tarea web completada dentro de la sesion del sitio', {
      jobId: job.id,
      connectionId: activo.sitio.id,
      dominio: activo.sitio.dominio,
    });
    return 'completada';
  } finally {
    // MISMA ruta de cierre de siempre, una vez por sesion abierta.
    await gestor.cerrarTodas();
    // Las sesiones dejaron de ser responsabilidad de esta corrida. El corte duro externo ya no debe
    // tocarlas.
    control?.alCambiarSesion?.(null);
  }
}

/**
 * CIERRE ORDENADO de una corrida que la guardia DETUVO (CAMBIO 3). No decide nada del desenlace (ya
 * esta decidido y el error se propaga intacto): deja la tarea terminada como corresponde, con su
 * resultado escrito y el contexto de la sesion refrescado, antes de que el error suba.
 *
 * Por que importa: hasta este PR un bloqueo salia como una excepcion y nada mas. El job pasaba a
 * 'failed' y, mientras se escribia ese cierre, el latido leia el estado nuevo, lo interpretaba como
 * una cancelacion externa y abortaba la corrida a mitad de camino. El bloqueo es un desenlace
 * NORMAL del sistema (comparo y no dejo pasar), no una caida.
 *
 * NO hace nada si la corrida no termino por un bloqueo de la guardia: un fallo del motor, un
 * deadline o una cancelacion siguen su camino de siempre.
 */
async function cerrarCorridaDetenida(
  deps: TareaWebDeps,
  job: Job,
  sitio: SitioConectado,
  sesionExternaId: string,
  contexto: string,
  guardia: GuardiaDeTareaWeb,
): Promise<void> {
  const bloqueo = guardia.bloqueo();
  if (bloqueo === null) return;
  // La sesion se uso legitimamente hasta el bloqueo: mismo refresco que un checkpoint de aprobacion.
  await refrescarContextoBestEffort(deps, sitio, job.ownerId, sesionExternaId, contexto);
  try {
    await deps.guardarResultado(job.id, {
      estado: 'detenida',
      detalle: bloqueo,
      sesionExternaId,
    });
  } catch (error) {
    deps.logger.error('tarea web: no se pudo guardar el resultado de la accion detenida', {
      jobId: job.id,
      err: describir(error),
    });
  }
  deps.logger.warn('tarea web TERMINADA de forma ordenada tras detener la accion', {
    jobId: job.id,
    connectionId: sitio.id,
    dominio: sitio.dominio,
  });
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
 * INTERCALA los pasos de verificacion entre los del motor, en el lugar en que ocurrieron: una
 * verificacion con N acciones previas va JUSTO ANTES de la accion numero N+1 del agente. Es lo que
 * hace que la receta promovida de esta corrida vuelva a comparar en el mismo punto del flujo (D7) y
 * no al principio, cuando la pagina todavia esta vacia.
 *
 * Las acciones del agente son las de tipo 'act' de la traza (una por llamada a la tool, que es
 * exactamente lo que la guardia revisa). Una verificacion que BLOQUEO no tiene accion detras (nunca
 * llego al navegador) y cierra la traza.
 *
 * ES ADEMAS EL PUNTO EN EL QUE SE SELLA LO SINTETICO. Todo lo que llega por `verificaciones` lo
 * escribio el SISTEMA (la verificacion determinista, CUALQUIER rechazo de la guardia y la barrera de
 * identidad) y describe una accion que jamas llego al navegador; todo lo que llega por `delMotor` son
 * las acciones que el motor SI ejecuto. Sellar aqui, y no en cada constructor, es lo que cierra la
 * categoria: un veredicto NUEVO que se registre por este canal queda marcado sin tocar una linea mas,
 * y ningun constructor tiene que acordarse de marcarlo (ver `sintetico`, trayectoria.ts).
 */
function intercalarVerificaciones(
  delMotor: PasoCensurado[],
  verificaciones: VerificacionEnLaTraza[],
): PasoCensurado[] {
  if (verificaciones.length === 0) return delMotor;
  const pendientes = [...verificaciones].sort((a, b) => a.accionesPrevias - b.accionesPrevias);
  const pasos: PasoCensurado[] = [];
  let acciones = 0;
  for (const paso of delMotor) {
    if (paso.accion.tipo === 'act') {
      let siguiente = pendientes[0];
      while (siguiente !== undefined && siguiente.accionesPrevias <= acciones) {
        pasos.push(comoPasoSintetico(siguiente.paso));
        pendientes.shift();
        siguiente = pendientes[0];
      }
      acciones++;
    }
    pasos.push(paso);
  }
  for (const pendiente of pendientes) pasos.push(comoPasoSintetico(pendiente.paso));
  return pasos;
}

/** El paso del sistema, sellado como SINTETICO. Copia: los pasos del canal no se mutan. */
function comoPasoSintetico(paso: PasoCensurado): PasoCensurado {
  return { ...paso, sintetico: true };
}

/** Tamano del lote de la escritura incremental (FIX D): cada N acciones nuevas se vuelca un lote. */
const LOTE_DE_PASOS_INCREMENTAL = 3;

/** Escritor de UNA trayectoria en curso (FIX D): cabecera al arrancar, lotes durante, cierre final. */
interface EscritorIncrementalDeTrayectoria {
  /** Avisa que la traza en vivo crecio; vuelca un lote censurado si toca. Sincrono y sin efectos. */
  alRegistrar(acciones: AccionCrudaDeMotor[]): void;
  /** Cierra con el contenido final EXACTO de `guardar`. false = la cabecera nunca se pudo crear. */
  finalizar(trayectoria: TrayectoriaNueva): Promise<boolean>;
}

/**
 * ESCRITURA INCREMENTAL de la trayectoria (FIX D). La cabecera se crea al ARRANCAR la corrida (con
 * estado provisional 'fallida': si el proceso muriera a mitad de camino, ese es ademas el estado
 * veraz) y los pasos se vuelcan POR LOTES mientras el motor avanza, asi /actividad muestra progreso
 * real en vez de "sin pasos" durante toda una tarea larga. Al cerrar, `finalizar` REESCRIBE los
 * pasos con la lista final (verificaciones intercaladas, idx renumerados): el contenido persistido
 * queda identico al de la escritura unica de antes. Best-effort de punta a punta: cualquier fallo
 * degrada a la escritura al cierre de siempre o, si la cabecera ya existe, conserva lo volcado.
 *
 * Devuelve null cuando el registrador no expone los metodos incrementales: cero cambio.
 */
function crearEscritorIncremental(
  deps: TareaWebDeps,
  job: Job,
  sitio: SitioConectado,
  objetivo: string,
  iniciadaEn: Date,
): EscritorIncrementalDeTrayectoria | null {
  const registrador = deps.trayectorias;
  if (!registrador?.iniciar || !registrador.agregarPasos || !registrador.finalizar) return null;
  const agregarPasos = registrador.agregarPasos.bind(registrador);
  const cerrar = registrador.finalizar.bind(registrador);
  const idPromise: Promise<string | null> = registrador
    .iniciar({
      ownerId: job.ownerId,
      jobId: job.id,
      connectionId: sitio.id,
      dominio: sitio.dominio,
      objetivo: censurarObjetivo(objetivo),
      estado: 'fallida',
      iniciadaEn,
      terminadaEn: iniciadaEn,
      duracionMs: 0,
      tokensIn: null,
      tokensOut: null,
      pasos: [],
    })
    .catch((error: unknown) => {
      deps.logger.warn(
        'tarea web: no se pudo iniciar la trayectoria incremental (se escribira al cierre)',
        { jobId: job.id, err: describir(error) },
      );
      return null;
    });
  let volcados = 0;
  // Los lotes se SERIALIZAN en una cola de un solo vuelo: dos inserts del mismo idx no pueden
  // cruzarse, y el cierre espera la cola antes de reescribir.
  let cola: Promise<void> = Promise.resolve();
  return {
    alRegistrar: (acciones: AccionCrudaDeMotor[]): void => {
      if (acciones.length - volcados < LOTE_DE_PASOS_INCREMENTAL) return;
      const desde = volcados;
      const copia = acciones.slice();
      volcados = copia.length;
      cola = cola
        .then(async () => {
          const id = await idPromise;
          if (id === null) return;
          // extraerPasosCensurados asigna idx por posicion sobre la traza completa, asi que el
          // slice conserva los idx definitivos del lote.
          await agregarPasos(id, job.ownerId, extraerPasosCensurados(copia).slice(desde));
        })
        .catch((error: unknown) => {
          deps.logger.warn('tarea web: fallo un lote de la trayectoria incremental (se ignora)', {
            jobId: job.id,
            err: describir(error),
          });
        });
    },
    finalizar: async (trayectoria: TrayectoriaNueva): Promise<boolean> => {
      const id = await idPromise;
      if (id === null) return false;
      await cola;
      await cerrar(id, job.ownerId, trayectoria);
      return true;
    },
  };
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
  resultado: Pick<ResultadoMotor, 'acciones' | 'tokensIn' | 'tokensOut' | 'estrategiasPorAccion'>,
  /** Pasos SINTETICOS que van ANTES de los del motor (la ejecucion por receta pasa los suyos). */
  pasosPrevios: PasoCensurado[] = [],
  /** Pasos SINTETICOS de la verificacion previa, con el lugar de la corrida en que ocurrieron. */
  verificaciones: VerificacionEnLaTraza[] = [],
  /** Observaciones del DOM tomadas durante la corrida (CAMBIO 1), para enriquecer cada paso. */
  observaciones: ObservacionDePaso[] = [],
  /**
   * ACUMULADOR de los pasos de TODO el job (no de esta corrida): es lo que se promueve a receta al
   * final. Se llena SIEMPRE, aunque el registro de trayectorias no este cableado, porque la
   * promocion no depende de que V030 este aplicada.
   */
  acumulador?: PasoCensurado[],
  /** Escritor incremental de ESTA corrida (FIX D): si cerro la trayectoria, no se re-escribe. */
  escritor?: EscritorIncrementalDeTrayectoria | null,
): Promise<void> {
  const pasos = [
    ...pasosPrevios,
    ...intercalarVerificaciones(
      extraerPasosCensurados(resultado.acciones, observaciones, resultado.estrategiasPorAccion ?? []),
      verificaciones,
    ),
    // MULTISITIO: TODOS los pasos de un tramo pertenecen al mismo sitio (un cambio de sitio TERMINA
    // el tramo), asi que el sello es uno solo y sale del sitio sobre el que corrio esta ejecucion.
    // Es lo que permite promover una receta que cruza sitios sabiendo a cual pertenece cada paso.
  ].map((paso, idx) => ({ ...paso, idx, dominio: sitio.dominio }));
  acumulador?.push(...pasos);
  if (!deps.trayectorias) return;
  const terminadaEn = new Date();
  const trayectoria: TrayectoriaNueva = {
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
    // El paso de verificacion queda intercalado donde ocurrio y el idx ya viene renumerado, para
    // que el orden persistido sea el orden real de lo que paso.
    pasos,
  };
  // CIERRE INCREMENTAL (FIX D): si la cabecera ya existe, se cierra reescribiendo los pasos finales.
  // Si el cierre falla con la cabecera creada NO se cae a `guardar` (duplicaria la ejecucion): los
  // lotes ya volcados se conservan y el fallo se loguea.
  if (escritor !== null && escritor !== undefined) {
    try {
      if (await escritor.finalizar(trayectoria)) return;
    } catch (error) {
      deps.logger.warn(
        'tarea web: no se pudo cerrar la trayectoria incremental (se conservan los lotes volcados)',
        { jobId: job.id, connectionId: sitio.id, err: describir(error) },
      );
      return;
    }
  }
  try {
    await deps.trayectorias.guardar(trayectoria);
  } catch (error) {
    deps.logger.warn('tarea web: no se pudo registrar la trayectoria (se ignora, best-effort)', {
      jobId: job.id,
      connectionId: sitio.id,
      err: describir(error),
    });
  }
}

/**
 * REPORTE DE CONSUMO de una corrida del motor. Solo cifras: ni objetivo, ni URLs, ni contenido de la
 * pagina. `tokensEntrada` son los tokens de entrada NUEVOS (no incluyen los de cache), asi que la
 * relacion entre esa cifra y `tokensLeidosDeCache` es la medida directa de si el cache de prompt
 * esta funcionando: leidos en cero significa que cada paso volvio a pagar el prefijo entero.
 */
function loguearConsumo(
  deps: TareaWebDeps,
  job: Job,
  sitio: SitioConectado,
  consumo: ConsumoDeCorrida | null,
  desenlace: 'terminada' | 'cortada',
): void {
  if (consumo === null) return;
  deps.logger.info('tarea web: consumo de la corrida del motor', {
    jobId: job.id,
    connectionId: sitio.id,
    desenlace,
    pasos: consumo.pasos,
    tokensEntrada: consumo.tokensEntrada,
    tokensSalida: consumo.tokensSalida,
    tokensLeidosDeCache: consumo.tokensLeidosDeCache,
    tokensCreadosEnCache: consumo.tokensCreadosEnCache,
    historialPasos: deps.historialPasos,
    modoScreenshots: deps.modoScreenshots,
  });
}

/**
 * Corre el motor y REGISTRA la trayectoria de la ejecucion (exitosa, fallida o pausada) antes de
 * devolver el desenlace. Si el motor LANZA (deadline de pared, cancelacion o corte por fallo de
 * esquema del motor), la trayectoria fallida se guarda con las acciones que el motor alcanzo a
 * ejecutar -- acumuladas EN VIVO, porque un motor que lanza no devuelve su traza -- y los intentos
 * fallidos quedan con exito false. El error se re-propaga intacto.
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
  // GUARDIA DE ACCION de esta corrida (solo la corrida INICIAL la lleva): se interpone entre el
  // agente y el navegador. Ni la reanudacion tras una decision humana ni la escalada de un paso de
  // receta la llevan: ahi la accion ya esta decidida por otra via.
  guardia?: GuardiaDeTareaWeb,
  // Acumulador de los pasos de TODO el job, insumo de la promocion a receta.
  acumulador?: PasoCensurado[],
  // MULTISITIO: la herramienta de cambio de sitio y el presupuesto que le queda a la TAREA (no al
  // tramo). Ausente = tarea de un solo sitio, con el presupuesto entero de deps.
  extra?: {
    cambiador?: CambiadorDeSitio | undefined;
    maxPasos?: number | undefined;
    timeoutMs?: number | undefined;
    /** ATLAS DE SITIOS (V040): bloque "mapa conocido del sitio" de ESTE tramo. Vacio = sin mapa. */
    mapaDelSitio?: readonly string[] | undefined;
  },
): Promise<{ resultado: ResultadoMotor; desenlace: DesenlaceTareaWeb }> {
  const iniciadaEn = new Date();
  // OBSERVACION de cada paso mientras el motor corre (CAMBIO 1): lee del DOM las estrategias de
  // localizacion que la traza del motor no trae. Best-effort de punta a punta.
  const observaciones: ObservacionDePaso[] = [];
  const observador = crearObservadorDePasos(deps, sesionExternaId, observaciones);
  // Traza EN VIVO de la corrida: es la unica que queda si el motor lanza (CAMBIO 7).
  const accionesEnVivo: AccionCrudaDeMotor[] = [];
  // ESCRITURA INCREMENTAL (FIX D): cabecera al arrancar y lotes de pasos mientras el motor corre,
  // para que /actividad muestre progreso real. null si el registrador no la soporta.
  const escritor = crearEscritorIncremental(deps, job, sitio, objetivo, iniciadaEn);
  // CONSUMO DE LA CORRIDA: el motor lo emite en su cierre, haya devuelto o haya lanzado. Se loguea
  // en los dos caminos porque es lo que permite medir si el ahorro (cache de prompt, ventana de
  // historial, capturas bajo politica) esta funcionando de verdad en produccion.
  let consumo: ConsumoDeCorrida | null = null;
  let resultado: ResultadoMotor;
  try {
    resultado = await ejecutarMotor(
      deps,
      sesionExternaId,
      apiKey,
      prompt,
      senalExterna,
      observador,
      (accion) => {
        accionesEnVivo.push(accion);
        escritor?.alRegistrar(accionesEnVivo);
      },
      guardia,
      (reporte) => {
        consumo = reporte;
      },
      extra?.cambiador,
      { maxPasos: extra?.maxPasos ?? deps.maxPasos, timeoutMs: extra?.timeoutMs ?? deps.runTimeoutMs },
      extra?.mapaDelSitio,
    );
  } catch (error) {
    loguearConsumo(deps, job, sitio, consumo, 'cortada');
    // Incluye el caso en que la GUARDIA bloqueo la accion: la trayectoria fallida conserva lo que el
    // agente alcanzo a hacer MAS el paso de verificacion que explica por que se corto.
    await guardarTrayectoriaBestEffort(
      deps,
      job,
      sitio,
      objetivo,
      'fallida',
      iniciadaEn,
      { acciones: accionesEnVivo, tokensIn: null, tokensOut: null },
      [],
      guardia?.verificaciones() ?? [],
      observaciones,
      undefined,
      escritor,
    );
    throw error;
  }
  loguearConsumo(deps, job, sitio, consumo, 'terminada');
  const desenlace = clasificarDesenlace(resultado.mensaje);
  const estado: EstadoTrayectoria =
    desenlace.tipo === 'requiere_aprobacion'
      ? 'pausada'
      : desenlace.tipo === 'ok' && resultado.exito
        ? 'exitosa'
        : 'fallida';
  await guardarTrayectoriaBestEffort(
    deps,
    job,
    sitio,
    objetivo,
    estado,
    iniciadaEn,
    resultado,
    [],
    guardia?.verificaciones() ?? [],
    observaciones,
    acumulador,
    escritor,
  );
  return { resultado, desenlace };
}

/**
 * OBSERVADOR de pasos (CAMBIO 1). Por cada accion que el motor ejecuta, le pide al navegador las
 * estrategias de localizacion del elemento que toco y las acumula EN ORDEN. Devuelve undefined si el
 * camino determinista no esta cableado (sin el, no hay nada que observar ni receta que promover) o
 * si el observador esta APAGADO (TAREA_WEB_OBSERVADOR_PASOS, default false): cada accion CON
 * ELEMENTO RESUELTO abre una conexion CDP mas, ADEMAS de la que la percepcion ya abre despues de
 * cada paso que toca la pagina, y eso solo se paga cuando el despliegue lo pide.
 *
 * BEST-EFFORT en los dos sentidos:
 *  - Un fallo de lectura acumula una observacion VACIA, para no desalinear el orden con las acciones.
 *  - El elemento puede haber desaparecido (un click que navego): tambien acumula vacia y ese paso
 *    simplemente no sera promovible.
 */
function crearObservadorDePasos(
  deps: TareaWebDeps,
  sesionExternaId: string,
  observaciones: ObservacionDePaso[],
): ((paso: PasoObservado) => Promise<void>) | undefined {
  const determinista = deps.determinista;
  if (!determinista || !deps.recetas || deps.observadorPasos !== true) return undefined;
  return async (paso: PasoObservado): Promise<void> => {
    const referencia =
      paso.selector !== null
        ? ({ tipo: 'xpath', xpath: paso.selector } as const)
        : paso.punto !== null
          ? ({ tipo: 'punto', x: paso.punto.x, y: paso.punto.y } as const)
          : null;
    if (referencia === null) {
      observaciones.push({ selector: null, estrategias: [] });
      return;
    }
    let estrategias: EstrategiaLocalizacion[] = [];
    try {
      estrategias = await determinista.leerEstrategiasDeElemento(sesionExternaId, referencia);
    } catch (error) {
      deps.logger.warn('tarea web: no se pudieron leer las estrategias de un paso (se sigue sin ellas)', {
        err: describir(error),
      });
    }
    const xpath = estrategias.find((e) => e.tipo === 'xpath');
    observaciones.push({
      // Un paso por coordenadas no traia selector: el xpath recalculado sobre el elemento pasa a
      // serlo, y con eso el paso deja de ser irrepetible (CAMBIO 2).
      selector: paso.selector ?? (xpath?.tipo === 'xpath' ? xpath.xpath : null),
      estrategias,
    });
  };
}

/**
 * EL CORTE POR FALTA DE ACCESO AL MODELO detras de un resultado del motor SIN EXITO, o null si el
 * fallo fue otro (ahi el desenlace no cambia en nada).
 *
 * Por que se lee del TEXTO y no del error: `agent.execute` de Stagehand ATRAPA todo fallo que no sea
 * un abort y devuelve un resultado sin exito cuyo unico rastro es un string (v3AgentHandler), asi que
 * por este camino no sobreviven ni el status HTTP ni el tipo del proveedor. Lo que si sobrevive es la
 * MARCA que el middleware de modelo planto en el mensaje, y es exactamente lo unico que se acepta:
 * jamas frases sueltas, porque el mensaje final del agente puede arrastrar contenido de la pagina.
 */
function corteDeAccesoAlModelo(
  deps: TareaWebDeps,
  job: Job,
  sitio: SitioConectado,
  resultado: Pick<ResultadoMotor, 'mensaje'>,
): FalloDeAccesoAlModeloError | null {
  const clase = clasificarFalloDeAccesoAlModelo(resultado.mensaje);
  if (clase === null) return null;
  deps.logger.error('tarea web: la corrida se corto porque la llave del modelo no tiene acceso', {
    jobId: job.id,
    connectionId: sitio.id,
    clase,
  });
  return new FalloDeAccesoAlModeloError(clase);
}

/**
 * Traduce el CORTE POR FALLO DE ESQUEMA del motor al fallo permanente del job (FIX D). Cuando el
 * corte fue por REPETICION del MISMO identificador, el error lleva el nombre-prefijo estable
 * MOTOR_CORTO_POR_ELEMENTO_REPETIDO, con lo que el last_error del job (describeError en
 * execution.ts: `${name}: ${message}`) empieza exactamente con ese prefijo. La trayectoria acumulada
 * ya quedo preservada por ejecutarMotorConRegistro ANTES de que este error se propague.
 */
export function convertirCorteDelMotor(error: FalloDeEsquemaDelMotorError): PermanentExecutionError {
  const mensaje =
    `el motor de navegacion fallo al resolver las acciones de la pagina (${error.message}); ` +
    'la tarea se corto para no seguir reintentando lo mismo. No es un problema del objetivo: ' +
    'vuelve a pedirla mas tarde';
  return error.elementIdRepetido !== undefined
    ? new MotorCortoPorElementoRepetidoError(mensaje)
    : new PermanentExecutionError(mensaje);
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
  observador?: ((paso: PasoObservado) => Promise<void>) | undefined,
  registrarAccion?: ((accion: AccionCrudaDeMotor) => void) | undefined,
  guardia?: GuardiaDeAccion | undefined,
  reportarConsumo?: ((consumo: ConsumoDeCorrida) => void) | undefined,
  cambiador?: CambiadorDeSitio | undefined,
  // PRESUPUESTO de ESTE tramo: lo que le queda a la TAREA de pasos y de deadline de pared. Con un
  // solo sitio hay un solo tramo y son deps.maxPasos y deps.runTimeoutMs enteros.
  presupuesto?: { maxPasos: number; timeoutMs: number } | undefined,
  // ATLAS DE SITIOS (V040): el bloque "mapa conocido del sitio" que se adjunta al contexto de
  // percepcion. Ausente o vacio = el motor corre exactamente como antes de V040.
  mapaDelSitio?: readonly string[] | undefined,
): Promise<ResultadoMotor> {
  const maxPasos = presupuesto?.maxPasos ?? deps.maxPasos;
  const timeoutMs = presupuesto?.timeoutMs ?? deps.runTimeoutMs;
  // PERCEPCION (FIX A y B): solo si el adaptador del navegador la expone. El bind conserva el this
  // del adaptador; el motor recibe una funcion cerrada sobre LA sesion de este tramo.
  const percibirPagina = deps.navegador.percibirPagina?.bind(deps.navegador);
  const perceptor: PerceptorDePagina | undefined =
    percibirPagina !== undefined
      ? { percibir: (objetivo?: ObjetivoDeLectura | undefined) => percibirPagina(sesionExternaId, objetivo) }
      : undefined;
  const controller = new AbortController();
  let expiroDeadline = false;
  const alAbortarExterno = (): void => controller.abort();
  if (senalExterna?.aborted) controller.abort();
  else senalExterna?.addEventListener('abort', alAbortarExterno, { once: true });
  const timer = setTimeout(() => {
    expiroDeadline = true;
    controller.abort();
  }, timeoutMs);
  try {
    return await deps.motor.ejecutar({
      sesionExternaId,
      objetivo: prompt.objetivo,
      systemPrompt: prompt.systemPrompt,
      apiKey,
      model: deps.model,
      maxPasos,
      signal: controller.signal,
      observador,
      registrarAccion,
      guardia,
      ...(cambiador !== undefined ? { cambiador } : {}),
      ...(perceptor !== undefined ? { perceptor } : {}),
      ...(mapaDelSitio !== undefined && mapaDelSitio.length > 0 ? { mapaDelSitio } : {}),
      historialPasos: deps.historialPasos,
      modoScreenshots: deps.modoScreenshots,
      reportarConsumo,
    });
  } catch (error) {
    // Fallo del motor con la sesion ya abierta: PERMANENTE (no se re-ejecuta una navegacion a
    // medias sobre la cuenta real). El mensaje va sanitizado: nunca el objetivo ni contenido. Si el
    // que corto fue el deadline de pared, el mensaje lo dice con los segundos configurados
    // (diagnostico interno); cualquier otro fallo conserva el mensaje sanitizado de siempre.
    //
    // CORTE POR FALLO DE ESQUEMA DEL MOTOR (CAMBIO 3): causa PROPIA del motor de navegacion, ni
    // limite de pasos ni error del usuario. Se nombra como tal para que el diagnostico no mande al
    // usuario a reformular un objetivo que estaba bien.
    // ACCION BLOQUEADA POR LA GUARDIA: no es un fallo del motor ni del objetivo. Su mensaje ya es la
    // detencion serializada (DETENIDA_VERIFICACION) y viaja INTACTO hasta el last_error del job para
    // que la consola pueda decirle al usuario que se pidio y que se encontro.
    if (error instanceof AccionBloqueadaError) {
      throw new PermanentExecutionError(error.message);
    }
    // ACCION SIN CONFIRMAR (CAMBIO 4 + FIX A): se ejecuto (con su unico reintento incluido) y el
    // sitio no mostro que surtiera efecto. La tarea termina con el prefijo estable
    // ACCION_SIN_EFECTO_CONFIRMADO; jamas se reintenta (repetirla podria duplicar el efecto).
    if (error instanceof AccionSinConfirmarError) {
      throw new AccionSinEfectoConfirmadoError(error.message);
    }
    // CORTE POR REINTENTOS AGOTADOS (FIX C): ya viene con su nombre-prefijo estable; pasa intacto.
    if (error instanceof GuardiaBloqueoReintentosError) {
      throw error;
    }
    // FALTA DE ACCESO AL MODELO (saldo, cuota o credencial): ya viene con su nombre-prefijo estable
    // MODELO_SIN_ACCESO; pasa intacto para que la consola pueda decir que paso y que hacer. La
    // segunda rama cubre el error crudo que llegue sin envolver por un camino que no sea el blindaje.
    if (error instanceof FalloDeAccesoAlModeloError) {
      throw error;
    }
    const claseDeModelo = clasificarFalloDeAccesoAlModelo(error);
    if (claseDeModelo !== null) {
      throw new FalloDeAccesoAlModeloError(claseDeModelo);
    }
    if (error instanceof FalloDeEsquemaDelMotorError) {
      throw convertirCorteDelMotor(error);
    }
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
      // La reanudacion tambien puede morir por falta de acceso al modelo: mismo corte y mismo
      // mensaje que en la corrida inicial (si no, el usuario veria dos diagnosticos distintos para
      // exactamente el mismo problema segun si hubo checkpoint).
      const sinAcceso = corteDeAccesoAlModelo(deps, job, sitio, resultado);
      if (sinAcceso !== null) throw sinAcceso;
      // BUG C: mismo mensaje veraz por causa que en la corrida inicial (diagnostico interno).
      throw new PermanentExecutionError(
        describirFalloDelMotor(resultado, deps.maxPasos, 'la tarea reanudada'),
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
