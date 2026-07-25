import { describe, it, expect } from 'vitest';
import { POLITICA_EJECUCION_DEFAULT, parsearDetencion } from '@ledesma-platform/shared';
import { extraerParametrosDeclarados } from '../src/parametros-objetivo.js';
import {
  construirPasoDeVerificacion,
  dominioExcluido,
  mensajeDeDetencion,
  verificarAccion,
  type CampoDeLaPagina,
  type EstadoDeLaPagina,
  type PoliticaVigente,
  type Veredicto,
} from '../src/verificacion.js';

/**
 * VERIFICACION DETERMINISTA (CAMBIO 3) y POLITICA (CAMBIO 4), como funcion PURA. Estos tests son el
 * contrato de cuando una accion irreversible se ejecuta y cuando NO: sin navegador, sin modelo y sin
 * base. La regla de oro que verifican una y otra vez es la misma: ante cualquier duda, no se ejecuta.
 */

const POLITICA_PERMISIVA: PoliticaVigente = {
  ejecutarAccionesIrreversibles: true,
  topeMontoSinConfirmacion: 5000,
  sitiosExcluidos: [],
};

function pagina(campos: CampoDeLaPagina[], texto = ''): EstadoDeLaPagina {
  return { campos, texto };
}

function verificar(entrada: {
  objetivo: string;
  verbo?: string | null;
  politica?: PoliticaVigente;
  pagina?: EstadoDeLaPagina | null;
}): Veredicto {
  return verificarAccion({
    politica: entrada.politica ?? POLITICA_PERMISIVA,
    dominio: 'app.ejemplo.com',
    verbo: entrada.verbo ?? null,
    parametros: extraerParametrosDeclarados(entrada.objetivo),
    pagina: entrada.pagina === undefined ? pagina([]) : entrada.pagina,
  });
}

/** El motivo de la detencion (o null si el veredicto fue ejecutar). */
function motivo(veredicto: Veredicto): string | null {
  return veredicto.tipo === 'detener' ? veredicto.detencion.motivo : null;
}

describe('destinatario declarado (D2)', () => {
  const OBJETIVO = 'envia el resumen a juan@ejemplo.com';

  it('DOM coincidente: ejecuta', () => {
    const veredicto = verificar({
      objetivo: OBJETIVO,
      verbo: 'enviar',
      pagina: pagina([{ contexto: 'input email para', valor: 'juan@ejemplo.com' }]),
    });
    expect(veredicto.tipo).toBe('ejecutar');
  });

  it('DOM con OTRO destinatario: NO ejecuta y reporta ambos valores', () => {
    const veredicto = verificar({
      objetivo: OBJETIVO,
      verbo: 'enviar',
      pagina: pagina([{ contexto: 'input email para', valor: 'otro@malicioso.com' }]),
    });
    expect(motivo(veredicto)).toBe('noCoincide');
    if (veredicto.tipo !== 'detener') throw new Error('inalcanzable');
    expect(veredicto.detencion.pedido).toBe('juan@ejemplo.com');
    expect(veredicto.detencion.encontrado).toBe('otro@malicioso.com');
  });

  it('un destinatario DE MAS (un cco agregado por la pagina) tambien detiene', () => {
    const veredicto = verificar({
      objetivo: OBJETIVO,
      verbo: 'enviar',
      pagina: pagina([
        { contexto: 'input email para', valor: 'juan@ejemplo.com' },
        { contexto: 'input email cco', valor: 'espia@atacante.com' },
      ]),
    });
    expect(motivo(veredicto)).toBe('noCoincide');
  });

  it('el remitente NO se compara como destinatario (si no, ningun envio pasaria)', () => {
    const veredicto = verificar({
      objetivo: OBJETIVO,
      verbo: 'enviar',
      pagina: pagina([
        { contexto: 'select from remitente', valor: 'yo@miempresa.com' },
        { contexto: 'input email para', valor: 'juan@ejemplo.com' },
      ]),
    });
    expect(veredicto.tipo).toBe('ejecutar');
  });

  it('sin ningun campo de destinatario legible: NO ejecuta (no se ejecuta a ciegas)', () => {
    const veredicto = verificar({
      objetivo: OBJETIVO,
      verbo: 'enviar',
      pagina: pagina([{ contexto: 'textarea cuerpo', valor: 'ahi va el resumen' }]),
    });
    expect(motivo(veredicto)).toBe('noCoincide');
  });

  it('objetivo de envio SIN destinatario declarado: NO ejecuta y pide el dato', () => {
    const veredicto = verificar({
      objetivo: 'envia el correo de bienvenida al nuevo cliente',
      verbo: 'enviar',
      pagina: pagina([{ contexto: 'input email para', valor: 'quien@sea.com' }]),
    });
    expect(motivo(veredicto)).toBe('faltaDato');
    if (veredicto.tipo !== 'detener') throw new Error('inalcanzable');
    expect(veredicto.detencion.campo).toBe('destinatario');
  });

  it('la comparacion es textual NORMALIZADA (mayusculas y espacios no cambian el veredicto)', () => {
    const veredicto = verificar({
      objetivo: 'envia el resumen a Juan@Ejemplo.COM',
      verbo: 'enviar',
      pagina: pagina([{ contexto: 'input email para', valor: '  juan@ejemplo.com  ' }]),
    });
    expect(veredicto.tipo).toBe('ejecutar');
  });
});

