import { describe, it, expect } from 'vitest';
import {
  esElementoDeSoloLectura,
  esNavegacionDeSoloLectura,
  detectarAccionQueExigeVerificacion,
} from '../src/prompt-tarea-web.js';
import { verificarAccion } from '../src/verificacion.js';
import type { CampoDeLaPagina, PoliticaVigente, Veredicto } from '../src/verificacion.js';
import { extraerParametrosDeclarados } from '../src/parametros-objetivo.js';

/**
 * LA EXENCION DE SOLO LECTURA, RECONOCIDA POR CATEGORIA. Modulo puro: sin navegador, sin modelo y
 * sin base.
 *
 * EL HUECO QUE CIERRA, medido antes de escribir una linea. Sobre 21 descripciones de solo lectura
 * reales, la version por sustantivos eximia 6 y dejaba 15 bajo guardia, y esas 15 son la mayoria de
 * los pasos intermedios de cualquier corrida del motor libre: navegar a una url, volver atras,
 * buscar, filtrar, abrir el primer correo, esperar a que cargue, recargar, pasar el cursor por una
 * fila, el boton de buscar, Enter para ejecutar la busqueda, el engrane de ajustes y cerrar un aviso
 * de cookies. Con la guardia invertida en modo activo, el agente se detendria en el primer paso de
 * navegacion de casi toda tarea, asi que la guardia no se podia encender.
 *
 * Y 2 de las 6 exenciones eran ACCIDENTALES: "refresh the inbox" se eximia por la palabra `inbox` y
 * "espera a que cargue la bandeja" por la palabra `bandeja`. La exencion reconocia sustantivos, no la
 * categoria de la accion.
 *
 * LA REGLA QUE ESTOS TESTS FIJAN: la exencion reconoce la CATEGORIA de una accion de solo lectura por
 * senales genericas -- lo que la accion HACE y lo que el elemento ES -- y NUNCA relaja la guardia
 * sobre una accion que consuma o modifique, por mucho que su descripcion nombre una navegacion.
 */

// -------------------------------------------------------------------------------------------------
// BATERIA A: las 21 descripciones de solo lectura de la auditoria de la guardia invertida
// -------------------------------------------------------------------------------------------------

/** Las 6 que la version por sustantivos ya eximia. Ninguna puede perderse con la reescritura. */
const YA_EXENTAS: readonly { texto: string; categoria: string }[] = [
  { texto: 'lee el resumen de la bandeja', categoria: 'leer' },
  { texto: 'scroll down to see more messages', categoria: 'desplazar' },
  { texto: 'click the Enviados link in the Gmail left sidebar', categoria: 'elemento de navegacion' },
  { texto: 'extract the list of unread messages', categoria: 'leer' },
  { texto: 'refresh the inbox', categoria: 'recargar' },
  { texto: 'espera a que cargue la bandeja', categoria: 'esperar' },
];

/**
 * LAS 15 QUE LA VERSION POR SUSTANTIVOS DEJABA BAJO GUARDIA. Una por una y con nombre propio: es la
 * lista exacta que la medicion de la guardia invertida reporto, y la razon por la que su modo activo
 * no se podia encender.
 */
const ANTES_BAJO_GUARDIA: readonly { texto: string; categoria: string }[] = [
  { texto: 'navega a https://correo.ejemplo.com/mail/u/0', categoria: 'navegar' },
  { texto: 'vuelve a la pagina anterior', categoria: 'volver' },
  { texto: 'go back to the previous page', categoria: 'volver' },
  { texto: 'busca el correo de ana', categoria: 'buscar' },
  { texto: 'search for the message from ana', categoria: 'buscar' },
  { texto: 'filtra por mensajes no leidos', categoria: 'filtrar' },
  { texto: 'open the first email', categoria: 'abrir' },
  { texto: 'espera a que la lista termine de cargar', categoria: 'esperar' },
  { texto: 'recarga la pagina', categoria: 'recargar' },
  { texto: 'reload the page', categoria: 'recargar' },
  { texto: 'pasa el cursor por la primera fila', categoria: 'pasar el cursor' },
  { texto: 'click the Search button', categoria: 'buscar' },
  { texto: 'pulsa Enter para ejecutar la busqueda', categoria: 'buscar' },
  { texto: 'abre el engrane de ajustes', categoria: 'abrir' },
  { texto: 'cierra el aviso de cookies', categoria: 'cerrar un aviso' },
];

