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
 * El worker se esta apagando (SIGTERM/SIGINT) y aborto el run en curso. NO es culpa del job: se devuelve
 * a 'pending' para que se re-reclame, sin marcarlo failed aunque haya agotado intentos.
 */
export class ShutdownAbortError extends Error {
  constructor() {
    super('ejecucion abortada por apagado del worker');
    this.name = 'ShutdownAbortError';
  }
}