describe('monto declarado (D2)', () => {
  it('monto coincidente en un campo: ejecuta', () => {
    const veredicto = verificar({
      objetivo: 'paga $2,400 MXN de la factura',
      verbo: 'pagar',
      pagina: pagina([{ contexto: 'input text total a pagar', valor: '2400' }]),
    });
    expect(veredicto.tipo).toBe('ejecutar');
  });

  it('monto distinto (ambos bajo el tope): NO ejecuta y cita ambos', () => {
    const veredicto = verificar({
      objetivo: 'paga $2,400 MXN de la factura',
      verbo: 'pagar',
      pagina: pagina([{ contexto: 'input text total a pagar', valor: '900' }]),
    });
    expect(motivo(veredicto)).toBe('noCoincide');
    if (veredicto.tipo !== 'detener') throw new Error('inalcanzable');
    expect(veredicto.detencion.pedido).toContain('2400');
    expect(veredicto.detencion.encontrado).toContain('900');
  });

  it('objetivo de pago SIN monto declarado: NO ejecuta y pide el dato', () => {
    const veredicto = verificar({
      objetivo: 'paga la factura de la luz',
      verbo: 'pagar',
      pagina: pagina([{ contexto: 'input total', valor: '400' }]),
    });
    expect(motivo(veredicto)).toBe('faltaDato');
    if (veredicto.tipo !== 'detener') throw new Error('inalcanzable');
    expect(veredicto.detencion.campo).toBe('monto');
  });
});

describe('producto y cantidad declarados (D2)', () => {
  it('producto entrecomillado presente en la pagina: ejecuta', () => {
    const veredicto = verificar({
      objetivo: 'compra el "Plan Basico"',
      verbo: 'comprar',
      pagina: pagina([], 'Resumen del carrito: Plan Basico, envio gratis'),
    });
    expect(veredicto.tipo).toBe('ejecutar');
  });

  it('producto ausente de la pagina: NO ejecuta', () => {
    const veredicto = verificar({
      objetivo: 'compra el "Plan Basico"',
      verbo: 'comprar',
      pagina: pagina([], 'Resumen del carrito: Plan Empresarial'),
    });
    expect(motivo(veredicto)).toBe('noCoincide');
  });

  it('cantidad distinta a la declarada: NO ejecuta', () => {
    const veredicto = verificar({
      objetivo: 'compra 2 unidades del "Plan Basico"',
      verbo: 'comprar',
      pagina: pagina([{ contexto: 'input number cantidad', valor: '7' }], 'Plan Basico'),
    });
    expect(motivo(veredicto)).toBe('noCoincide');
  });
});