describe('las 15 descripciones que la version por sustantivos dejaba bajo guardia', () => {
  for (const { texto, categoria } of ANTES_BAJO_GUARDIA) {
    it(`se exime por su categoria (${categoria}): "${texto}"`, () => {
      expect(esNavegacionDeSoloLectura(texto)).toBe(true);
    });
  }

  it('las 15 completas quedan exentas: cero pasos de navegacion bajo guardia', () => {
    expect(ANTES_BAJO_GUARDIA.filter((c) => !esNavegacionDeSoloLectura(c.texto))).toEqual([]);
  });
});

describe('las 6 que ya estaban exentas siguen exentas', () => {
  for (const { texto, categoria } of YA_EXENTAS) {
    it(`sigue exenta por su categoria (${categoria}): "${texto}"`, () => {
      expect(esNavegacionDeSoloLectura(texto)).toBe(true);
    });
  }

  it('la bateria completa de 21 queda exenta', () => {
    const bateria = [...YA_EXENTAS, ...ANTES_BAJO_GUARDIA];
    expect(bateria.length).toBe(21);
    expect(bateria.filter((c) => !esNavegacionDeSoloLectura(c.texto))).toEqual([]);
  });
});

// -------------------------------------------------------------------------------------------------
// BATERIA B: 20 pasos intermedios REALES, tomados de las trazas y los fixtures del repo
// -------------------------------------------------------------------------------------------------

/**
 * La segunda mitad de la medicion: pasos que aparecen tal cual en las trazas de produccion y en los
 * fixtures del worker. El objetivo declarado tiene dos mitades y las dos se fijan aqui: ningun paso
 * de navegacion, busqueda, filtrado, apertura, espera o desplazamiento queda bajo guardia, y ningun
 * paso que consuma o modifique queda eximido.
 */
const PASOS_REALES: readonly { texto: string; exime: boolean }[] = [
  { texto: 'click Sent folder', exime: true },
  { texto: 'abre la carpeta Enviados', exime: true },
  { texto: 'scroll to the sent messages', exime: true },
  { texto: 'lee la bandeja de Enviados', exime: true },
  { texto: 'abrir la bandeja de entrada', exime: true },
  { texto: 'abre el ultimo correo de facturas', exime: true },
  { texto: 'busca el resumen mensual en la bandeja', exime: true },
  { texto: 'click the Search button', exime: true },
  { texto: 'leer los campos del formulario', exime: true },
  { texto: 'ir a la bandeja', exime: true },
  { texto: 'click the Enviar button in the compose window', exime: false },
  { texto: 'click the Send button again', exime: false },
  { texto: 'press Ctrl+Enter to send', exime: false },
  { texto: 'type "juan@ejemplo.com" into the Para field', exime: false },
  { texto: 'type Reporte semanal into the subject field', exime: false },
  { texto: 'click the Submit button', exime: false },
  { texto: 'haz clic en el boton Eliminar', exime: false },
  { texto: 'abre el menu y elimina la cuenta', exime: false },
  { texto: 'abrir opciones de envio', exime: false },
  { texto: 'click the "Comprar ahora" button', exime: false },
];

describe('20 pasos intermedios reales de las trazas del repo', () => {
  for (const { texto, exime } of PASOS_REALES) {
    it(`${exime ? 'se exime' : 'queda bajo guardia'}: "${texto}"`, () => {
      expect(esNavegacionDeSoloLectura(texto)).toBe(exime);
    });
  }

  it('la bateria de 20 queda partida en 10 y 10, sin ninguno fuera de objetivo', () => {
    expect(PASOS_REALES.length).toBe(20);
    expect(PASOS_REALES.filter((c) => c.exime).length).toBe(10);
    expect(PASOS_REALES.filter((c) => esNavegacionDeSoloLectura(c.texto) !== c.exime)).toEqual([]);
  });
});

// -------------------------------------------------------------------------------------------------
// LAS DOS EXENCIONES ACCIDENTALES: se eximian por un sustantivo, ahora por su categoria
// -------------------------------------------------------------------------------------------------

