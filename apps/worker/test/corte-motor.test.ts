import { describe, it, expect } from 'vitest';
import {
  FalloDeEsquemaDelMotorError,
  MotorCortoPorElementoRepetidoError,
  PermanentExecutionError,
  PREFIJO_MOTOR_CORTO_POR_ELEMENTO_REPETIDO,
} from '../src/errores.js';
import { convertirCorteDelMotor } from '../src/tarea-web.js';

/**
 * DESENLACE DEL CORTE POR IDENTIFICADOR REPETIDO (FIX D). El last_error del job lo construye
 * execution.ts como `${error.name}: ${error.message}` (describeError) y handleFailure marca failed
 * directo para todo PermanentExecutionError. Estos tests fijan que el corte por elemento REPETIDO
 * produce un last_error con el prefijo estable MOTOR_CORTO_POR_ELEMENTO_REPETIDO: y que el corte
 * por racha (sin id repetido) queda como estaba.
 */

/** El mismo formato de describeError (execution.ts): asi queda el last_error del job. */
function comoLastError(error: Error): string {
  return `${error.name}: ${error.message}`;
}

describe('convertirCorteDelMotor (FIX D)', () => {
  it('el corte por el MISMO elementId repetido produce el prefijo estable en el last_error', () => {
    const corte = new FalloDeEsquemaDelMotorError(2, '6377');
    expect(corte.elementIdRepetido).toBe('6377');
    const permanente = convertirCorteDelMotor(corte);
    expect(permanente).toBeInstanceOf(MotorCortoPorElementoRepetidoError);
    // Sigue siendo permanente: markFailed directo, sin reintentos.
    expect(permanente).toBeInstanceOf(PermanentExecutionError);
    expect(comoLastError(permanente).startsWith(`${PREFIJO_MOTOR_CORTO_POR_ELEMENTO_REPETIDO}:`)).toBe(
      true,
    );
    // El mensaje conserva el identificador y el diagnostico accionable.
    expect(permanente.message).toContain('6377');
    expect(permanente.message).toContain('No es un problema del objetivo');
  });

  it('el corte por RACHA de fallos distintos queda como PermanentExecutionError generico', () => {
    const corte = new FalloDeEsquemaDelMotorError(3);
    expect(corte.elementIdRepetido).toBeUndefined();
    const permanente = convertirCorteDelMotor(corte);
    expect(permanente).toBeInstanceOf(PermanentExecutionError);
    expect(permanente).not.toBeInstanceOf(MotorCortoPorElementoRepetidoError);
    expect(comoLastError(permanente).startsWith('PermanentExecutionError:')).toBe(true);
  });
});
