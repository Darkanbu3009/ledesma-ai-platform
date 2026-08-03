import { describe, it, expect, afterEach } from 'vitest';
import { serializarDetencion } from '@ledesma-platform/shared/verificacion';
import i18n from '../src/i18n';
import {
  detencionDeJob,
  formatearSitiosExcluidos,
  parsearSitiosExcluidos,
  textoDeDetencion,
} from '../src/lib/politicas';
import type { JobActivity } from '../src/lib/jobs';

/**
 * TEXTO DE UNA TAREA DETENIDA antes de ejecutar una accion que no se puede deshacer. Lo que estos
 * tests fijan: el mensaje que ve el usuario dice QUE PIDIO, QUE SE ENCONTRO y QUE HACER, en su
 * idioma, y NUNCA usa una palabra tecnica.
 */

/** Palabras prohibidas en cualquier texto visible de esta superficie. */
const TERMINOS_TECNICOS = [
  'checkpoint',
  'aprobacion',
  'aprobación',
  'blocklist',
  'worker',
  'job',
  'DOM',
  'selector',
];

function makeJob(lastError: string | null, status: JobActivity['status'] = 'failed'): JobActivity {
  return {
    id: 'job-1',
    type: 'tarea_web',
    agentId: null,
    status,
    attempts: 1,
    lastError,
    scheduledFor: null,
    createdAt: '2026-07-24T22:52:00.000Z',
    startedAt: '2026-07-24T22:52:00.000Z',
    finishedAt: '2026-07-24T22:54:00.000Z',
  };
}

/** Como llega el mensaje del worker: envuelto en el nombre de la clase de error. */
function lastErrorDe(detencion: Parameters<typeof serializarDetencion>[0]): string {
  return `PermanentExecutionError: ${serializarDetencion(detencion)}`;
}

afterEach(async () => {
  await i18n.changeLanguage('es');
});

describe('detencionDeJob', () => {
  it('reconoce la detencion dentro del last_error del job', () => {
    const job = makeJob(lastErrorDe({ motivo: 'noCoincide', pedido: 'a@x.com', encontrado: 'b@x.com' }));
    expect(detencionDeJob(job)).toMatchObject({ motivo: 'noCoincide', pedido: 'a@x.com' });
  });

  it('un fallo tecnico cualquiera NO es una detencion (cae al mensaje generico)', () => {
    expect(detencionDeJob(makeJob('PermanentExecutionError: la navegacion fallo'))).toBeNull();
    expect(detencionDeJob(makeJob(null))).toBeNull();
  });

  it('un last_error TRUNCADO no se interpreta a medias', () => {
    const truncado = lastErrorDe({ motivo: 'noCoincide', pedido: 'a@x.com' }).slice(0, 40);
    expect(detencionDeJob(makeJob(truncado))).toBeNull();
  });

  it('un job que no fallo nunca es una detencion', () => {
    const job = makeJob(lastErrorDe({ motivo: 'accionesDesactivadas' }), 'completed');
    expect(detencionDeJob(job)).toBeNull();
  });
});