describe('las exenciones accidentales dejan de depender de inbox y de bandeja', () => {
  it('"refresh the inbox" se exime sin la palabra inbox', () => {
    expect(esNavegacionDeSoloLectura('refresh the inbox')).toBe(true);
    // La MISMA frase sin el sustantivo que la eximia por accidente: la categoria es recargar.
    expect(esNavegacionDeSoloLectura('refresh the list')).toBe(true);
    expect(esNavegacionDeSoloLectura('refresh')).toBe(true);
  });

  it('"espera a que cargue la bandeja" se exime sin la palabra bandeja', () => {
    expect(esNavegacionDeSoloLectura('espera a que cargue la bandeja')).toBe(true);
    expect(esNavegacionDeSoloLectura('espera a que cargue')).toBe(true);
    expect(esNavegacionDeSoloLectura('espera a que cargue el listado')).toBe(true);
  });

  it('el sustantivo SOLO ya no exime nada: sin categoria no hay exencion', () => {
    // Ninguna de estas nombra una accion de solo lectura, asi que la falla cerrada las deja bajo
    // guardia aunque mencionen el destino. Antes, "inbox" y "bandeja" bastaban.
    expect(esNavegacionDeSoloLectura('inbox')).toBe(false);
    expect(esNavegacionDeSoloLectura('la bandeja')).toBe(false);
  });
});

// -------------------------------------------------------------------------------------------------
// EL VETO: nada que consuma o modifique se exime, por mucha palabra de navegacion que lleve
// -------------------------------------------------------------------------------------------------

/** Pasos que CONSUMAN o MODIFIQUEN, cada uno con una palabra de navegacion o de lectura al lado. */
const CONSUMEN_O_MODIFICAN: readonly string[] = [
  'abre el menu y elimina la cuenta',
  'abre el menu y envia el correo',
  'abre la carpeta y borra el mensaje',
  'busca la factura y paga el total',
  'open the settings menu and delete the account',
  'go to the cart and buy the item',
  'scroll down and publish the post',
  'lee el aviso y confirma en el modal',
  'abre el dialogo y confirma el pedido',
  'navega al perfil y guarda los cambios',
  'abre el menu y archiva la conversacion',
  'abre el menu y mueve el correo a la papelera',
  'abre el menu y desactiva la cuenta',
  'abre el menu y vacia la papelera',
  'abre el panel y revoca el acceso',
  'busca el campo y escribe el destinatario',
  'open the compose window and type the subject',
  'abre el formulario y haz submit',
];

describe('un paso que consuma o modifique jamas se exime', () => {
  for (const texto of CONSUMEN_O_MODIFICAN) {
    it(`queda bajo guardia: "${texto}"`, () => {
      expect(esNavegacionDeSoloLectura(texto)).toBe(false);
    });
  }

  it('el caso de la especificacion: "abre el menu y elimina la cuenta"', () => {
    // La version por sustantivos lo eximia: "menu" era un destino de navegacion y no habia ningun
    // gatillo (ni boton, ni tecla) que anulara la excepcion. Era un permiso para borrar una cuenta.
    expect(esNavegacionDeSoloLectura('abre el menu y elimina la cuenta')).toBe(false);
  });

  it('la accion irreversible del objetivo sigue exigiendo verificacion (FIX F intacto)', () => {
    // Lo que la ampliacion NO puede aflojar: el clic que consuma sigue pasando por la comparacion.
    expect(detectarAccionQueExigeVerificacion('click the Enviar button', 'enviar')).toBe('enviar');
    expect(detectarAccionQueExigeVerificacion('press Ctrl+Enter to send', 'enviar')).toBe('send');
    expect(detectarAccionQueExigeVerificacion('click the Submit button', 'enviar')).toBe('submit');
    expect(detectarAccionQueExigeVerificacion('click the "Comprar ahora" button', 'comprar')).toBe(
      'comprar',
    );
  });

  it('un nombre de destino no convierte la navegacion en la accion (FIX F intacto)', () => {
    // El bug original: "Enviados" matchea el patron de enviar y "sent" matchea \bsent\b, pero son el
    // nombre de una carpeta. Un PARTICIPIO junto a un sustantivo de destino nombra un lugar.
    expect(esNavegacionDeSoloLectura('click the Enviados link in the Gmail left sidebar')).toBe(true);
    expect(esNavegacionDeSoloLectura('click Sent folder')).toBe(true);
    expect(esNavegacionDeSoloLectura('abre la carpeta Enviados')).toBe(true);
    expect(esNavegacionDeSoloLectura('scroll to the sent messages')).toBe(true);
    expect(esNavegacionDeSoloLectura('lee la bandeja de Enviados')).toBe(true);
  });

  it('un INFINITIVO junto al mismo sustantivo de destino SI es la accion del paso', () => {
    // La contracara del caso anterior, y la razon de que solo se retiren participios: retirar
    // cualquier palabra adyacente abriria el hueco que el veto existe para cerrar.
    expect(esNavegacionDeSoloLectura('eliminar mensajes seleccionados')).toBe(false);
    expect(esNavegacionDeSoloLectura('borra los correos de la carpeta')).toBe(false);
    expect(esNavegacionDeSoloLectura('vacia la bandeja de eliminados')).toBe(false);
  });

  it('ordenar una lista es solo lectura; ordenar un producto sigue siendo la compra', () => {
    expect(esNavegacionDeSoloLectura('ordena por fecha de recepcion')).toBe(true);
    expect(esNavegacionDeSoloLectura('sort by date')).toBe(true);
    expect(esNavegacionDeSoloLectura('ordena el producto que quedo en el carrito')).toBe(false);
  });
});

