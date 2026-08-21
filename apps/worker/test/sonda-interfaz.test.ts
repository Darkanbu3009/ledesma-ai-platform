import { describe, it, expect } from 'vitest';
import type { PasoDeReceta } from '@ledesma-platform/shared';
import {
  clasesFaltantes,
  clasesObservablesEnInicio,
  descriptoresDeSonda,
  expresionSondaDeClases,
  LECTURAS_DE_SONDA,
  parsearClaseDeElemento,
  parsearLecturaDeSonda,
} from '../src/sonda-interfaz.js';
import { claseDeElemento } from '../src/atlas-sitios.js';

/**
 * SONDA DE RECONOCIMIENTO PREVIA (pre-flight), parte PURA. Lo que estos tests fijan:
 *
 *  - el PARSEO de una clase usa el mismo formato que produce claseDeElemento (los dos primeros
 *    separadores; el nombre puede contener el separador);
 *  - el criterio GENERICO de observabilidad: solo lo anterior (inclusive) al primer paso que puede
 *    mutar la pagina, medido sobre DOS procedimientos con formas reales distintas;
 *  - la comparacion de presencia es la MISMA de la barrera de identidad (normalizarTexto + prefijo);
 *  - la lectura es tolerante: cualquier basura deja la sonda no evaluable, jamas un desajuste.
 */

const DOMINIO = 'correo.ejemplo.com';

function paso(idx: number, parcial: Partial<PasoDeReceta>): PasoDeReceta {
  return {
    idx,
    accion: 'click',
    estrategias: [],
    valor: null,
    teclas: null,
    ruta: null,
    esperaMs: null,
    ...parcial,
  };
}

const rol = (rolAria: string, nombre: string) => ({ tipo: 'rol' as const, rol: rolAria, nombre });

/**
 * PROCEDIMIENTO REAL 1 (forma "panel que nace de un click", la de una grabacion de correo): el
 * primer paso abre el redactor y TODO lo demas (destinatario, asunto, envio) nace de ese click.
 */
function procedimientoConPanel(): PasoDeReceta[] {
  return [
    paso(0, { accion: 'click', estrategias: [rol('button', 'Redactar')] }),
    paso(1, {
      accion: 'escribir',
      estrategias: [rol('textbox', 'Destinatarios en Para')],
      valor: { tipo: 'parametro', parametro: 'destinatario' },
    }),
    paso(2, { accion: 'verificar' }),
    paso(3, { accion: 'click', estrategias: [rol('button', 'Enviar')] }),
  ];
}

/**
 * PROCEDIMIENTO REAL 2 (forma "formulario ya visible", la de la plantilla compartida de envio): los
 * campos existen desde el arranque y el primer paso ya escribe en uno de ellos.
 */
function procedimientoDeFormulario(): PasoDeReceta[] {
  return [
    paso(0, {
      accion: 'escribir',
      estrategias: [rol('textbox', 'Destinatarios en Para')],
      valor: { tipo: 'parametro', parametro: 'destinatario' },
    }),
    paso(1, {
      accion: 'escribir',
      estrategias: [rol('textbox', 'Asunto')],
      valor: { tipo: 'parametro', parametro: 'asunto' },
    }),
    paso(2, { accion: 'verificar' }),
    paso(3, { accion: 'click', estrategias: [rol('button', 'Enviar')] }),
  ];
}

describe('parsearClaseDeElemento: el formato canonico de claseDeElemento', () => {
  it('parsea los tres ejes', () => {
    expect(parsearClaseDeElemento('click|rol:button|enviar')).toEqual({
      clase: 'click|rol:button|enviar',
      eje: 'rol',
      rol: 'button',
      atributo: null,
      nombre: 'enviar',
    });
    expect(parsearClaseDeElemento('escribir|atributo:aria-label|para')).toMatchObject({
      eje: 'atributo',
      atributo: 'aria-label',
      nombre: 'para',
    });
    expect(parsearClaseDeElemento('click|texto|comprar ahora')).toMatchObject({
      eje: 'texto',
      nombre: 'comprar ahora',
    });
  });

  it('el nombre puede contener el separador: solo se parte por los dos primeros', () => {
    expect(parsearClaseDeElemento('click|rol:button|a|b')).toMatchObject({ nombre: 'a|b' });
  });

  it('falla ABIERTA ante formas fuera de contrato: esa clase no se sondea', () => {
    expect(parsearClaseDeElemento('sin separadores')).toBeNull();
    expect(parsearClaseDeElemento('click|rol:button|')).toBeNull();
    expect(parsearClaseDeElemento('click|otra-cosa|nombre')).toBeNull();
    // Solo los atributos de la lista estrecha del atlas: un atributo raro no entra a un selector.
    expect(parsearClaseDeElemento('click|atributo:onclick|x')).toBeNull();
    expect(parsearClaseDeElemento('click|atributo:data-testid|x')).not.toBeNull();
  });

  it('lo que produce claseDeElemento siempre se puede parsear de vuelta', () => {
    const clase = claseDeElemento('click', [rol('button', 'Enviar (Ctrl-Enter)')]);
    expect(clase).not.toBeNull();
    expect(parsearClaseDeElemento(clase ?? '')).toMatchObject({ eje: 'rol', rol: 'button' });
  });
});

