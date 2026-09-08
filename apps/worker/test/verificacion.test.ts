import { describe, it, expect } from 'vitest';
import { POLITICA_EJECUCION_DEFAULT, parsearDetencion } from '@ledesma-platform/shared';
import { extraerParametrosDeclarados } from '../src/parametros-objetivo.js';
import {
  accionSurtioEfecto,
  construirPasoDeVerificacion,
  desenlaceDelEfecto,
  dominioExcluido,
  formularioVerificadoPresente,
  mensajeDeDetencion,
  mensajeDeIncompleto,
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

  it('sin ningun campo de destinatario legible: NO ejecuta (todavia falta escribirlo)', () => {
    const veredicto = verificar({
      objetivo: OBJETIVO,
      verbo: 'enviar',
      pagina: pagina([{ contexto: 'textarea cuerpo', valor: 'ahi va el resumen' }]),
    });
    // El dato no esta en la pagina: la accion NO pasa, pero la tarea puede seguir para que el agente
    // termine de llenar el formulario (CAMBIO 1). Lo que jamas ocurre es ejecutar.
    expect(veredicto.tipo).toBe('incompleto');
    if (veredicto.tipo !== 'incompleto') throw new Error('inalcanzable');
    expect(veredicto.faltantes).toEqual(['destinatario']);
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
    expect(veredicto.tipo).toBe('incompleto');
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

/**
 * CAMBIO 1: el caso EXACTO de produccion. El objetivo declara destinatario, asunto y cuerpo; el
 * agente propone una accion con pinta de envio cuando solo el destinatario esta escrito. Antes la
 * verificacion se daba por superada comparando UN parametro y la accion se iba al navegador con el
 * correo a medio redactar.
 */
describe('todos los parametros declarados o ninguna accion (CAMBIO 1)', () => {
  const OBJETIVO =
    'envia a juan@ejemplo.com un correo con asunto "Reporte de agosto" y cuerpo "Adjunto el reporte"';
  const DESTINATARIO = { contexto: 'input email para', valor: 'juan@ejemplo.com' };
  const ASUNTO = { contexto: 'input asunto', valor: 'Reporte de agosto' };
  const CUERPO = { contexto: 'div contenteditable cuerpo del mensaje', valor: 'Adjunto el reporte' };

  it('con 1 de 3 parametros en el DOM la verificacion NO se supera', () => {
    const veredicto = verificar({
      objetivo: OBJETIVO,
      verbo: 'enviar',
      pagina: pagina([DESTINATARIO]),
    });
    expect(veredicto.tipo).toBe('incompleto');
    if (veredicto.tipo !== 'incompleto') throw new Error('inalcanzable');
    expect(veredicto.faltantes).toEqual(['asunto', 'cuerpo']);
    // Se compararon los TRES parametros declarados; lo que falla es que dos no estan en la pagina.
    expect(veredicto.comparaciones).toHaveLength(3);
  });

  it('con 2 de 3 tampoco: falta uno y con eso basta', () => {
    const veredicto = verificar({
      objetivo: OBJETIVO,
      verbo: 'enviar',
      pagina: pagina([DESTINATARIO, ASUNTO]),
    });
    expect(veredicto.tipo).toBe('incompleto');
  });

  it('con los 3 presentes y coincidentes: EJECUTAR', () => {
    const veredicto = verificar({
      objetivo: OBJETIVO,
      verbo: 'enviar',
      pagina: pagina([DESTINATARIO, ASUNTO, CUERPO]),
    });
    expect(veredicto.tipo).toBe('ejecutar');
    expect(veredicto.comparaciones.every((c) => c.coincide)).toBe(true);
  });

  it('el cuerpo tolera lo que el sitio agrega despues (una firma no cambia lo pedido)', () => {
    const veredicto = verificar({
      objetivo: OBJETIVO,
      verbo: 'enviar',
      pagina: pagina([
        DESTINATARIO,
        ASUNTO,
        { ...CUERPO, valor: 'Adjunto el reporte\n--\nEnviado desde mi telefono' },
      ]),
    });
    expect(veredicto.tipo).toBe('ejecutar');
  });

  it('un destinatario SUSTITUIDO detiene la tarea, no la deja seguir', () => {
    // La distincion que importa: un dato que falta se puede terminar de escribir; un dato CAMBIADO
    // es otra accion distinta de la pedida y ahi la tarea termina.
    const veredicto = verificar({
      objetivo: OBJETIVO,
      verbo: 'enviar',
      pagina: pagina([{ ...DESTINATARIO, valor: 'otro@atacante.com' }, ASUNTO, CUERPO]),
    });
    expect(motivo(veredicto)).toBe('noCoincide');
  });
});

/** CAMBIO 4: la accion irreversible se da por hecha leyendo el DOM, jamas por lo que diga el modelo. */
describe('accionSurtioEfecto', () => {
  const parametros = extraerParametrosDeclarados('envia el resumen a juan@ejemplo.com');
  const antes = pagina([{ contexto: 'input email para', valor: 'juan@ejemplo.com' }]);

  it('la ventana de redaccion se cerro: confirmada', () => {
    expect(accionSurtioEfecto({ parametros, antes, despues: pagina([]) })).toBe(true);
  });

  it('el sitio muestra su confirmacion: confirmada aunque el formulario siga', () => {
    expect(
      accionSurtioEfecto({ parametros, antes, despues: pagina(antes.campos, 'Mensaje enviado. Deshacer') }),
    ).toBe(true);
  });

  it('la pagina sigue igual: NO confirmada (nunca se da por hecha una accion sin rastro)', () => {
    expect(accionSurtioEfecto({ parametros, antes, despues: antes })).toBe(false);
  });

  it('que la pagina CAMBIE no es evidencia de nada (CAMBIO 2)', () => {
    // Entre dos lecturas del DOM casi cualquier pagina viva cambia (un contador, un aviso, un
    // reloj). Se exige el aviso de exito o el cierre del contenedor, nunca "algo se movio".
    const sinParametros = extraerParametrosDeclarados('borra el archivo viejo del panel');
    const vacia = pagina([], 'panel de archivos');
    expect(accionSurtioEfecto({ parametros: sinParametros, antes: vacia, despues: vacia })).toBe(false);
    expect(
      accionSurtioEfecto({
        parametros: sinParametros,
        antes: vacia,
        despues: pagina([], 'panel de archivos (vacio)'),
      }),
    ).toBe(false);
    // Con el aviso explicito del sitio SI se confirma.
    expect(
      accionSurtioEfecto({
        parametros: sinParametros,
        antes: vacia,
        despues: pagina([], 'el archivo se elimino'),
      }),
    ).toBe(true);
  });

  /**
   * EL FALSO POSITIVO DE PRODUCCION (CAMBIO 2). Gmail convierte el destinatario tecleado en un CHIP:
   * el input queda vacio y el lector de campos descarta los valores vacios, asi que el dato
   * "desaparece" de los campos sin que nada se haya enviado. Antes eso se leia como accion
   * consumada y un correo jamas enviado se reporto como enviado.
   */
  describe('un campo convertido en chip NO es una accion confirmada', () => {
    const OBJETIVO =
      'envia a juan@ejemplo.com un correo con asunto "Reporte de agosto" y cuerpo "Adjunto el reporte"';
    const parametros = extraerParametrosDeclarados(OBJETIVO);
    const DESTINATARIO = { contexto: 'input email para', valor: 'juan@ejemplo.com' };
    const ASUNTO = { contexto: 'input asunto', valor: 'Reporte de agosto' };
    const CUERPO = { contexto: 'div contenteditable cuerpo', valor: 'Adjunto el reporte' };
    const antes = pagina([DESTINATARIO, ASUNTO, CUERPO]);

    it('el redactor sigue abierto con el destinatario en chip: NO confirmada', () => {
      // El campo del destinatario ya no aparece (su valor quedo vacio), pero el asunto y el cuerpo
      // siguen ahi: la ventana de redaccion no se cerro.
      const despues = pagina([ASUNTO, CUERPO], 'Para: juan@ejemplo.com');
      expect(accionSurtioEfecto({ parametros, antes, despues })).toBe(false);
    });

    it('la desaparicion del formulario verificado ES exito, aunque el dato siga legible (FIX B)', () => {
      // DECISION DE FIX B (27 jul): al enviar con exito, Gmail CIERRA el compose y el hilo muestra
      // el mensaje recien enviado, asi que exigir ademas que los datos declarados no fueran
      // legibles en la pagina volvia INCONFIRMABLE un envio real. El caso del chip que vaciaba el
      // campo ya no puede confundirse con esto: el lector lee los chips como valor del campo
      // (lector-campos-dom.test.ts), asi que un chip MANTIENE el campo presente en la foto.
      const soloDestinatario = pagina([DESTINATARIO]);
      const despues = pagina([], 'Conversacion  Para: juan@ejemplo.com');
      expect(accionSurtioEfecto({ parametros, antes: soloDestinatario, despues })).toBe(true);
    });

    it('con el lector corregido el chip MANTIENE el campo presente: NO confirmada (CAMBIO 3)', () => {
      // El lector ahora devuelve el chip como valor del campo Para: la foto siguiente tiene los
      // mismos campos que la previa y el criterio del contenedor ni siquiera se acerca a confirmar.
      // "El dato se volvio chip" ya no puede confundirse con "el contenedor desaparecio".
      const despues = pagina([DESTINATARIO, ASUNTO, CUERPO]);
      expect(accionSurtioEfecto({ parametros, antes, despues })).toBe(false);
    });

    it('el redactor se cerro de verdad: confirmada', () => {
      expect(accionSurtioEfecto({ parametros, antes, despues: pagina([], 'Bandeja de entrada') })).toBe(
        true,
      );
    });

    it('el sitio muestra su aviso de exito: confirmada aunque el redactor siga', () => {
      expect(
        accionSurtioEfecto({ parametros, antes, despues: pagina(antes.campos, 'Mensaje enviado') }),
      ).toBe(true);
    });
  });

  /**
   * FIX B: los TRES desenlaces del clic irreversible. El caso critico de produccion (27 jul): al
   * enviar con exito Gmail CIERRA el compose, asi que la desaparicion del formulario verificado ES
   * el efecto esperado del exito; el compose minimizado (campos presentes pero colapsados, y el
   * lector incluye ocultos) sigue siendo SIN efecto.
   */
  describe('desenlaceDelEfecto (FIX B): sin cambio, formulario presente y desaparicion', () => {
    const OBJETIVO =
      'envia a juan@ejemplo.com un correo con asunto "Reporte de agosto" y cuerpo "Adjunto el reporte"';
    const parametros = extraerParametrosDeclarados(OBJETIVO);
    const PARA = { contexto: 'input email para', valor: 'juan@ejemplo.com' };
    const ASUNTO = { contexto: 'input subjectbox asunto', valor: 'Reporte de agosto' };
    const CUERPO = { contexto: 'div contenteditable cuerpo del mensaje', valor: 'Adjunto el reporte' };
    /** La barra de busqueda llena: un campo AJENO al compose que persiste tras el envio. */
    const BUSCADOR = { contexto: 'input text buscar correo', valor: 'facturas' };
    const antes = pagina([BUSCADOR, PARA, ASUNTO, CUERPO]);

    it('compose presente antes y AUSENTE despues: efecto confirmado', () => {
      // El hilo muestra el mensaje recien enviado y el buscador sigue lleno: nada de eso niega el
      // exito, porque el formulario VERIFICADO (los campos con los datos declarados) desaparecio.
      const despues = pagina([BUSCADOR], 'Conversacion  Reporte de agosto  Adjunto el reporte');
      expect(desenlaceDelEfecto({ parametros, antes, despues })).toBe('confirmado');
      expect(accionSurtioEfecto({ parametros, antes, despues })).toBe(true);
    });

    it('compose intacto: sin efecto', () => {
      expect(desenlaceDelEfecto({ parametros, antes, despues: antes })).toBe('formulario_presente');
      expect(accionSurtioEfecto({ parametros, antes, despues: antes })).toBe(false);
    });

    it('compose MINIMIZADO (presente pero colapsado): sin efecto', () => {
      // El lector de campos incluye los ocultos a proposito, asi que un compose minimizado sigue
      // aportando sus campos a la foto: el formulario verificado sigue presente.
      const despues = pagina([BUSCADOR, PARA, ASUNTO, CUERPO], 'Nuevo mensaje (minimizado)');
      expect(desenlaceDelEfecto({ parametros, antes, despues })).toBe('formulario_presente');
      expect(accionSurtioEfecto({ parametros, antes, despues })).toBe(false);
    });

    it('sin campos verificados en la foto previa: jamas se confirma por desaparicion', () => {
      const vacia = pagina([], 'panel');
      expect(desenlaceDelEfecto({ parametros, antes: vacia, despues: vacia })).toBe(
        'sin_rastro_previo',
      );
    });
  });

  /** FIX A (doble seguridad): ¿el formulario con los datos verificados sigue presente? */
  describe('formularioVerificadoPresente', () => {
    const parametros = extraerParametrosDeclarados('envia el resumen a juan@ejemplo.com');
    const PARA = { contexto: 'input email para', valor: 'juan@ejemplo.com' };
    const BUSCADOR = { contexto: 'input text buscar', valor: 'facturas' };
    const antes = pagina([BUSCADOR, PARA]);

    it('presente mientras el campo verificado siga en la pagina', () => {
      expect(formularioVerificadoPresente(parametros, antes, pagina([BUSCADOR, PARA]))).toBe(true);
    });

    it('ausente cuando el campo verificado desaparecio (aunque el resto siga): efecto probable', () => {
      expect(formularioVerificadoPresente(parametros, antes, pagina([BUSCADOR]))).toBe(false);
    });
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
    // El verbo del objetivo ("confirmar pedido") es de la familia comprar, que SI maneja dinero: por
    // eso los montos leidos de los campos entran a la comparacion contra el tope (D4).
    const veredicto = verificar({
      objetivo: 'confirma el pedido',
      verbo: 'confirmar pedido',
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
  it('NO ejecuta y lo dice como NO LEIBLE, no como "aparecia nada" (CAMBIO 2)', () => {
    const veredicto = verificar({
      objetivo: 'envia el resumen a juan@ejemplo.com',
      verbo: 'enviar',
      pagina: null,
    });
    expect(motivo(veredicto)).toBe('noLeible');
    if (veredicto.tipo !== 'detener') throw new Error('inalcanzable');
    // FIX C: lo que no se pudo leer fue LA PAGINA, no un dato del usuario. Nombrar el destinatario
    // aqui producia "No pudimos leer a quien enviarlo" con el destinatario escrito y visible.
    expect(veredicto.detencion.campo).toBeUndefined();
    expect(veredicto.detencion.detalle).toBe('no se pudo leer el estado de la pagina antes de ejecutar');
  });
});

/**
 * CAMBIO 1 y CAMBIO 2: el caso EXACTO de la evidencia de produccion. Gmail convierte el destinatario
 * confirmado en un CHIP: el input queda vacio y el correo pasa a vivir en un elemento con atributos.
 * El lector ahora devuelve el chip como valor del campo; y cuando un campo existe pero su valor no
 * se pudo determinar, eso es NO LEIBLE, que es un veredicto DISTINTO de "esta vacio".
 */
describe('chips y campos no leibles (CAMBIO 1 y 2)', () => {
  const OBJETIVO = 'envia el resumen a juan@ejemplo.com';

  it('un destinatario convertido en chip (leido como valor del campo) supera la verificacion', () => {
    // El lector ya asocio el valor del chip al campo Para: para la verificacion es un campo mas.
    const veredicto = verificar({
      objetivo: OBJETIVO,
      verbo: 'enviar',
      pagina: pagina([{ contexto: 'input text destinatarios en para', valor: 'juan@ejemplo.com' }]),
    });
    expect(veredicto.tipo).toBe('ejecutar');
  });

  it('campo de destinatario VACIO: incompleto (falta escribirlo y la tarea sigue)', () => {
    const veredicto = verificar({
      objetivo: OBJETIVO,
      verbo: 'enviar',
      pagina: pagina([{ contexto: 'textarea cuerpo', valor: 'ahi va' }]),
    });
    expect(veredicto.tipo).toBe('incompleto');
  });

  it('campo de destinatario NO LEIBLE: detiene con noLeible (no se puede comprobar)', () => {
    const veredicto = verificar({
      objetivo: OBJETIVO,
      verbo: 'enviar',
      pagina: pagina([{ contexto: 'input text destinatarios en para', valor: '', noLeible: true }]),
    });
    expect(motivo(veredicto)).toBe('noLeible');
    if (veredicto.tipo !== 'detener') throw new Error('inalcanzable');
    expect(veredicto.detencion.campo).toBe('destinatario');
    // El mensaje serializado es interpretable por la consola, que dira "no pudimos leer", no "nada".
    const detencion = parsearDetencion(
      `PermanentExecutionError: ${mensajeDeDetencion(veredicto)}`,
    );
    expect(detencion).toMatchObject({ motivo: 'noLeible', campo: 'destinatario' });
  });

  it('vacio y no leible producen veredictos DISTINTOS (la distincion del CAMBIO 2)', () => {
    const vacio = verificar({ objetivo: OBJETIVO, verbo: 'enviar', pagina: pagina([]) });
    const noLeible = verificar({
      objetivo: OBJETIVO,
      verbo: 'enviar',
      pagina: pagina([{ contexto: 'input para', valor: '', noLeible: true }]),
    });
    expect(vacio.tipo).toBe('incompleto');
    expect(noLeible.tipo).toBe('detener');
  });

  it('con un chip LEGIBLE el campo no leible de al lado no estorba la comparacion', () => {
    // El correo se leyo (de un chip o del input): hay valor con que comparar y ese valor decide.
    const veredicto = verificar({
      objetivo: OBJETIVO,
      verbo: 'enviar',
      pagina: pagina([
        { contexto: 'input text destinatarios en para', valor: 'juan@ejemplo.com' },
        { contexto: 'input cc', valor: '', noLeible: true },
      ]),
    });
    expect(veredicto.tipo).toBe('ejecutar');
  });

  it('un chip con OTRO destinatario sigue deteniendo con noCoincide (nada se relajo)', () => {
    const veredicto = verificar({
      objetivo: OBJETIVO,
      verbo: 'enviar',
      pagina: pagina([{ contexto: 'input text destinatarios en para', valor: 'otro@atacante.com' }]),
    });
    expect(motivo(veredicto)).toBe('noCoincide');
  });

  it('el asunto no leible tambien detiene con noLeible', () => {
    const veredicto = verificar({
      objetivo: 'envia a juan@ejemplo.com un correo con asunto "Reporte"',
      verbo: 'enviar',
      pagina: pagina([
        { contexto: 'input email para', valor: 'juan@ejemplo.com' },
        { contexto: 'input asunto', valor: '', noLeible: true },
      ]),
    });
    expect(motivo(veredicto)).toBe('noLeible');
    if (veredicto.tipo !== 'detener') throw new Error('inalcanzable');
    expect(veredicto.detencion.campo).toBe('asunto');
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
      // El numero SI esta en la pagina: la comparacion coincide y llega al paso de la trayectoria.
      pagina: pagina([], 'pagando con 4111 1111 1111 1111'),
    });
    const paso = construirPasoDeVerificacion(veredicto);
    expect(JSON.stringify(paso)).not.toContain('4111');
  });

  it('el mensaje de una verificacion incompleta nombra los datos, nunca sus valores', () => {
    const veredicto = verificar({
      objetivo: 'paga con la "4111 1111 1111 1111" del titular',
      verbo: 'comprar',
      pagina: pagina([], 'otro contenido'),
    });
    expect(veredicto.tipo).toBe('incompleto');
    const mensaje = mensajeDeIncompleto(veredicto as Extract<Veredicto, { tipo: 'incompleto' }>);
    expect(mensaje).toContain('producto');
    expect(mensaje).not.toContain('4111');
    // No es una detencion: no lleva el prefijo con el que la consola cierra una tarea detenida.
    expect(mensaje).not.toContain('DETENIDA_VERIFICACION');
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
