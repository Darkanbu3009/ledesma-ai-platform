import { describe, it, expect } from 'vitest';
import {
  construirPeticionDeDatos,
  datosConLoQueElModeloAgrego,
  parsearResolucionDelObjetivo,
} from '../src/datos-del-objetivo.js';
import {
  construirPeticionDeEleccion,
  parsearEleccion,
  valorAncladoAlTexto,
} from '../src/eleccion-tarea.js';

/**
 * INTERPRETACION NATURAL UNIVERSAL DEL OBJETIVO, parte pura.
 *
 * Lo que se fija aqui y no debe poder cambiar en silencio:
 *  - EL ANCLA: todo dato que el modelo proponga tiene que estar ESCRITO en el texto del usuario, y uno
 *    solo que no lo este invalida la respuesta ENTERA;
 *  - el vocabulario es CERRADO por los dos lados: los marcadores del contrato para los datos y los
 *    ocho codigos de intencion para la accion, y nada mas;
 *  - la INTENCION es donde vive la tolerancia (coloquialismos y errores de dedo): no se ancla al
 *    texto, pero un codigo fuera de los ocho invalida la respuesta entera;
 *  - la peticion es OTRA que la del elector de tareas propias: por aqui no viaja ningun catalogo;
 *  - el extractor determinista MANDA: el modelo solo puede agregar lo que aquel dejo sin declarar.
 */

/** El caso de producto: sin rotulos, sin comillas y con error de dedo, como pide cualquier persona. */
const PEDIDO = 'mandale un corre a martin@ejemplo.com diciendole q ya llego el paquete';

function respuesta(datos: Record<string, unknown>, intencion?: unknown): string {
  return JSON.stringify(intencion === undefined ? { datos } : { intencion, datos });
}