// -------------------------------------------------------------------------------------------------
// D1: LA NATURALEZA DEL ELEMENTO, leida del DOM
// -------------------------------------------------------------------------------------------------

describe('el elemento decide por lo que ES, no por como se describio', () => {
  const DE_SOLO_LECTURA = ['link', 'tab', 'menuitem', 'searchbox', 'navigation', 'row', 'heading'];
  const BAJO_GUARDIA = ['button', 'textbox', 'checkbox', 'radio', 'combobox', 'spinbutton'];

  for (const rol of DE_SOLO_LECTURA) {
    it(`el rol accesible ${rol} es de solo lectura`, () => {
      expect(esElementoDeSoloLectura({ rol })).toBe(true);
    });
  }

  for (const rol of BAJO_GUARDIA) {
    it(`el rol accesible ${rol} NO exime nada`, () => {
      expect(esElementoDeSoloLectura({ rol })).toBe(false);
    });
  }

  it('un input[type=search] es de solo lectura por su tipo de control', () => {
    expect(esElementoDeSoloLectura({ rol: 'textbox', tipo: 'search' })).toBe(true);
  });

  it('sin elemento no hay exencion por elemento: decide la categoria del texto', () => {
    expect(esElementoDeSoloLectura(null)).toBe(false);
    expect(esElementoDeSoloLectura(undefined)).toBe(false);
    expect(esElementoDeSoloLectura({ rol: null, tipo: null })).toBe(false);
  });

  it('una descripcion sin categoria se exime si el elemento leido es un enlace', () => {
    // "click Recibidos" no cae en ninguna categoria de texto; el DOM dice que es un enlace.
    expect(esNavegacionDeSoloLectura('click Recibidos')).toBe(false);
    expect(esNavegacionDeSoloLectura('click Recibidos', { rol: 'link' })).toBe(true);
  });

  it('el veto gana al elemento: un menuitem que borra sigue bajo guardia', () => {
    expect(esNavegacionDeSoloLectura('click the item', { rol: 'menuitem' })).toBe(true);
    // Por la descripcion...
    expect(esNavegacionDeSoloLectura('click the delete item', { rol: 'menuitem' })).toBe(false);
    // ...y por el NOMBRE ACCESIBLE leido del DOM, que la descripcion no menciona.
    expect(
      esNavegacionDeSoloLectura('click the item', { rol: 'menuitem', nombre: 'Eliminar cuenta' }),
    ).toBe(false);
  });
});

// -------------------------------------------------------------------------------------------------
// D4: EL TOPE DE MONTO solo se evalua cuando la intencion maneja dinero
// -------------------------------------------------------------------------------------------------

const TOPE = 5000;
const POLITICA_CON_TOPE: PoliticaVigente = {
  ejecutarAccionesIrreversibles: true,
  topeMontoSinConfirmacion: TOPE,
  sitiosExcluidos: [],
};

/** Un campo de dinero LEGIBLE en pantalla, por encima del tope: el que disparaba topeExcedido. */
const CAMPO_DE_DINERO: CampoDeLaPagina[] = [{ contexto: 'input total a pagar', valor: '9900' }];