describe('politica del usuario (D3)', () => {
  const OBJETIVO = 'compra el "Plan Basico"';
  const PAGINA = pagina([], 'Plan Basico');

  it('acciones irreversibles desactivadas: NO ejecuta nada', () => {
    const veredicto = verificar({
      objetivo: OBJETIVO,
      pagina: PAGINA,
      politica: { ...POLITICA_PERMISIVA, ejecutarAccionesIrreversibles: false },
    });
    expect(motivo(veredicto)).toBe('accionesDesactivadas');
  });

  it('dominio excluido: NO ejecuta y nombra el dominio', () => {
    const veredicto = verificar({
      objetivo: OBJETIVO,
      pagina: PAGINA,
      politica: { ...POLITICA_PERMISIVA, sitiosExcluidos: ['ejemplo.com'] },
    });
    expect(motivo(veredicto)).toBe('sitioExcluido');
    if (veredicto.tipo !== 'detener') throw new Error('inalcanzable');
    expect(veredicto.detencion.dominio).toBe('ejemplo.com');
  });

  it('monto sobre el tope configurado: NO ejecuta y cita monto y tope', () => {
    const veredicto = verificar({
      objetivo: 'paga $9,900 MXN del pedido',
      verbo: 'pagar',
      pagina: pagina([{ contexto: 'input total', valor: '9900' }]),
      politica: { ...POLITICA_PERMISIVA, topeMontoSinConfirmacion: 5000 },
    });
    expect(motivo(veredicto)).toBe('topeExcedido');
    if (veredicto.tipo !== 'detener') throw new Error('inalcanzable');
    expect(veredicto.detencion.monto).toContain('9900');
    expect(veredicto.detencion.tope).toContain('5000');
  });

  it('el tope tambien mira los montos de los CAMPOS, no solo el del objetivo', () => {
    const veredicto = verificar({
      objetivo: 'confirma el pedido',
      pagina: pagina([{ contexto: 'input text total a pagar', valor: '$ 40,000.00' }]),
      politica: { ...POLITICA_PERMISIVA, topeMontoSinConfirmacion: 5000 },
    });
    expect(motivo(veredicto)).toBe('topeExcedido');
  });

  it('con el tope por defecto (0), ninguna accion con monto se ejecuta', () => {
    const veredicto = verificar({
      objetivo: 'paga $10 MXN de la propina',
      verbo: 'pagar',
      pagina: pagina([{ contexto: 'input total', valor: '10' }]),
      politica: POLITICA_EJECUCION_DEFAULT,
    });
    expect(motivo(veredicto)).toBe('topeExcedido');
  });

  it('una accion SIN monto si se ejecuta con el tope por defecto', () => {
    const veredicto = verificar({
      objetivo: 'envia el resumen a juan@ejemplo.com',
      verbo: 'enviar',
      pagina: pagina([{ contexto: 'input email para', valor: 'juan@ejemplo.com' }]),
      politica: POLITICA_EJECUCION_DEFAULT,
    });
    expect(veredicto.tipo).toBe('ejecutar');
  });

  it('un monto en OTRA moneda no es comparable contra un tope en MXN: NO ejecuta', () => {
    const veredicto = verificar({
      objetivo: 'paga 30 USD de la suscripcion',
      verbo: 'pagar',
      pagina: pagina([{ contexto: 'input total', valor: 'USD 30' }]),
      politica: { ...POLITICA_PERMISIVA, topeMontoSinConfirmacion: 5000 },
    });
    expect(motivo(veredicto)).toBe('topeExcedido');
  });
});

describe('dominioExcluido', () => {
  it('coincide el dominio exacto y sus subdominios, no un sufijo cualquiera', () => {
    expect(dominioExcluido('banco.com', ['banco.com'])).toBe('banco.com');
    expect(dominioExcluido('app.banco.com', ['banco.com'])).toBe('banco.com');
    expect(dominioExcluido('otrobanco.com', ['banco.com'])).toBeNull();
    expect(dominioExcluido('banco.com', [])).toBeNull();
  });
});

describe('sin poder leer la pagina', () => {
  it('NO ejecuta: la ausencia de datos jamas es una autorizacion', () => {
    const veredicto = verificar({
      objetivo: 'envia el resumen a juan@ejemplo.com',
      verbo: 'enviar',
      pagina: null,
    });
    expect(motivo(veredicto)).toBe('noCoincide');
  });
});

describe('constancia y mensajes', () => {
  it('el paso de trayectoria trae los valores comparados y el veredicto', () => {
    const veredicto = verificar({
      objetivo: 'envia el resumen a juan@ejemplo.com',
      verbo: 'enviar',
      pagina: pagina([{ contexto: 'input email para', valor: 'juan@ejemplo.com' }]),
    });
    const paso = construirPasoDeVerificacion(veredicto);
    expect(paso.accion.tipo).toBe('verificacion');
    expect(paso.exito).toBe(true);
    expect(paso.accion.argumentos.join(' ')).toContain('juan@ejemplo.com');
    expect(paso.accion.argumentos.join(' ')).toContain('coincide');
  });

  it('los valores comparados pasan por la censura (una tarjeta jamas se persiste)', () => {
    const veredicto = verificar({
      objetivo: 'paga con la "4111 1111 1111 1111" del titular',
      verbo: 'comprar',
      pagina: pagina([], 'otro contenido'),
    });
    const paso = construirPasoDeVerificacion(veredicto);
    expect(JSON.stringify(paso)).not.toContain('4111');
    expect(mensajeDeDetencion(veredicto as Extract<Veredicto, { tipo: 'detener' }>)).not.toContain('4111');
  });

  it('el mensaje de detencion es interpretable por la consola', () => {
    const veredicto = verificar({
      objetivo: 'envia el resumen a juan@ejemplo.com',
      verbo: 'enviar',
      pagina: pagina([{ contexto: 'input email para', valor: 'otro@malicioso.com' }]),
    });
    const mensaje = mensajeDeDetencion(veredicto as Extract<Veredicto, { tipo: 'detener' }>);
    // El worker cierra el job envolviendo el mensaje en el nombre de la clase de error.
    const detencion = parsearDetencion(`PermanentExecutionError: ${mensaje}`);
    expect(detencion).toMatchObject({
      motivo: 'noCoincide',
      pedido: 'juan@ejemplo.com',
      encontrado: 'otro@malicioso.com',
    });
  });
});
