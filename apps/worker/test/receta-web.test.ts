import { describe, it, expect } from 'vitest';
import { parsearPasosDeReceta, type EstrategiaLocalizacion } from '@ledesma-platform/shared';
import { VALOR_CENSURADO } from '../src/censura.js';
import {
  firmaDeObjetivo,
  promoverTrayectoria,
  repararEstrategias,
  superaElLimiteDeEscaladas,
  sustituirParametros,
  valoresDeParametros,
} from '../src/receta-web.js';
import { extraerParametrosDeclarados } from '../src/parametros-objetivo.js';
import type { PasoCensurado } from '../src/trayectoria.js';

/**
 * PROMOCION de una trayectoria a RECETA y FIRMA del objetivo (Fase F paso 2, D3/D4/D8), como
 * funciones PURAS: sin navegador, sin motor y sin base. Estos tests son el contrato de que se puede
 * repetir y que no, y de que jamas se guarda un valor del usuario en una receta.
 */

const DOMINIO = 'app.ejemplo.com';

const ATRIBUTO: EstrategiaLocalizacion = { tipo: 'atributo', atributo: 'id', valor: 'para' };
const ROL: EstrategiaLocalizacion = { tipo: 'rol', rol: 'button', nombre: 'Enviar' };
const XPATH: EstrategiaLocalizacion = { tipo: 'xpath', xpath: '/html[1]/body[1]/div[31]/button[1]' };

function paso(overrides: Partial<PasoCensurado> = {}): PasoCensurado {
  return {
    idx: 0,
    accion: { tipo: 'act', instruccion: null, metodo: 'click', argumentos: [] },
    selector: '/html[1]/body[1]/button[1]',
    valorCensurado: null,
    estrategias: [ATRIBUTO, XPATH],
    url: `https://${DOMINIO}/inbox`,
    exito: true,
    ...overrides,
  };
}

function promover(pasos: PasoCensurado[], objetivo: string, estado = 'exitosa', exige = false) {
  return promoverTrayectoria({ pasos, dominio: DOMINIO, objetivo, estado, exigeVerificacion: exige });
}

describe('firmaDeObjetivo (D3: criterio de equivalencia entre objetivos)', () => {
  it('dos objetivos con distintos parametros pero misma estructura comparten firma', () => {
    const a = firmaDeObjetivo('Envia un correo a martin@x.com con asunto "Hola"');
    const b = firmaDeObjetivo('envia un correo a ana@y.com con asunto "Adios"');
    expect(a).toBe(b);
    expect(a).toContain('<destinatario>');
    // El texto entrecomillado que el objetivo ROTULA como asunto firma como asunto, no como producto:
    // la firma habla el mismo vocabulario que la verificacion (contrato de MarcadorParametro).
    expect(a).toContain('<asunto>');
  });

  it('dos objetivos con estructura distinta NO comparten firma', () => {
    const enviar = firmaDeObjetivo('envia un correo a martin@x.com');
    const borrar = firmaDeObjetivo('borra el correo de martin@x.com');
    expect(enviar).not.toBe(borrar);
  });

  it('normaliza acentos, mayusculas y puntuacion (la misma tarea escrita distinto firma igual)', () => {
    expect(firmaDeObjetivo('Envía el informe a Juan@Ejemplo.COM.')).toBe(
      firmaDeObjetivo('envia el informe a juan@ejemplo.com'),
    );
  });

  it('sustituye el monto declarado por su marcador', () => {
    const a = firmaDeObjetivo('paga 2,400 MXN de la factura');
    const b = firmaDeObjetivo('paga 900 MXN de la factura');
    expect(a).toBe(b);
    expect(a).toContain('<monto>');
  });
});