/**
 * Los objetivos declaran el dato que su familia EXIGE (destinatario para enviar, monto para pagar y
 * transferir) para que lo unico que pueda detener por este camino sea el tope, y no un faltaDato.
 */
const INTENCIONES_SIN_DINERO: readonly { verbo: string; objetivo: string }[] = [
  { verbo: 'enviar', objetivo: 'envia el resumen a juan@ejemplo.com' },
  { verbo: 'send', objetivo: 'send the summary to juan@ejemplo.com' },
  { verbo: 'publicar', objetivo: 'publica la entrada del blog' },
  { verbo: 'borrar', objetivo: 'borra el borrador que quedo abierto' },
  { verbo: 'delete', objetivo: 'delete the draft' },
];

const INTENCIONES_CON_DINERO: readonly { verbo: string; objetivo: string }[] = [
  { verbo: 'pagar', objetivo: 'paga $100 MXN de la factura' },
  { verbo: 'pay', objetivo: 'pay $100 MXN of the invoice' },
  { verbo: 'transferir', objetivo: 'transfiere $100 MXN a juan' },
  { verbo: 'comprar', objetivo: 'compra el teclado' },
  { verbo: 'buy', objetivo: 'buy the keyboard' },
];

function verificar(entrada: {
  objetivo: string;
  verbo: string | null;
  campos?: CampoDeLaPagina[];
  politica?: PoliticaVigente;
}): Veredicto {
  return verificarAccion({
    politica: entrada.politica ?? POLITICA_CON_TOPE,
    dominio: 'app.ejemplo.com',
    verbo: entrada.verbo,
    parametros: extraerParametrosDeclarados(entrada.objetivo),
    pagina: { campos: entrada.campos ?? CAMPO_DE_DINERO, texto: 'resumen de la cuenta' },
  });
}

function motivo(veredicto: Veredicto): string | null {
  return veredicto.tipo === 'detener' ? veredicto.detencion.motivo : null;
}

describe('el tope de monto no se dispara fuera de las intenciones que manejan dinero', () => {
  it('un campo de dinero legible en una corrida SIN intencion reconocida no dispara nada', () => {
    // Es el defecto adyacente que encontro la misma auditoria: en modo activo, un total visible en
    // pantalla detenia con topeExcedido una corrida que no tiene nada que ver con pagar.
    expect(motivo(verificar({ objetivo: 'revisa el estado de la cuenta', verbo: null }))).not.toBe(
      'topeExcedido',
    );
  });

  for (const { verbo, objetivo } of INTENCIONES_SIN_DINERO) {
    it(`tampoco en la intencion ${verbo}, que no maneja dinero`, () => {
      expect(motivo(verificar({ objetivo, verbo }))).not.toBe('topeExcedido');
    });
  }

  for (const { verbo, objetivo } of INTENCIONES_CON_DINERO) {
    it(`en la intencion ${verbo} el campo legible sigue disparando el tope`, () => {
      expect(motivo(verificar({ objetivo, verbo }))).toBe('topeExcedido');
    });
  }

  it('el monto que el USUARIO declara se compara siempre, tambien sin intencion reconocida', () => {
    // Lo que NO se relaja: ese numero no es un campo legible de la pagina, es lo que la persona pidio
    // comprometer. Sin campos de dinero en la pagina, el que detiene es el del objetivo.
    expect(motivo(verificar({ objetivo: 'manda $9,900 MXN a juan', verbo: null, campos: [] }))).toBe(
      'topeExcedido',
    );
  });

  it('el tope por defecto (0) es un limite real, no un centinela de "sin configurar"', () => {
    // Queda fijado por si alguna vez se lee el 0 como "sin limite": significa que TODO monto excede.
    // La ampliacion de D4 no lo cambia, solo acota DONDE se evalua.
    const politica: PoliticaVigente = { ...POLITICA_CON_TOPE, topeMontoSinConfirmacion: 0 };
    expect(motivo(verificar({ objetivo: 'paga $10 MXN de la propina', verbo: 'pagar', politica }))).toBe(
      'topeExcedido',
    );
    expect(
      motivo(verificar({ objetivo: 'revisa el estado de la cuenta', verbo: null, politica })),
    ).not.toBe('topeExcedido');
  });
});