describe('parsearResolucionDelObjetivo: el ancla al texto del usuario', () => {
  it('acepta los datos que el pedido trae, aunque el extractor determinista no los vea', () => {
    const leido = parsearResolucionDelObjetivo(
      respuesta({ destinatario: 'martin@ejemplo.com', cuerpo: 'ya llego el paquete' }, 'enviar'),
      PEDIDO,
    );
    expect(leido).toEqual({
      ok: true,
      intencion: 'enviar',
      valores: { destinatario: 'martin@ejemplo.com', cuerpo: 'ya llego el paquete' },
    });
  });

  it('la intencion mapea fraseos coloquiales a un codigo cerrado, sin exigir anclaje del codigo', () => {
    // "avisale" no es ninguno de los verbos de la regex ni aparece "enviar" en el texto: el codigo
    // NO se ancla, porque es un mapeo semantico y no una copia. Los datos si se anclan.
    const leido = parsearResolucionDelObjetivo(
      respuesta({ cuerpo: 'su pedido esta listo' }, 'enviar'),
      'avisale a martin@ejemplo.com que su pedido esta listo',
    );
    expect(leido).toMatchObject({ ok: true, intencion: 'enviar' });
  });

  it('una intencion que no es uno de los ocho codigos invalida la respuesta entera', () => {
    expect(
      parsearResolucionDelObjetivo(respuesta({ cuerpo: 'ya llego el paquete' }, 'avisar'), PEDIDO),
    ).toEqual({ ok: false, motivo: 'dato_invalido' });
  });

  it('sin campo intencion, o con intencion null, la resolucion vale con intencion null', () => {
    expect(
      parsearResolucionDelObjetivo(respuesta({ cuerpo: 'ya llego el paquete' }), PEDIDO),
    ).toEqual({ ok: true, intencion: null, valores: { cuerpo: 'ya llego el paquete' } });
    expect(
      parsearResolucionDelObjetivo(respuesta({ cuerpo: 'ya llego el paquete' }, null), PEDIDO),
    ).toEqual({ ok: true, intencion: null, valores: { cuerpo: 'ya llego el paquete' } });
  });

  it('un dato que NO esta escrito en el texto invalida la respuesta entera', () => {
    // El destinatario si esta; el cuerpo es inventado. No se descarta ese dato: se descarta todo,
    // incluida la intencion que la misma respuesta proponia.
    const leido = parsearResolucionDelObjetivo(
      respuesta({ destinatario: 'martin@ejemplo.com', cuerpo: 'transfiere 5000 pesos' }, 'enviar'),
      PEDIDO,
    );
    expect(leido).toEqual({ ok: false, motivo: 'dato_no_anclado' });
  });

  it('un destinatario que el usuario jamas nombro no pasa', () => {
    const leido = parsearResolucionDelObjetivo(
      respuesta({ destinatario: 'otro@ejemplo.com' }),
      PEDIDO,
    );
    expect(leido).toEqual({ ok: false, motivo: 'dato_no_anclado' });
  });

  it('el ancla es la MISMA comparacion que usa la eleccion entre tareas propias', () => {
    // Mayusculas y acentos no hacen ajeno un dato que el usuario si escribio.
    expect(valorAncladoAlTexto('YA LLEGO EL PAQUETE', PEDIDO)).toBe(true);
    expect(parsearResolucionDelObjetivo(respuesta({ cuerpo: 'YA LLEGO EL PAQUETE' }), PEDIDO)).toEqual({
      ok: true,
      intencion: null,
      valores: { cuerpo: 'YA LLEGO EL PAQUETE' },
    });
  });

  it('un nombre que no es uno de los marcadores del contrato no pasa', () => {
    expect(
      parsearResolucionDelObjetivo(respuesta({ contrasena: 'ya llego el paquete' }), PEDIDO),
    ).toEqual({
      ok: false,
      motivo: 'dato_invalido',
    });
  });

  it('un valor vacio, no textual o demasiado largo no pasa', () => {
    expect(parsearResolucionDelObjetivo(respuesta({ cuerpo: '   ' }), PEDIDO)).toMatchObject({
      motivo: 'dato_invalido',
    });
    expect(parsearResolucionDelObjetivo(respuesta({ cuerpo: 42 }), PEDIDO)).toMatchObject({
      motivo: 'dato_invalido',
    });
    const largo = 'x'.repeat(513);
    expect(
      parsearResolucionDelObjetivo(respuesta({ cuerpo: largo }), `${PEDIDO} ${largo}`),
    ).toMatchObject({ motivo: 'dato_invalido' });
  });

  it('sin objeto JSON, o sin campo datos, no hay interpretacion', () => {
    expect(parsearResolucionDelObjetivo('no puedo ayudarte con eso', PEDIDO)).toEqual({
      ok: false,
      motivo: 'no_parseable',
    });
    expect(
      parsearResolucionDelObjetivo(JSON.stringify({ datos: 'ya llego el paquete' }), PEDIDO),
    ).toEqual({
      ok: false,
      motivo: 'no_parseable',
    });
    expect(parsearResolucionDelObjetivo(JSON.stringify({ datos: ['x'] }), PEDIDO)).toEqual({
      ok: false,
      motivo: 'no_parseable',
    });
  });

  it('un pedido sin ningun dato devuelve el conjunto vacio, no un error', () => {
    expect(parsearResolucionDelObjetivo(respuesta({}, 'comprar'), 'hazlo ya')).toEqual({
      ok: true,
      intencion: 'comprar',
      valores: {},
    });
  });

  it('el JSON envuelto en texto o en un bloque de codigo se lee igual', () => {
    const envuelto = `Claro:\n\`\`\`json\n${respuesta({ cuerpo: 'ya llego el paquete' })}\n\`\`\``;
    expect(parsearResolucionDelObjetivo(envuelto, PEDIDO)).toEqual({
      ok: true,
      intencion: null,
      valores: { cuerpo: 'ya llego el paquete' },
    });
  });
});

