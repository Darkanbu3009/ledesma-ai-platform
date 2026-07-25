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
 */
export class FalloDeEsquemaDelMotorError extends Error {
  constructor(fallosConsecutivos: number) {
    super(
      `el motor de navegacion rechazo por esquema la salida del modelo ${fallosConsecutivos} veces ` +
        'seguidas (fallo conocido e intermitente del motor, no del objetivo)',
    );
    this.name = 'FalloDeEsquemaDelMotorError';
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
