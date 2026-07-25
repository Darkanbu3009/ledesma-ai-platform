import { describe, it, expect } from 'vitest';
import {
  crearAcumuladorDeConsumo,
  crearPoliticaDeScreenshots,
  crearPreparadorDePaso,
  numeroDeMetadatos,
  recortarHistorial,
  type MensajeDeModelo,
} from '../src/costo-modelo.js';

/** Un paso de ida y vuelta: el asistente llama una tool y llega su resultado. */
function paso(n: number): MensajeDeModelo[] {
  return [
    { role: 'assistant', content: [{ type: 'tool-call', toolCallId: `c${n}` }] },
    { role: 'tool', content: [{ type: 'tool-result', toolCallId: `c${n}` }] },
  ];
}

function conversacion(pasos: number, sistema = true): MensajeDeModelo[] {
  return [
    ...(sistema ? [{ role: 'system' as const, content: 'reglas fijas del sistema' }] : []),
    { role: 'user' as const, content: 'abre el ultimo correo' },
    ...Array.from({ length: pasos }, (_, i) => paso(i)).flat(),
  ];
}

describe('recortarHistorial', () => {
  it('por debajo de la ventana no recorta nada', () => {
    const mensajes = conversacion(3, false);
    const { mensajes: salida, recortado } = recortarHistorial(mensajes, 8);
    expect(recortado).toBe(false);
    expect(salida).toEqual(mensajes);
  });

  it('por encima de la ventana conserva el objetivo y los ultimos N pasos', () => {
    const { mensajes: salida, recortado } = recortarHistorial(conversacion(10, false), 3);
    expect(recortado).toBe(true);
    // objetivo + 3 pasos de dos mensajes cada uno
    expect(salida).toHaveLength(1 + 3 * 2);
    expect(salida[0]).toEqual({ role: 'user', content: 'abre el ultimo correo' });
    expect(salida[1]).toEqual(paso(7)[0]);
  });

  /**
   * El corte cae SIEMPRE en un mensaje del asistente: un resultado de tool cuya llamada quedo fuera
   * del envio es un mensaje huerfano que el proveedor rechaza.
   */
  it('nunca deja un resultado de tool sin la llamada que lo origino', () => {
    const { mensajes: salida } = recortarHistorial(conversacion(12, false), 5);
    const primeroDelHistorial = salida[1];
    expect(primeroDelHistorial?.role).toBe('assistant');
    for (let i = 0; i < salida.length; i++) {
      if (salida[i]?.role !== 'tool') continue;
      expect(salida[i - 1]?.role).toBe('assistant');
    }
  });

  it('una ventana mayor que la conversacion la deja intacta', () => {
    const mensajes = conversacion(2, false);
    expect(recortarHistorial(mensajes, 40)).toEqual({ mensajes, recortado: false });
  });
});

describe('crearPreparadorDePaso', () => {
  it('saca las instrucciones de sistema del arreglo y las devuelve por la opcion system', () => {
    const preparar = crearPreparadorDePaso({ historialPasos: 8 });
    const salida = preparar(conversacion(1));
    expect(salida.system).toBe('reglas fijas del sistema');
    expect(salida.messages.some((m) => m.role === 'system')).toBe(false);
  });

  it('sin mensaje de sistema no inventa ninguno', () => {
    const preparar = crearPreparadorDePaso({ historialPasos: 8 });
    expect(preparar(conversacion(1, false)).system).toBeUndefined();
  });

  /**
   * La marca de cache va sobre el objetivo: con ella el proveedor cachea el prefijo COMPLETO
   * (herramientas + system + objetivo), que es lo unico identico en los 26 pasos de una corrida.
   */
  it('marca el objetivo como prefijo cacheable', () => {
    const preparar = crearPreparadorDePaso({ historialPasos: 8 });
    const salida = preparar(conversacion(2));
    expect(salida.messages[0]?.providerOptions?.['anthropic']).toEqual({
      cacheControl: { type: 'ephemeral' },
    });
  });

  it('en el primer paso (solo el objetivo) tambien marca el prefijo', () => {
    const preparar = crearPreparadorDePaso({ historialPasos: 8 });
    const salida = preparar(conversacion(0));
    expect(salida.messages).toHaveLength(1);
    expect(salida.messages[0]?.providerOptions?.['anthropic']).toBeDefined();
  });

  /**
   * MARCA RODANTE: mientras la ventana no se desliza, el envio anterior es un prefijo exacto del
   * actual, asi que marcar su final hace que el paso siguiente lea de cache toda la conversacion
   * previa en vez de pagarla como entrada nueva.
   */
  it('mientras no recorta, marca tambien el final del envio anterior', () => {
    const preparar = crearPreparadorDePaso({ historialPasos: 8 });
    const primero = preparar(conversacion(1));
    expect(primero.messages).toHaveLength(3);
    const segundo = preparar(conversacion(2));
    const marcados = segundo.messages
      .map((m, i) => (m.providerOptions?.['anthropic'] !== undefined ? i : -1))
      .filter((i) => i >= 0);
    // objetivo, final del envio anterior (indice 2) y final de este envio (indice 4).
    expect(marcados).toEqual([0, 2, 4]);
  });

  /**
   * En cuanto la ventana se desliza, el prefijo deja de repetirse entre pasos: escribir cache que
   * nadie va a leer cuesta MAS que no escribirla, asi que solo queda la marca del objetivo.
   */
  it('cuando recorta, deja SOLO la marca del objetivo', () => {
    const preparar = crearPreparadorDePaso({ historialPasos: 3 });
    preparar(conversacion(3));
    const salida = preparar(conversacion(9));
    expect(salida.recortado).toBe(true);
    const marcados = salida.messages
      .map((m, i) => (m.providerOptions?.['anthropic'] !== undefined ? i : -1))
      .filter((i) => i >= 0);
    expect(marcados).toEqual([0]);
  });

  it('no muta los mensajes que recibe', () => {
    const preparar = crearPreparadorDePaso({ historialPasos: 8 });
    const entrada = conversacion(2);
    preparar(entrada);
    for (const mensaje of entrada) expect(mensaje.providerOptions).toBeUndefined();
  });
});