describe('promoverTrayectoria (D4: cuando una corrida se vuelve repetible)', () => {
  it('una trayectoria exitosa genera receta con TODAS las estrategias de localizacion del paso', () => {
    const resultado = promover(
      [paso({ estrategias: [ATRIBUTO, ROL, XPATH] })],
      'abre el ultimo correo',
    );
    expect(resultado.promovida).toBe(true);
    if (!resultado.promovida) return;
    expect(resultado.pasos).toHaveLength(1);
    // Las cuatro estrategias viajan enteras y ORDENADAS: atributo, rol, texto, xpath (D1).
    expect(resultado.pasos[0]?.estrategias).toEqual([ATRIBUTO, ROL, XPATH]);
    expect(resultado.pasos[0]?.accion).toBe('click');
    // Y el resultado valida contra el contrato compartido: es lo que se persistira como jsonb.
    expect(parsearPasosDeReceta(JSON.parse(JSON.stringify(resultado.pasos)))).not.toBeNull();
  });

  it('una trayectoria FALLIDA no genera receta', () => {
    expect(promover([paso()], 'abre el ultimo correo', 'fallida').promovida).toBe(false);
  });

  it('una trayectoria PAUSADA tampoco genera receta', () => {
    expect(promover([paso()], 'abre el ultimo correo', 'pausada').promovida).toBe(false);
  });

  it('un paso SIN estrategias invalida la receta entera (no se promueve a medias)', () => {
    const resultado = promover(
      [paso(), paso({ idx: 1, estrategias: [] })],
      'abre el ultimo correo',
    );
    expect(resultado.promovida).toBe(false);
    if (resultado.promovida) return;
    expect(resultado.motivo).toContain('estrategia');
  });

  it('un paso FALLIDO dentro de una corrida exitosa invalida la receta', () => {
    expect(promover([paso({ exito: false })], 'abre el correo').promovida).toBe(false);
  });

  it('los pasos que solo MIRAN (extract, screenshot, done) se omiten sin invalidar', () => {
    const resultado = promover(
      [
        paso({ accion: { tipo: 'extract', instruccion: null, metodo: null, argumentos: [] }, estrategias: [] }),
        paso({ idx: 1 }),
        paso({ idx: 2, accion: { tipo: 'done', instruccion: null, metodo: null, argumentos: [] }, estrategias: [] }),
      ],
      'abre el correo',
    );
    expect(resultado.promovida).toBe(true);
    if (!resultado.promovida) return;
    expect(resultado.pasos).toHaveLength(1);
    expect(resultado.pasos[0]?.idx).toBe(0);
  });

  it('un metodo que el ejecutor no sabe repetir (selectOption) invalida la receta', () => {
    const resultado = promover(
      [paso({ accion: { tipo: 'act', instruccion: null, metodo: 'selectOption', argumentos: ['a'] } })],
      'abre el correo',
    );
    expect(resultado.promovida).toBe(false);
  });

  it('una navegacion FUERA del dominio de la conexion invalida la receta', () => {
    const resultado = promover(
      [
        paso({
          accion: { tipo: 'goto', instruccion: null, metodo: null, argumentos: [] },
          url: 'https://otro-sitio.com/pago',
          estrategias: [],
        }),
      ],
      'abre el correo',
    );
    expect(resultado.promovida).toBe(false);
    if (resultado.promovida) return;
    expect(resultado.motivo).toContain('dominio');
  });

  it('una navegacion DENTRO del dominio se promueve como ruta relativa, nunca como URL', () => {
    const resultado = promover(
      [
        paso({
          accion: { tipo: 'goto', instruccion: null, metodo: null, argumentos: [] },
          url: `https://${DOMINIO}/mail/compose`,
          estrategias: [],
        }),
      ],
      'abre el correo',
    );
    expect(resultado.promovida).toBe(true);
    if (!resultado.promovida) return;
    expect(resultado.pasos[0]).toMatchObject({ accion: 'navegar', ruta: '/mail/compose' });
    expect(JSON.stringify(resultado.pasos)).not.toContain(DOMINIO);
  });

  it('el paso de verificacion se promueve como paso `verificar` (D7 viaja dentro de la receta)', () => {
    const resultado = promover(
      [
        paso(),
        paso({
          idx: 1,
          accion: { tipo: 'verificacion', instruccion: 'ok', metodo: null, argumentos: [] },
          estrategias: [],
          selector: null,
        }),
        paso({ idx: 2 }),
      ],
      'envia el informe a juan@ejemplo.com',
    );
    expect(resultado.promovida).toBe(true);
    if (!resultado.promovida) return;
    expect(resultado.pasos.map((p) => p.accion)).toEqual(['click', 'verificar', 'click']);
  });

  it('un objetivo con accion bloqueada NO se promueve si la corrida no dejo constancia de verificar', () => {
    const resultado = promover([paso()], 'envia el informe a juan@ejemplo.com', 'exitosa', true);
    expect(resultado.promovida).toBe(false);
    if (resultado.promovida) return;
    expect(resultado.motivo).toContain('verificacion');
  });
});

