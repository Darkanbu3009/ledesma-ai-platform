import { describe, it, expect } from 'vitest';
import { parsearPasosDeReceta, type PasoDeReceta } from '@ledesma-platform/shared';
import type { RecetaWeb } from '@ledesma-platform/backend/recetas-web';
import {
  construirPeticionDeEleccion,
  ofrecerTareasEnsenadas,
  parsearEleccion,
  valorAncladoAlTexto,
  type TareaEnsenadaOfrecida,
} from '../src/eleccion-tarea.js';

/**
 * ELEGIR ENTRE LAS TAREAS YA ENSENADAS (CAMBIO 3), sin modelo y sin red: aqui se prueban las DOS
 * mitades deterministas del cambio, que son las que sostienen la seguridad.
 *
 *  1. QUE SE OFRECE: una tarea cuya accion irreversible no es exactamente la que pidio el usuario ni
 *     siquiera entra en la lista, asi que el modelo no puede elegirla.
 *  2. QUE SE ACEPTA: la respuesta se valida contra la lista ofrecida y contra el texto del usuario.
 *     Un dato que el usuario no escribio TUMBA la eleccion entera, aunque el modelo insista.
 *
 * Estos rechazos son el motivo por el que dejar que un modelo reconozca la tarea no abre una puerta:
 * el modelo SENALA, no aporta.
 */

const DOMINIO = 'correo.ejemplo.com';
const CORREO = 'martin@ejemplo.com';

function pasosDeEnvio(): PasoDeReceta[] {
  const pasos = parsearPasosDeReceta([
    {
      idx: 0,
      accion: 'escribir',
      estrategias: [{ tipo: 'atributo', atributo: 'name', valor: 'to' }],
      valor: { tipo: 'parametro', parametro: 'destinatario' },
      teclas: null,
      ruta: null,
      esperaMs: null,
    },
    {
      idx: 1,
      accion: 'escribir',
      estrategias: [{ tipo: 'atributo', atributo: 'name', valor: 'subjectbox' }],
      valor: { tipo: 'parametro', parametro: 'asunto' },
      teclas: null,
      ruta: null,
      esperaMs: null,
    },
    {
      idx: 2,
      accion: 'verificar',
      estrategias: [],
      valor: null,
      teclas: null,
      ruta: null,
      esperaMs: null,
    },
    {
      idx: 3,
      accion: 'click',
      estrategias: [{ tipo: 'atributo', atributo: 'id', valor: 'enviar' }],
      valor: null,
      teclas: null,
      ruta: null,
      esperaMs: null,
    },
  ]);
  if (pasos === null) throw new Error('los pasos del fixture no validan contra el contrato');
  return pasos;
}

function makeReceta(overrides: Partial<RecetaWeb> = {}): RecetaWeb {
  return {
    id: 'rec-1',
    ownerId: 'user-1',
    dominio: DOMINIO,
    firmaObjetivo: 'enviar un correo',
    descripcion: 'enviar un correo',
    version: 1,
    estado: 'activa',
    origen: 'grabacion',
    pasos: pasosDeEnvio(),
    creadaDesdeTrayectoria: null,
    ejecucionesExitosas: 2,
    ejecucionesFallidas: 0,
    ultimaEjecucionEn: null,
    creadaEn: '2026-07-24T00:00:00.000Z',
    actualizadaEn: '2026-07-24T00:00:00.000Z',
    ...overrides,
  };
}

const PEDIDO = `manda un correo a ${CORREO} con el asunto Paquete y dile que llego`;

function ofrecidaDeEnvio(): TareaEnsenadaOfrecida[] {
  return ofrecerTareasEnsenadas([makeReceta()], 'enviar');
}