describe('crearPoliticaDeScreenshots', () => {
  const pagina = { url: 'https://app.ejemplo.com/bandeja', titulo: 'Bandeja' };

  it("'siempre' no se interpone nunca", () => {
    const politica = crearPoliticaDeScreenshots({
      modo: 'siempre',
      conGuardia: false,
      yaAutorizo: () => false,
    });
    expect(politica.permitir(pagina)).toBe(true);
    expect(politica.permitir(pagina)).toBe(true);
    expect(politica.permitir(pagina)).toBe(true);
  });

  it("'cambios' pasa la primera y despues solo si cambio la URL o el titulo", () => {
    const politica = crearPoliticaDeScreenshots({
      modo: 'cambios',
      conGuardia: false,
      yaAutorizo: () => false,
    });
    expect(politica.permitir(pagina)).toBe(true);
    expect(politica.permitir(pagina)).toBe(false);
    expect(politica.permitir({ ...pagina, url: 'https://app.ejemplo.com/correo/1' })).toBe(true);
    expect(politica.permitir({ ...pagina, url: 'https://app.ejemplo.com/correo/1' })).toBe(false);
    // Misma URL con otro titulo: la pagina cambio igual (una SPA no siempre cambia de URL).
    expect(
      politica.permitir({ url: 'https://app.ejemplo.com/correo/1', titulo: 'Redactar' }),
    ).toBe(true);
  });

  it("'minimo' sin guardia: solo la primera de la corrida", () => {
    const politica = crearPoliticaDeScreenshots({
      modo: 'minimo',
      conGuardia: false,
      yaAutorizo: () => false,
    });
    expect(politica.permitir(pagina)).toBe(true);
    expect(politica.permitir({ ...pagina, url: 'https://app.ejemplo.com/otra' })).toBe(false);
  });

  it("'minimo' con guardia: pasa el tramo previo a la accion y se corta al autorizarla", () => {
    let autorizada = false;
    const politica = crearPoliticaDeScreenshots({
      modo: 'minimo',
      conGuardia: true,
      yaAutorizo: () => autorizada,
    });
    expect(politica.permitir(pagina)).toBe(true);
    expect(politica.permitir(pagina)).toBe(true);
    autorizada = true;
    expect(politica.permitir(pagina)).toBe(false);
  });
});

describe('crearAcumuladorDeConsumo', () => {
  it('suma los cuatro tipos de token y cuenta las llamadas al modelo', () => {
    const acumulador = crearAcumuladorDeConsumo();
    acumulador.registrarPaso({ tokensEntrada: 100, tokensSalida: 20, tokensCreadosEnCache: 3000 });
    acumulador.registrarPaso({ tokensEntrada: 40, tokensSalida: 15, tokensLeidosDeCache: 3000 });
    expect(acumulador.total()).toEqual({
      tokensEntrada: 140,
      tokensSalida: 35,
      tokensLeidosDeCache: 3000,
      tokensCreadosEnCache: 3000,
      pasos: 2,
    });
  });

  it('un paso sin cifras reportadas cuenta como paso y suma cero', () => {
    const acumulador = crearAcumuladorDeConsumo();
    acumulador.registrarPaso({});
    expect(acumulador.total()).toEqual({
      tokensEntrada: 0,
      tokensSalida: 0,
      tokensLeidosDeCache: 0,
      tokensCreadosEnCache: 0,
      pasos: 1,
    });
  });

  it('el total es una copia: mutarlo no corrompe el acumulador', () => {
    const acumulador = crearAcumuladorDeConsumo();
    acumulador.registrarPaso({ tokensEntrada: 10 });
    const total = acumulador.total();
    total.tokensEntrada = 999;
    expect(acumulador.total().tokensEntrada).toBe(10);
  });
});

describe('numeroDeMetadatos', () => {
  it('lee un entero no negativo de un objeto suelto', () => {
    expect(numeroDeMetadatos({ cacheCreationInputTokens: 7 }, 'cacheCreationInputTokens')).toBe(7);
  });

  it('descarta lo que no sea un numero utilizable', () => {
    expect(numeroDeMetadatos(undefined, 'x')).toBeUndefined();
    expect(numeroDeMetadatos(null, 'x')).toBeUndefined();
    expect(numeroDeMetadatos({ x: '7' }, 'x')).toBeUndefined();
    expect(numeroDeMetadatos({ x: -1 }, 'x')).toBeUndefined();
    expect(numeroDeMetadatos({ x: Number.NaN }, 'x')).toBeUndefined();
  });
});