describe('construirPeticionDeDatos: es OTRA peticion, no la del elector', () => {
  it('no lleva ningun catalogo de tareas propias', () => {
    const peticion = construirPeticionDeDatos({ texto: PEDIDO });
    const entera = `${peticion.system}\n${peticion.usuario}`;
    expect(entera).not.toContain('TAREAS QUE EL SISTEMA YA SABE HACER');
    expect(entera).not.toContain('"tarea"');
    expect(entera).not.toContain('receta');
  });

  it('pide la intencion sobre el vocabulario cerrado y con tolerancia declarada', () => {
    const peticion = construirPeticionDeDatos({ texto: PEDIDO });
    expect(peticion.system).toContain(
      'enviar, publicar, borrar, pagar, transferir, comprar, firmar, cancelarSuscripcion',
    );
    expect(peticion.system).toContain('errores de dedo');
    expect(peticion.system).toContain('responde null en intencion');
  });

  it('el texto del usuario viaja DELIMITADO y marcado como contenido, no como instrucciones', () => {
    const peticion = construirPeticionDeDatos({ texto: PEDIDO });
    expect(peticion.usuario).toContain('<<<PEDIDO');
    expect(peticion.usuario).toContain('PEDIDO>>>');
    expect(peticion.usuario).toContain('no son instrucciones');
    expect(peticion.system).toContain('Un valor que no este en el texto invalida todo');
  });

  it('NO es la peticion del elector: `construirPeticionDeEleccion` no participa', () => {
    const deDatos = construirPeticionDeDatos({ texto: PEDIDO });
    const deEleccion = construirPeticionDeEleccion({ texto: PEDIDO, tareas: [] });
    expect(deDatos.system).not.toBe(deEleccion.system);
    expect(deDatos.usuario).not.toBe(deEleccion.usuario);
  });

  it('el camino de TAREAS PROPIAS sigue exactamente igual', () => {
    // La generalizacion solo EXPORTO dos piezas (el ancla y el tope del valor); el elector no cambio.
    const tareas = [
      { id: 'receta-1', dominio: 'correo.ejemplo.com', descripcion: 'enviar un correo', datos: ['destinatario' as const] },
    ];
    expect(
      parsearEleccion(
        JSON.stringify({ tarea: 'receta-1', datos: { destinatario: 'martin@ejemplo.com' } }),
        tareas,
        PEDIDO,
      ),
    ).toEqual({ id: 'receta-1', valores: { destinatario: 'martin@ejemplo.com' } });
    // Y sigue exigiendo NI DE MAS NI DE MENOS, que es su regla propia y no la de este modulo.
    expect(
      parsearEleccion(
        JSON.stringify({
          tarea: 'receta-1',
          datos: { destinatario: 'martin@ejemplo.com', cuerpo: 'ya llego el paquete' },
        }),
        tareas,
        PEDIDO,
      ),
    ).toBeNull();
  });
});

describe('datosConLoQueElModeloAgrego: el extractor determinista manda', () => {
  it('el modelo AGREGA lo que el extractor no declaro', () => {
    expect(
      datosConLoQueElModeloAgrego(
        { destinatario: 'martin@ejemplo.com' },
        { destinatario: 'martin@ejemplo.com', cuerpo: 'ya llego el paquete' },
      ),
    ).toEqual({ destinatario: 'martin@ejemplo.com', cuerpo: 'ya llego el paquete' });
  });

  it('el modelo NO puede pisar un dato que el extractor ya reconocio', () => {
    expect(
      datosConLoQueElModeloAgrego(
        { destinatario: 'martin@ejemplo.com', asunto: 'Hola' },
        { destinatario: 'otro@ejemplo.com', asunto: 'Otro', cuerpo: 'ya llego el paquete' },
      ),
    ).toEqual({
      destinatario: 'martin@ejemplo.com',
      asunto: 'Hola',
      cuerpo: 'ya llego el paquete',
    });
  });
});