describe('que tareas se le ofrecen al modelo', () => {
  it('ofrece la tarea con lo que hace y que datos necesita, sacado de sus pasos', () => {
    const ofrecidas = ofrecidaDeEnvio();
    expect(ofrecidas).toEqual([
      {
        id: 'rec-1',
        dominio: DOMINIO,
        descripcion: 'enviar un correo',
        datos: ['destinatario', 'asunto'],
      },
    ]);
  });

  it('NO ofrece lo que el sistema aprendio solo: su unico texto lo redacto un modelo', () => {
    // La firma sale del objetivo que escribio el modelo conversacional, que habia leido paginas web.
    // Meterla en este prompt le abriria a una pagina un canal para hablarle al que elige. Esas
    // recetas siguen usandose por coincidencia exacta de firma, como siempre.
    const ofrecidas = ofrecerTareasEnsenadas(
      [makeReceta({ descripcion: null, firmaObjetivo: 'enviar un correo a <destinatario>' })],
      'enviar',
    );
    expect(ofrecidas).toEqual([]);
  });

  it('NO ofrece una tarea irreversible que no necesita ningun dato', () => {
    // Sin datos, la verificacion determinista no tiene nada que comparar: la eleccion del modelo
    // seria la unica barrera entre el pedido y una accion que no se puede deshacer.
    const sinDatos = parsearPasosDeReceta([
      {
        idx: 0,
        accion: 'verificar',
        estrategias: [],
        valor: null,
        teclas: null,
        ruta: null,
        esperaMs: null,
      },
      {
        idx: 1,
        accion: 'click',
        estrategias: [{ tipo: 'atributo', atributo: 'id', valor: 'vaciar' }],
        valor: null,
        teclas: null,
        ruta: null,
        esperaMs: null,
      },
    ]);
    if (sinDatos === null) throw new Error('los pasos del fixture no validan contra el contrato');
    const receta = makeReceta({ descripcion: 'borrar todos los correos viejos', pasos: sinDatos });
    expect(ofrecerTareasEnsenadas([receta], 'borrar')).toEqual([]);
    // Sin verbo irreversible de por medio no hay nada que comparar ni nada que deshacer: se ofrece.
    const lectura = makeReceta({ descripcion: 'abrir la bandeja de entrada', pasos: sinDatos });
    expect(ofrecerTareasEnsenadas([lectura], null)).toHaveLength(1);
  });

  it('la descripcion que se le muestra al modelo va acotada', () => {
    const larga = makeReceta({ descripcion: `enviar un correo ${'x'.repeat(500)}` });
    const ofrecidas = ofrecerTareasEnsenadas([larga], 'enviar');
    expect(ofrecidas[0]?.descripcion.length).toBe(200);
  });

  it('NO ofrece una tarea que hace algo irreversible cuando el usuario no pidio nada irreversible', () => {
    // "muestrame mis correos" no pide ninguna accion bloqueada: una tarea que ENVIA no puede
    // aparecer siquiera en la lista, asi que el modelo no tiene forma de elegirla.
    expect(ofrecerTareasEnsenadas([makeReceta()], null)).toEqual([]);
  });

  it('NO ofrece una tarea cuya accion irreversible es OTRA que la que pidio el usuario', () => {
    // El usuario pide borrar; lo ensenado envia. Son cosas distintas y no se confunden.
    expect(ofrecerTareasEnsenadas([makeReceta()], 'borrar')).toEqual([]);
  });

  it('el texto del usuario viaja delimitado y marcado como contenido, no como instrucciones', () => {
    const peticion = construirPeticionDeEleccion({ texto: PEDIDO, tareas: ofrecidaDeEnvio() });
    expect(peticion.usuario).toContain('<<<PEDIDO');
    expect(peticion.usuario).toContain(PEDIDO);
    expect(peticion.system).toContain('Responde SOLO con un objeto JSON');
    // Y nunca viajan los pasos: el procedimiento interno no se le muestra a nadie.
    expect(peticion.usuario).not.toContain('subjectbox');
  });
});

