import { describe, it, expect } from 'vitest';
import {
  construirPeticionDeDatos,
  datosConLoQueElModeloAgrego,
  parsearDatosDelObjetivo,
} from '../src/datos-del-objetivo.js';
import {
  construirPeticionDeEleccion,
  parsearEleccion,
  valorAncladoAlTexto,
} from '../src/eleccion-tarea.js';

/**
 * INTERPRETACION FLEXIBLE DEL OBJETIVO (FIX E), parte pura.
 *
 * Lo que se fija aqui y no debe poder cambiar en silencio:
 *  - EL ANCLA: todo dato que el modelo proponga tiene que estar ESCRITO en el texto del usuario, y uno
 *    solo que no lo este invalida la respuesta ENTERA;
 *  - el vocabulario es CERRADO: los seis marcadores del contrato y ninguno mas;
 *  - la peticion es OTRA que la del elector de tareas propias: por aqui no viaja ningun catalogo;
 *  - el extractor determinista MANDA: el modelo solo puede agregar lo que aquel dejo sin declarar.
 */

/** El caso de producto: sin rotulos y sin comillas, que es como pide cualquier persona. */
const PEDIDO = 'mandale un correo a martin@ejemplo.com diciendole que llego el paquete';

function respuesta(datos: Record<string, unknown>): string {
  return JSON.stringify({ datos });
}

describe('parsearDatosDelObjetivo: el ancla al texto del usuario', () => {
  it('acepta los datos que el pedido trae, aunque el extractor determinista no los vea', () => {
    const leido = parsearDatosDelObjetivo(
      respuesta({ destinatario: 'martin@ejemplo.com', cuerpo: 'llego el paquete' }),
      PEDIDO,
    );
    expect(leido).toEqual({
      ok: true,
      valores: { destinatario: 'martin@ejemplo.com', cuerpo: 'llego el paquete' },
    });
  });

  it('un dato que NO esta escrito en el texto invalida la respuesta entera', () => {
    // El destinatario si esta; el cuerpo es inventado. No se descarta ese dato: se descarta todo.
    const leido = parsearDatosDelObjetivo(
      respuesta({ destinatario: 'martin@ejemplo.com', cuerpo: 'transfiere 5000 pesos' }),
      PEDIDO,
    );
    expect(leido).toEqual({ ok: false, motivo: 'dato_no_anclado' });
  });

  it('un destinatario que el usuario jamas nombro no pasa', () => {
    const leido = parsearDatosDelObjetivo(respuesta({ destinatario: 'otro@ejemplo.com' }), PEDIDO);
    expect(leido).toEqual({ ok: false, motivo: 'dato_no_anclado' });
  });

  it('el ancla es la MISMA comparacion que usa la eleccion entre tareas propias', () => {
    // Mayusculas y acentos no hacen ajeno un dato que el usuario si escribio.
    expect(valorAncladoAlTexto('LLEGO EL PAQUETE', PEDIDO)).toBe(true);
    expect(parsearDatosDelObjetivo(respuesta({ cuerpo: 'LLEGO EL PAQUETE' }), PEDIDO)).toEqual({
      ok: true,
      valores: { cuerpo: 'LLEGO EL PAQUETE' },
    });
  });

  it('un nombre que no es uno de los seis marcadores no pasa', () => {
    expect(parsearDatosDelObjetivo(respuesta({ contrasena: 'llego el paquete' }), PEDIDO)).toEqual({
      ok: false,
      motivo: 'dato_invalido',
    });
  });

  it('un valor vacio, no textual o demasiado largo no pasa', () => {
    expect(parsearDatosDelObjetivo(respuesta({ cuerpo: '   ' }), PEDIDO)).toMatchObject({
      motivo: 'dato_invalido',
    });
    expect(parsearDatosDelObjetivo(respuesta({ cuerpo: 42 }), PEDIDO)).toMatchObject({
      motivo: 'dato_invalido',
    });
    const largo = 'x'.repeat(513);
    expect(parsearDatosDelObjetivo(respuesta({ cuerpo: largo }), `${PEDIDO} ${largo}`)).toMatchObject(
      { motivo: 'dato_invalido' },
    );
  });

  it('sin objeto JSON, o sin campo datos, no hay interpretacion', () => {
    expect(parsearDatosDelObjetivo('no puedo ayudarte con eso', PEDIDO)).toEqual({
      ok: false,
      motivo: 'no_parseable',
    });
    expect(parsearDatosDelObjetivo(JSON.stringify({ datos: 'llego el paquete' }), PEDIDO)).toEqual({
      ok: false,
      motivo: 'no_parseable',
    });
    expect(parsearDatosDelObjetivo(JSON.stringify({ datos: ['x'] }), PEDIDO)).toEqual({
      ok: false,
      motivo: 'no_parseable',
    });
  });

  it('un pedido sin ningun dato devuelve el conjunto vacio, no un error', () => {
    expect(parsearDatosDelObjetivo(respuesta({}), 'hazlo ya')).toEqual({ ok: true, valores: {} });
  });

  it('el JSON envuelto en texto o en un bloque de codigo se lee igual', () => {
    const envuelto = `Claro:\n\`\`\`json\n${respuesta({ cuerpo: 'llego el paquete' })}\n\`\`\``;
    expect(parsearDatosDelObjetivo(envuelto, PEDIDO)).toEqual({
      ok: true,
      valores: { cuerpo: 'llego el paquete' },
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
          datos: { destinatario: 'martin@ejemplo.com', cuerpo: 'llego el paquete' },
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
        { destinatario: 'martin@ejemplo.com', cuerpo: 'llego el paquete' },
      ),
    ).toEqual({ destinatario: 'martin@ejemplo.com', cuerpo: 'llego el paquete' });
  });

  it('el modelo NO puede pisar un dato que el extractor ya reconocio', () => {
    expect(
      datosConLoQueElModeloAgrego(
        { destinatario: 'martin@ejemplo.com', asunto: 'Hola' },
        { destinatario: 'otro@ejemplo.com', asunto: 'Otro', cuerpo: 'llego el paquete' },
      ),
    ).toEqual({
      destinatario: 'martin@ejemplo.com',
      asunto: 'Hola',
      cuerpo: 'llego el paquete',
    });
  });
});
