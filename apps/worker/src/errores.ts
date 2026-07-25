/**
 * Clases de error de la ejecucion de jobs, en un modulo propio SIN dependencias para que tanto el
 * runner generico (execution.ts) como los handlers de sitios conectados (sitios.ts) las usen sin un
 * ciclo de imports. execution.ts las RE-EXPORTA: su superficie publica no cambia.
 */

/**
 * Fallo PERMANENTE: no tiene sentido reintentar porque no se va a arreglar solo (tier insuficiente,
 * conexion inexistente, sesion de login ya muerta). Va directo a 'failed' SIN consumir los
 * reintentos, a diferencia de un fallo transitorio (error de proveedor, timeout) que si se reintenta.
 */
export class PermanentExecutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentExecutionError';
  }
}

/** El run supero el deadline de pared del worker: fallo TRANSITORIO del intento (cuenta para reintentos). */
export class RunTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`el run supero el timeout de pared de ${timeoutMs}ms`);
    this.name = 'RunTimeoutError';
  }
}

/**
 * El MOTOR DE NAVEGACION rechazo por ESQUEMA la salida del modelo tantas veces seguidas que la
 * corrida se corta. NO es limite de pasos ni error del usuario: es un fallo del propio motor
 * (Stagehand renderiza el arbol de accesibilidad con un id sin prefijo cuando `encodedId` queda
 * undefined, el modelo lo copia tal cual y el esquema de `act`, que exige `numero-numero`, lo
 * rechaza). Se distingue del resto para que el diagnostico no culpe al objetivo del usuario y para
 * que la corrida no gire minutos reintentando lo mismo.
 *
 * Con `elementIdRepetido` el corte es por REPETICION DETERMINISTA: el motor rechazo dos intentos
 * seguidos con el MISMO identificador malformado. Ese caso no se reintenta mas (el arbol que lo
 * produce no cambia solo) y el mensaje lo dice, para que el diagnostico distinga un fallo que se
 * repite exacto de una racha de fallos distintos.
 */
export class FalloDeEsquemaDelMotorError extends Error {
  constructor(fallosConsecutivos: number, elementIdRepetido?: string) {
    super(
      elementIdRepetido !== undefined
        ? 'el motor de navegacion rechazo por esquema la salida del modelo dos veces seguidas con el ' +
            `MISMO identificador de elemento malformado (${elementIdRepetido}): el fallo es ` +
            'determinista y reintentar no lo cambia'
        : `el motor de navegacion rechazo por esquema la salida del modelo ${fallosConsecutivos} veces ` +
            'seguidas (fallo conocido e intermitente del motor, no del objetivo)',
    );
    this.name = 'FalloDeEsquemaDelMotorError';
  }
}

/**
 * La GUARDIA DE ACCION del worker BLOQUEO una accion del agente ANTES de que llegara al navegador: la
 * verificacion determinista comparo lo que hay en la pagina contra lo que declaro el objetivo y no
 * coincidio (o la politica del usuario no la permite). `message` es el mensaje de la detencion ya
 * serializado (DETENIDA_VERIFICACION), asi que viaja intacto hasta el last_error del job y la consola
 * lo sabe traducir. Lanzarlo desde la tool corta el bucle del agente en el acto: es lo que garantiza
 * que no busque una ruta alternativa para la misma accion.
 */
export class AccionBloqueadaError extends Error {
  constructor(mensajeDeDetencion: string) {
    super(mensajeDeDetencion);
    this.name = 'AccionBloqueadaError';
  }
}

/**
 * Una accion IRREVERSIBLE se ejecuto y el sistema NO pudo confirmar en el DOM que surtiera efecto
 * (CAMBIO 4): ni se cerro el formulario que la accion consumia ni el sitio mostro su confirmacion.
 * La tarea TERMINA reportandolo tal cual, sin afirmar que ocurrio y sin negarlo, y sin reintentar:
 * repetir a ciegas una accion que quiza ya se ejecuto es exactamente como se duplica un envio.
 * Lanzarlo desde la tool corta el bucle del agente en el acto, que es lo que impide que el modelo
 * "no vea la confirmacion" y decida repetir por su cuenta.
 */
export class AccionSinConfirmarError extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'AccionSinConfirmarError';
  }
}

/**
 * El worker se esta apagando (SIGTERM/SIGINT) y aborto el run en curso. NO es culpa del job: se devuelve
 * a 'pending' para que se re-reclame, sin marcarlo failed aunque haya agotado intentos.
 */
export class ShutdownAbortError extends Error {
  constructor() {
    super('ejecucion abortada por apagado del worker');
    this.name = 'ShutdownAbortError';
  }
}