describe('que respuestas del modelo se aceptan', () => {
  it('elige una tarea cuya descripcion NO coincide literalmente con lo que pidio el usuario', () => {
    const ofrecidas = ofrecidaDeEnvio();
    const eleccion = parsearEleccion(
      JSON.stringify({
        tarea: 'rec-1',
        datos: { destinatario: CORREO, asunto: 'Paquete' },
      }),
      ofrecidas,
      PEDIDO,
    );
    // "enviar un correo" no se parece en nada, palabra por palabra, a lo que el usuario escribio: es
    // exactamente el caso que la firma exacta no encontraba nunca.
    expect(eleccion).toEqual({
      id: 'rec-1',
      valores: { destinatario: CORREO, asunto: 'Paquete' },
    });
  });

  it('acepta la respuesta aunque venga envuelta en texto o en un bloque de codigo', () => {
    const eleccion = parsearEleccion(
      '```json\n{"tarea":"rec-1","datos":{"destinatario":"' + CORREO + '","asunto":"Paquete"}}\n```',
      ofrecidaDeEnvio(),
      PEDIDO,
    );
    expect(eleccion?.id).toBe('rec-1');
  });

  it('RECHAZA un dato que el usuario no escribio (el modelo no puede aportar datos)', () => {
    const eleccion = parsearEleccion(
      JSON.stringify({
        tarea: 'rec-1',
        datos: { destinatario: 'otro@ejemplo.com', asunto: 'Paquete' },
      }),
      ofrecidaDeEnvio(),
      PEDIDO,
    );
    expect(eleccion).toBeNull();
  });

  it('RECHAZA una tarea que no estaba en la lista ofrecida', () => {
    const eleccion = parsearEleccion(
      JSON.stringify({ tarea: 'rec-999', datos: { destinatario: CORREO, asunto: 'Paquete' } }),
      ofrecidaDeEnvio(),
      PEDIDO,
    );
    expect(eleccion).toBeNull();
  });

  it('RECHAZA una eleccion a la que le falta uno de los datos que la tarea necesita', () => {
    const eleccion = parsearEleccion(
      JSON.stringify({ tarea: 'rec-1', datos: { destinatario: CORREO } }),
      ofrecidaDeEnvio(),
      PEDIDO,
    );
    expect(eleccion).toBeNull();
  });

  it('RECHAZA un dato que la tarea no pide', () => {
    const eleccion = parsearEleccion(
      JSON.stringify({
        tarea: 'rec-1',
        datos: { destinatario: CORREO, asunto: 'Paquete', monto: '100 MXN' },
      }),
      ofrecidaDeEnvio(),
      PEDIDO,
    );
    expect(eleccion).toBeNull();
  });

  it('RECHAZA cualquier cosa que no sea la forma esperada (y "ninguna" es una respuesta valida)', () => {
    const ofrecidas = ofrecidaDeEnvio();
    for (const respuesta of [
      '',
      'no se',
      '[]',
      JSON.stringify({ tarea: null }),
      JSON.stringify({ tarea: 'rec-1' }),
      JSON.stringify({ tarea: 'rec-1', datos: { destinatario: CORREO, asunto: '' } }),
      JSON.stringify({ tarea: 'rec-1', datos: { destinatario: CORREO, asunto: 42 } }),
      JSON.stringify({ tarea: ['rec-1'], datos: {} }),
    ]) {
      expect(parsearEleccion(respuesta, ofrecidas, PEDIDO)).toBeNull();
    }
  });

  it('el ancla compara sin acentos ni mayusculas, igual que el resto de la plataforma', () => {
    expect(valorAncladoAlTexto('Paquete', 'dile que llego el paquete')).toBe(true);
    expect(valorAncladoAlTexto('accion', 'la ACCION quedo hecha')).toBe(true);
    expect(valorAncladoAlTexto('otra cosa', 'dile que llego el paquete')).toBe(false);
    expect(valorAncladoAlTexto('', 'lo que sea')).toBe(false);
  });
});