describe('clasesObservablesEnInicio: el criterio generico, sobre dos formas reales', () => {
  it('forma con panel: SOLO el boton que lo abre es observable; lo que nace del click no', () => {
    const clases = clasesObservablesEnInicio(procedimientoConPanel(), DOMINIO);
    expect(clases).toEqual(['click|rol:button|redactar']);
  });

  it('forma de formulario visible: la primera escritura es observable y corta el recorrido', () => {
    // El primer paso que actua puede desplegar un autocompletado: nada posterior es observable de
    // forma generica, aunque en este sitio concreto lo fuera.
    const clases = clasesObservablesEnInicio(procedimientoDeFormulario(), DOMINIO);
    expect(clases).toEqual(['escribir|rol:textbox|destinatarios en para']);
  });

  it('verificar y esperar no mutan la pagina y no cortan el recorrido', () => {
    const clases = clasesObservablesEnInicio(
      [
        paso(0, { accion: 'esperar', esperaMs: 100 }),
        paso(1, { accion: 'verificar' }),
        paso(2, { accion: 'click', estrategias: [rol('button', 'Enviar')] }),
      ],
      DOMINIO,
    );
    expect(clases).toEqual(['click|rol:button|enviar']);
  });

  it('un procedimiento que arranca navegando o tecleando no tiene nada observable', () => {
    expect(
      clasesObservablesEnInicio(
        [paso(0, { accion: 'navegar', ruta: '/bandeja' }), ...procedimientoConPanel()],
        DOMINIO,
      ),
    ).toEqual([]);
    expect(
      clasesObservablesEnInicio(
        [paso(0, { accion: 'teclas', teclas: 'Escape' }), ...procedimientoConPanel()],
        DOMINIO,
      ),
    ).toEqual([]);
  });

  it('un paso de OTRO dominio corta: en la pagina de enfrente no hay nada de otro sitio', () => {
    const clases = clasesObservablesEnInicio(
      [paso(0, { accion: 'click', dominio: 'tienda.ejemplo.com', estrategias: [rol('button', 'Comprar')] })],
      DOMINIO,
    );
    expect(clases).toEqual([]);
  });

  it('un primer paso sin clase (solo xpath) no deja nada que sondear', () => {
    const clases = clasesObservablesEnInicio(
      [paso(0, { accion: 'click', estrategias: [{ tipo: 'xpath', xpath: '/html[1]/body[1]' }] })],
      DOMINIO,
    );
    expect(clases).toEqual([]);
  });
});

describe('clasesFaltantes: la misma comparacion que la barrera de identidad', () => {
  const descriptores = descriptoresDeSonda(['click|rol:button|enviar']);

  it('presente por PREFIJO tras normalizar: el nombre real puede llevar sufijos', () => {
    expect(clasesFaltantes(descriptores, [['Enviar (Ctrl-Enter)']])).toEqual([]);
    // La normalizacion es la de normalizarTexto: acentos fuera, espacios colapsados, minusculas.
    expect(clasesFaltantes(descriptores, [['  ENVIAR   ya  ']])).toEqual([]);
  });

  it('un control renombrado o un candidato de otra familia es un faltante', () => {
    expect(clasesFaltantes(descriptores, [['Eliminar definitivamente', 'Archivar']])).toEqual([
      'click|rol:button|enviar',
    ]);
    expect(clasesFaltantes(descriptores, [[]])).toEqual(['click|rol:button|enviar']);
  });

  it('con acentos en la pagina y la clase normalizada, sigue siendo presencia (cero falsos desajustes)', () => {
    const conAcento = descriptoresDeSonda(['click|rol:button|configuracion']);
    expect(clasesFaltantes(conAcento, [['Configuración avanzada']])).toEqual([]);
  });
});

describe('parsearLecturaDeSonda: tolerante, jamas un desajuste sobre basura', () => {
  it('acepta la forma exacta y filtra lo que no sea texto', () => {
    expect(parsearLecturaDeSonda('[["a", 3, "b"]]', 1)).toEqual([['a', 'b']]);
  });

  it('rechaza null, vacio, JSON roto, largo distinto o elementos que no son listas', () => {
    expect(parsearLecturaDeSonda(null, 1)).toBeNull();
    expect(parsearLecturaDeSonda('', 1)).toBeNull();
    expect(parsearLecturaDeSonda('{', 1)).toBeNull();
    expect(parsearLecturaDeSonda('[[]]', 2)).toBeNull();
    expect(parsearLecturaDeSonda('["a"]', 1)).toBeNull();
  });
});

describe('expresionSondaDeClases: solo lectura y sin un solo dato de sitio', () => {
  it('es una expresion autocontenida que no navega, no clickea y no teclea', () => {
    const expresion = expresionSondaDeClases(descriptoresDeSonda(['click|rol:button|enviar']));
    for (const prohibido of ['location.href =', '.click(', 'dispatchEvent', 'submit(', 'value =']) {
      expect(expresion).not.toContain(prohibido);
    }
    expect(expresion).toContain('JSON.stringify(resultado)');
  });

  it('los nombres de las clases NO viajan a la pagina: la comparacion corre en el worker', () => {
    const expresion = expresionSondaDeClases(descriptoresDeSonda(['click|rol:button|enviar']));
    expect(expresion).not.toContain('enviar');
  });

  it('la decision exige el reintento: la constante de lecturas es dos', () => {
    expect(LECTURAS_DE_SONDA).toBe(2);
  });
});