describe('textoDeDetencion (ES)', () => {
  it('no coincide: cita lo pedido y lo encontrado', () => {
    const texto = textoDeDetencion({
      motivo: 'noCoincide',
      pedido: 'juan@ejemplo.com',
      encontrado: 'otro@atacante.com',
    });
    expect(texto.titulo).toBe('La tarea se detuvo antes de ejecutar');
    expect(texto.detalle).toBe(
      'Pediste juan@ejemplo.com y en el sitio aparecia otro@atacante.com. No se ejecuto nada. Revisa y vuelve a pedirlo.',
    );
  });

  it('sin nada legible en el sitio, el hueco se llena con una palabra, no con un vacio', () => {
    const texto = textoDeDetencion({ motivo: 'noCoincide', pedido: 'juan@ejemplo.com', encontrado: '' });
    expect(texto.detalle).toContain('aparecia nada');
  });

  it('falta un dato: lo nombra en lenguaje de persona', () => {
    const texto = textoDeDetencion({ motivo: 'faltaDato', campo: 'destinatario' });
    expect(texto.detalle).toBe(
      'Falta un dato para completar esta accion: a quien enviarlo. Pidelo de nuevo incluyendolo.',
    );
  });

  it('no leible: dice que NO SE PUDO LEER, jamas que "aparecia nada" (CAMBIO 2)', () => {
    // El diagnostico falso de produccion: un dato que no se pudo leer se reportaba como si el sitio
    // no mostrara nada. Ahora el mensaje dice exactamente lo que paso.
    const texto = textoDeDetencion({ motivo: 'noLeible', campo: 'destinatario' });
    expect(texto.titulo).toBe('La tarea se detuvo antes de ejecutar');
    expect(texto.detalle).toBe(
      'No pudimos leer a quien enviarlo en el sitio para comprobarlo. No se ejecuto nada.',
    );
    expect(texto.detalle).not.toContain('aparecia');
  });

  it('no leible sin campo (la pagina entera no se pudo leer): dice que la pagina no se pudo leer', () => {
    // FIX C, caso real de produccion del 3 ago 2026: la sesion de navegador quedo degradada y el
    // mensaje culpaba al destinatario ("No pudimos leer a quien enviarlo") con el dato escrito y
    // visible. Sin campo, lo ilegible fue la pagina, y eso es lo que se dice.
    const texto = textoDeDetencion({ motivo: 'noLeible' });
    expect(texto.detalle).toBe(
      'No pudimos leer la pagina del sitio para comprobar la tarea. No se ejecuto nada y se reintentara. Si vuelve a pasar, pide la tarea de nuevo.',
    );
    expect(texto.detalle).not.toContain('a quien enviarlo');
  });

  it('tope excedido: cita monto, limite y donde cambiarlo', () => {
    const texto = textoDeDetencion({ motivo: 'topeExcedido', monto: '9900 MXN', tope: '5000 MXN' });
    expect(texto.detalle).toBe(
      'El monto de 9900 MXN supera tu limite configurado de 5000 MXN. No se ejecuto nada. Puedes ajustar tu limite en Configuracion.',
    );
  });

  it('sitio excluido y acciones desactivadas', () => {
    expect(textoDeDetencion({ motivo: 'sitioExcluido', dominio: 'banco.com' }).detalle).toBe(
      'Tienes desactivadas las acciones en banco.com. No se ejecuto nada.',
    );
    expect(textoDeDetencion({ motivo: 'accionesDesactivadas' }).detalle).toBe(
      'Tienes desactivadas las acciones que no se pueden deshacer. No se ejecuto nada.',
    );
  });

  it('otraAccion NO afirma "no se ejecuto nada": la primera accion SI se completo (FIX E)', () => {
    const texto = textoDeDetencion({ motivo: 'otraAccion' });
    expect(texto.detalle.toLowerCase()).not.toContain('no se ejecuto nada');
    expect(texto.detalle).toContain('ya habia completado');
    expect(texto.detalle).toContain('Revisa en el sitio');
  });

  it('NINGUN motivo usa terminos tecnicos', () => {
    const motivos = [
      { motivo: 'noCoincide' as const, pedido: 'a', encontrado: 'b' },
      { motivo: 'noLeible' as const, campo: 'asunto' as const },
      { motivo: 'faltaDato' as const, campo: 'monto' as const },
      { motivo: 'topeExcedido' as const, monto: '1', tope: '0' },
      { motivo: 'sitioExcluido' as const, dominio: 'x.com' },
      { motivo: 'accionesDesactivadas' as const },
      { motivo: 'otraAccion' as const },
      { motivo: 'politicaNoDisponible' as const },
    ];
    for (const detencion of motivos) {
      const { titulo, detalle } = textoDeDetencion(detencion);
      for (const termino of TERMINOS_TECNICOS) {
        expect(`${titulo} ${detalle}`.toLowerCase()).not.toContain(termino.toLowerCase());
      }
    }
  });
});

describe('textoDeDetencion (EN)', () => {
  it('el mismo motivo se traduce con la misma estructura', async () => {
    await i18n.changeLanguage('en');
    const texto = textoDeDetencion({
      motivo: 'noCoincide',
      pedido: 'juan@ejemplo.com',
      encontrado: 'otro@atacante.com',
    });
    expect(texto.titulo).toBe('The task stopped before doing it');
    expect(texto.detalle).toContain('juan@ejemplo.com');
    expect(texto.detalle).toContain('otro@atacante.com');
    expect(textoDeDetencion({ motivo: 'faltaDato', campo: 'monto' }).detalle).toContain('the amount');
    expect(textoDeDetencion({ motivo: 'noLeible', campo: 'destinatario' }).detalle).toBe(
      'We could not read who to send it to on the site to check it. Nothing was done.',
    );
  });
});

describe('sitios excluidos (campo de texto <-> lista)', () => {
  it('separa por comas y saltos, normaliza y deduplica', () => {
    expect(parsearSitiosExcluidos(' Banco.com , sat.gob.mx\nbanco.com ')).toEqual([
      'banco.com',
      'sat.gob.mx',
    ]);
  });

  it('un campo vacio es una lista vacia', () => {
    expect(parsearSitiosExcluidos('   ')).toEqual([]);
  });

  it('la lista vuelve a texto editable', () => {
    expect(formatearSitiosExcluidos(['banco.com', 'sat.gob.mx'])).toBe('banco.com, sat.gob.mx');
  });
});