describe('promocion y valores sensibles (D8)', () => {
  const OBJETIVO = 'envia el informe a juan@ejemplo.com';

  it('un valor tecleado que coincide con un parametro se guarda como MARCADOR, nunca el valor', () => {
    const resultado = promover(
      [
        paso({
          accion: { tipo: 'act', instruccion: null, metodo: 'fill', argumentos: ['juan@ejemplo.com'] },
        }),
      ],
      OBJETIVO,
    );
    expect(resultado.promovida).toBe(true);
    if (!resultado.promovida) return;
    expect(resultado.pasos[0]?.valor).toEqual({ tipo: 'parametro', parametro: 'destinatario' });
    // El correo del usuario NO aparece en ninguna parte de la receta.
    expect(JSON.stringify(resultado.pasos)).not.toContain('juan@ejemplo.com');
  });

  it('un valor CENSURADO sin parametro al que atarlo invalida la receta (jamas se guarda)', () => {
    const resultado = promover(
      [
        paso({
          accion: { tipo: 'act', instruccion: null, metodo: 'fill', argumentos: [VALOR_CENSURADO] },
        }),
      ],
      OBJETIVO,
    );
    expect(resultado.promovida).toBe(false);
    if (resultado.promovida) return;
    expect(resultado.motivo).toContain('sensible');
  });

  it('un valor inocente que no es parametro se guarda como literal', () => {
    const resultado = promover(
      [
        paso({
          accion: { tipo: 'act', instruccion: null, metodo: 'fill', argumentos: ['facturas'] },
        }),
      ],
      OBJETIVO,
    );
    expect(resultado.promovida).toBe(true);
    if (!resultado.promovida) return;
    expect(resultado.pasos[0]?.valor).toEqual({ tipo: 'literal', texto: 'facturas' });
  });

  it('un paso por COORDENADAS (click/type sin selector del motor) se promueve si hubo observacion', () => {
    const resultado = promover(
      [
        paso({
          accion: { tipo: 'type', instruccion: null, metodo: 'type', argumentos: ['juan@ejemplo.com'] },
          selector: XPATH.xpath,
          estrategias: [ATRIBUTO, XPATH],
        }),
      ],
      OBJETIVO,
    );
    expect(resultado.promovida).toBe(true);
    if (!resultado.promovida) return;
    expect(resultado.pasos[0]).toMatchObject({
      accion: 'escribir',
      valor: { tipo: 'parametro', parametro: 'destinatario' },
    });
  });
});

describe('sustituirParametros (D7: los valores salen del objetivo de ESTA corrida)', () => {
  const PASOS = (() => {
    const resultado = promover(
      [
        paso({
          accion: { tipo: 'act', instruccion: null, metodo: 'fill', argumentos: ['juan@ejemplo.com'] },
        }),
      ],
      'envia el informe a juan@ejemplo.com',
    );
    return resultado.promovida ? resultado.pasos : [];
  })();

  it('sustituye el marcador por el valor del objetivo actual', () => {
    const valores = valoresDeParametros(
      extraerParametrosDeclarados('envia el informe a ana@otra.com'),
    );
    expect(sustituirParametros(PASOS, valores)?.[0]?.texto).toBe('ana@otra.com');
  });

  it('si el objetivo actual NO declara el parametro, la receta no se puede usar (null)', () => {
    expect(sustituirParametros(PASOS, valoresDeParametros(extraerParametrosDeclarados('envia el informe')))).toBeNull();
  });

  it('varios destinatarios dejan el parametro sin resolver: la receta aprendida no aplica', () => {
    const valores = valoresDeParametros(
      extraerParametrosDeclarados('envia el informe a ana@x.com y a luis@y.com'),
    );
    expect(valores.destinatario).toBeUndefined();
    expect(sustituirParametros(PASOS, valores)).toBeNull();
  });
});

describe('auto reparacion y obsolescencia (D5 / D6)', () => {
  it('repararEstrategias reemplaza SOLO el paso indicado y no muta el arreglo original', () => {
    const original = promover([paso(), paso({ idx: 1 })], 'abre el correo');
    expect(original.promovida).toBe(true);
    if (!original.promovida) return;
    const nuevas: EstrategiaLocalizacion[] = [{ tipo: 'texto', texto: 'Enviar' }];
    const reparados = repararEstrategias(original.pasos, 1, nuevas);
    expect(reparados[1]?.estrategias).toEqual(nuevas);
    expect(reparados[0]?.estrategias).toEqual([ATRIBUTO, XPATH]);
    expect(original.pasos[1]?.estrategias).toEqual([ATRIBUTO, XPATH]);
  });

  it('D6: mas de la MITAD de los pasos escalados marca obsoleta; exactamente la mitad no', () => {
    expect(superaElLimiteDeEscaladas(3, 4)).toBe(true);
    expect(superaElLimiteDeEscaladas(2, 4)).toBe(false);
    expect(superaElLimiteDeEscaladas(2, 3)).toBe(true);
    expect(superaElLimiteDeEscaladas(0, 10)).toBe(false);
  });
});
