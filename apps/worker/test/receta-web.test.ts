import { describe, it, expect } from 'vitest';
import { parsearPasosDeReceta, type EstrategiaLocalizacion } from '@ledesma-platform/shared';
import { VALOR_CENSURADO } from '../src/censura.js';
import {
  descripcionGeneralizada,
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

  /**
   * FIRMA CANONICA (caso real de produccion, receta ad0731c8): cada dato declarado deja UN marcador
   * en la posicion de su valor y la palabra con la que el objetivo nombra al campo se conserva. La
   * firma que quedo guardada duplicaba los marcadores y se comia esos rotulos ("con el <asunto>
   * <asunto> y el siguiente <cuerpo> del mensaje <cuerpo>").
   */
  it('un dato declarado deja UN marcador y no consume la palabra que nombra al campo', () => {
    const firma = firmaDeObjetivo(
      'Enviar un correo electronico a omar.ledesm91@gmail.com con el asunto "Trayectoria fresca" y ' +
        'el siguiente cuerpo del mensaje "Este correo lo envio el sistema". La tarea termina cuando ' +
        'el correo haya sido enviado exitosamente.',
    );
    expect(firma).toBe(
      'enviar un correo electronico a <destinatario> con el asunto <asunto> y el siguiente cuerpo ' +
        'del mensaje <cuerpo> la tarea termina cuando el correo haya sido enviado exitosamente',
    );
  });

  it('la misma estructura con OTROS valores firma igual que la canonica', () => {
    const plantilla = (destinatario: string, asunto: string, cuerpo: string): string =>
      `Enviar un correo electronico a ${destinatario} con el asunto "${asunto}" y el siguiente ` +
      `cuerpo del mensaje "${cuerpo}". La tarea termina cuando el correo haya sido enviado exitosamente.`;
    expect(plantilla('ana@y.com', 'Hola', 'Nos vemos manana')).not.toBe(
      plantilla('omar.ledesm91@gmail.com', 'Trayectoria fresca', 'Este correo lo envio el sistema'),
    );
    expect(firmaDeObjetivo(plantilla('ana@y.com', 'Hola', 'Nos vemos manana'))).toBe(
      firmaDeObjetivo(
        plantilla('omar.ledesm91@gmail.com', 'Trayectoria fresca', 'Este correo lo envio el sistema'),
      ),
    );
  });

  /**
   * ALCANCE de la via rapida, explicito para que nadie lo confunda con matcheo semantico: la firma
   * es igualdad ESTRUCTURAL, no equivalencia de significado. Un fraseo libre de la MISMA tarea firma
   * distinto y por tanto no dispara la via rapida: ese pedido va al selector con modelo, que es
   * justo para lo que existe.
   */
  it('un fraseo libre de la misma tarea NO comparte firma (va al selector, no a la via rapida)', () => {
    const canonica = firmaDeObjetivo(
      'Enviar un correo electronico a ana@y.com con el asunto "Hola" y el siguiente cuerpo del ' +
        'mensaje "Nos vemos". La tarea termina cuando el correo haya sido enviado exitosamente.',
    );
    const libre = firmaDeObjetivo('Manda un correo a ana@y.com con el asunto "Hola" y dile: "Nos vemos"');
    expect(libre).not.toBe(canonica);
  });
});

describe('descripcionGeneralizada (FIX seleccion: la descripcion sin los valores de la corrida origen)', () => {
  it('sustituye los valores parametrizados por sus nombres de parametro, conservando el resto', () => {
    const descripcion = descripcionGeneralizada(
      'Envia un correo a Martin@Ejemplo.com con el asunto "Trayectoria fresca" y el cuerpo "Este correo genera la trayectoria"',
    );
    expect(descripcion).toBe(
      'Envia un correo a <destinatario> con el asunto "<asunto>" y el cuerpo "<cuerpo>"',
    );
  });

  it('ningun valor literal sobrevive, aunque el usuario lo haya escrito con otras mayusculas', () => {
    const descripcion = descripcionGeneralizada(
      'manda un correo a ANA@EJEMPLO.COM con asunto "Hola" y mensaje "llego el paquete de 2,400 MXN"',
    );
    expect(descripcion).not.toContain('ANA@EJEMPLO.COM');
    expect(descripcion).not.toContain('Hola');
    expect(descripcion).not.toContain('llego el paquete');
    expect(descripcion).toContain('<destinatario>');
    expect(descripcion).toContain('<asunto>');
    expect(descripcion).toContain('<cuerpo>');
  });

  it('un objetivo sin parametros declarados queda tal cual', () => {
    expect(descripcionGeneralizada('archiva el primer mensaje de la bandeja')).toBe(
      'archiva el primer mensaje de la bandeja',
    );
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

  it('un click de FOCO sin estrategias se descarta si una escritura posterior lo cubre', () => {
    // Caso real de produccion (jul 2026): "click the textbox Cuerpo del mensaje" sin selector antes
    // del fill del mismo campo con selector propio. El ejecutor enfoca el localizador de la
    // escritura antes de teclear, asi que el click de foco es redundante.
    const resultado = promover(
      [
        paso({ estrategias: [] , selector: null }),
        paso({
          idx: 1,
          accion: { tipo: 'act', instruccion: null, metodo: 'fill', argumentos: ['hola'] },
          estrategias: [ATRIBUTO, XPATH],
        }),
      ],
      'abre el ultimo correo',
    );
    expect(resultado.promovida).toBe(true);
    if (!resultado.promovida) return;
    expect(resultado.pasos.map((p) => p.accion)).toEqual(['escribir']);
  });

  it('un click sin estrategias al que NINGUNA escritura sigue bloquea nombrando el paso exacto', () => {
    const resultado = promover(
      [
        paso({
          accion: { tipo: 'act', instruccion: null, metodo: 'fill', argumentos: ['hola'] },
          estrategias: [ATRIBUTO, XPATH],
        }),
        paso({ idx: 1, estrategias: [], selector: null }),
      ],
      'abre el ultimo correo',
    );
    expect(resultado.promovida).toBe(false);
    if (resultado.promovida) return;
    expect(resultado.motivo).toContain('paso 1');
    // La frase estable que la consola ya clasifica como "sin estrategia" se conserva.
    expect(resultado.motivo).toContain('sin ninguna estrategia de localizacion');
  });

  it('un click sin estrategias pero CON dato no es un click de foco: bloquea nombrando el paso', () => {
    const resultado = promover(
      [
        paso({ accion: { tipo: 'act', instruccion: null, metodo: 'click', argumentos: ['opcion 3'] }, estrategias: [], selector: null }),
        paso({
          idx: 1,
          accion: { tipo: 'act', instruccion: null, metodo: 'fill', argumentos: ['hola'] },
          estrategias: [ATRIBUTO, XPATH],
        }),
      ],
      'abre el ultimo correo',
    );
    expect(resultado.promovida).toBe(false);
    if (resultado.promovida) return;
    // FIX B: el motivo nombra indice y descripcion del paso, conservando la frase estable.
    expect(resultado.motivo).toContain('paso 0');
    expect(resultado.motivo).toContain('sin ninguna estrategia de localizacion');
  });

  it('un act SIN metodo registrado (resuelto por vision) tambien cuenta como click de foco', () => {
    // Caso real de produccion (28 jul 2026): los acts "click the textbox Cuerpo del mensaje" y
    // "click the message body area" persisten sin playwrightArguments, o sea sin metodo y sin
    // selector. La regla del PR 258 exigia metodo 'click' y por eso no los descartaba.
    const resultado = promover(
      [
        paso({
          accion: { tipo: 'act', instruccion: 'click the message body area', metodo: null, argumentos: [] },
          estrategias: [],
          selector: null,
        }),
        paso({
          idx: 1,
          accion: { tipo: 'act', instruccion: 'escribir el cuerpo', metodo: 'fill', argumentos: ['hola'] },
          estrategias: [ATRIBUTO, XPATH],
        }),
      ],
      'abre el ultimo correo',
    );
    expect(resultado.promovida).toBe(true);
    if (!resultado.promovida) return;
    expect(resultado.pasos.map((p) => p.accion)).toEqual(['escribir']);
  });

  it('un type CON dato y SIN estrategia adopta el localizador del paso adyacente del mismo campo', () => {
    // FIX A (derivacion cruzada, caso real de la trayectoria de 19 pasos): el type del cuerpo sin
    // selector seguido del click del cuerpo CON selector produce un paso 'escribir' que usa el
    // localizador del click.
    const resultado = promover(
      [
        paso({
          accion: {
            tipo: 'act',
            instruccion: 'type the message into the body',
            metodo: 'type',
            argumentos: ['hola'],
          },
          estrategias: [],
          selector: null,
        }),
        paso({
          idx: 1,
          accion: { tipo: 'act', instruccion: 'click the textbox Cuerpo del mensaje', metodo: 'click', argumentos: [] },
          estrategias: [ATRIBUTO, XPATH],
          selector: '/html[1]/body[1]/div[2]',
        }),
      ],
      'abre el ultimo correo',
    );
    expect(resultado.promovida).toBe(true);
    if (!resultado.promovida) return;
    expect(resultado.pasos.map((p) => p.accion)).toEqual(['escribir', 'click']);
    expect(resultado.pasos[0]?.estrategias).toEqual([ATRIBUTO, XPATH]);
  });

  it('un type CON dato, SIN estrategia y SIN adyacente que cubra el campo bloquea nombrando el paso', () => {
    const resultado = promover(
      [
        paso({
          accion: {
            tipo: 'act',
            instruccion: 'type the message into the body',
            metodo: 'type',
            argumentos: ['hola'],
          },
          estrategias: [],
          selector: null,
        }),
        paso({
          idx: 1,
          accion: { tipo: 'act', instruccion: 'click the subject field', metodo: 'click', argumentos: [] },
          estrategias: [ATRIBUTO, XPATH],
          selector: '/html[1]/body[1]/div[3]',
        }),
      ],
      'abre el ultimo correo',
    );
    expect(resultado.promovida).toBe(false);
    if (resultado.promovida) return;
    expect(resultado.motivo).toContain('paso 0');
    expect(resultado.motivo).toContain('type the message into the body');
    expect(resultado.motivo).toContain('sin estrategia y sin paso adyacente que cubra el campo');
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

  it('el valor del usuario tampoco queda DENTRO de una localizacion', () => {
    // El campo se observo con el dato ya escrito, asi que su texto visible ES el dato. Guardar esa
    // estrategia persistiria el correo del usuario en la receta y ademas localizaria por un valor
    // que la proxima corrida no va a tener.
    const resultado = promover(
      [
        paso({
          accion: { tipo: 'act', instruccion: null, metodo: 'fill', argumentos: ['juan@ejemplo.com'] },
          estrategias: [ATRIBUTO, { tipo: 'texto', texto: 'juan@ejemplo.com' }, XPATH],
        }),
      ],
      OBJETIVO,
    );
    expect(resultado.promovida).toBe(true);
    if (!resultado.promovida) return;
    expect(JSON.stringify(resultado.pasos)).not.toContain('juan@ejemplo.com');
    expect(resultado.pasos[0]?.estrategias).toEqual([ATRIBUTO, XPATH]);
  });

  it('un paso que SOLO se localiza por el dato tecleado no se promueve', () => {
    const resultado = promover(
      [
        paso({
          accion: { tipo: 'act', instruccion: null, metodo: 'fill', argumentos: ['juan@ejemplo.com'] },
          estrategias: [{ tipo: 'texto', texto: 'juan@ejemplo.com' }],
        }),
      ],
      OBJETIVO,
    );
    expect(resultado.promovida).toBe(false);
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

  it('reparar NO guarda una estrategia que dependa del dato que ese paso acaba de teclear', () => {
    const original = promover([paso(), paso({ idx: 1 })], 'abre el correo');
    expect(original.promovida).toBe(true);
    if (!original.promovida) return;
    // Las estrategias se releen del DOM DESPUES de escribir, o sea con el campo ya lleno.
    const leidasDelDom: EstrategiaLocalizacion[] = [
      { tipo: 'texto', texto: 'ana@ejemplo.com' },
      { tipo: 'atributo', atributo: 'name', valor: 'to' },
    ];
    const reparados = repararEstrategias(original.pasos, 1, leidasDelDom, 'ana@ejemplo.com');
    expect(reparados[1]?.estrategias).toEqual([{ tipo: 'atributo', atributo: 'name', valor: 'to' }]);
    expect(JSON.stringify(reparados)).not.toContain('ana@ejemplo.com');
  });

  it('si TODAS las estrategias nuevas dependen del dato, se conserva la que la receta ya tenia', () => {
    const original = promover([paso(), paso({ idx: 1 })], 'abre el correo');
    expect(original.promovida).toBe(true);
    if (!original.promovida) return;
    const soloElDato: EstrategiaLocalizacion[] = [{ tipo: 'texto', texto: 'ana@ejemplo.com' }];
    expect(repararEstrategias(original.pasos, 1, soloElDato, 'ana@ejemplo.com')).toEqual(original.pasos);
  });

  it('D6: mas de la MITAD de los pasos escalados marca obsoleta; exactamente la mitad no', () => {
    expect(superaElLimiteDeEscaladas(3, 4)).toBe(true);
    expect(superaElLimiteDeEscaladas(2, 4)).toBe(false);
    expect(superaElLimiteDeEscaladas(2, 3)).toBe(true);
    expect(superaElLimiteDeEscaladas(0, 10)).toBe(false);
  });
});

/**
 * TAREAS QUE CRUZAN VARIOS SITIOS: la firma incorpora el CONJUNTO de dominios y cada paso guarda a
 * que sitio pertenece. Sin lo primero, una tarea de un sitio y otra que usa dos compartirian receta;
 * sin lo segundo, la receta no sabria en que sitio repetir cada paso.
 */
describe('firmaDeObjetivo con varios sitios', () => {
  it('una tarea de UN sitio firma EXACTAMENTE como antes de este cambio', () => {
    const objetivo = 'envia el informe a juan@ejemplo.com';
    expect(firmaDeObjetivo(objetivo, ['app.ejemplo.com'])).toBe(firmaDeObjetivo(objetivo));
    expect(firmaDeObjetivo(objetivo, [])).toBe(firmaDeObjetivo(objetivo));
  });

  it('el mismo objetivo con dos sitios NO comparte firma con el de un sitio', () => {
    const objetivo = 'envia el informe a juan@ejemplo.com';
    expect(firmaDeObjetivo(objetivo, ['tienda.com', 'correo.com'])).not.toBe(firmaDeObjetivo(objetivo));
  });

  it('el conjunto de dominios no depende del orden en que se empezo', () => {
    const objetivo = 'envia el informe a juan@ejemplo.com';
    expect(firmaDeObjetivo(objetivo, ['tienda.com', 'correo.com'])).toBe(
      firmaDeObjetivo(objetivo, ['correo.com', 'tienda.com']),
    );
  });

  it('dos conjuntos de sitios distintos firman distinto', () => {
    const objetivo = 'envia el informe a juan@ejemplo.com';
    expect(firmaDeObjetivo(objetivo, ['tienda.com', 'correo.com'])).not.toBe(
      firmaDeObjetivo(objetivo, ['agenda.com', 'correo.com']),
    );
  });
});

describe('promoverTrayectoria con pasos de varios sitios', () => {
  it('un paso de OTRO sitio guarda su dominio; los del sitio de la receta lo dejan en null', () => {
    const resultado = promover(
      [
        paso({ dominio: DOMINIO }),
        paso({ dominio: 'correo.ejemplo.com', url: 'https://correo.ejemplo.com/inbox' }),
      ],
      'abre el ultimo correo',
    );
    expect(resultado.promovida).toBe(true);
    if (!resultado.promovida) return;
    expect(resultado.pasos.map((p) => p.dominio)).toEqual([null, 'correo.ejemplo.com']);
    // Y sigue validando contra el contrato compartido: es lo que se persiste como jsonb.
    expect(parsearPasosDeReceta(JSON.parse(JSON.stringify(resultado.pasos)))).not.toBeNull();
  });

  it('una navegacion se resuelve contra el dominio DEL PASO, no contra el de la receta', () => {
    const resultado = promover(
      [
        paso({
          accion: { tipo: 'goto', instruccion: null, metodo: null, argumentos: [] },
          dominio: 'correo.ejemplo.com',
          url: 'https://correo.ejemplo.com/redactar',
          estrategias: [],
        }),
      ],
      'abre el redactor',
    );
    expect(resultado.promovida).toBe(true);
    if (!resultado.promovida) return;
    expect(resultado.pasos[0]).toMatchObject({
      accion: 'navegar',
      ruta: '/redactar',
      dominio: 'correo.ejemplo.com',
    });
  });

  it('el cambio de sitio no se promueve como paso: lo que viaja es el dominio de cada paso', () => {
    const resultado = promover(
      [
        paso({ dominio: DOMINIO }),
        paso({
          accion: { tipo: 'cambiar_de_sitio', instruccion: null, metodo: null, argumentos: [] },
          estrategias: [],
          dominio: DOMINIO,
        }),
        paso({ dominio: 'correo.ejemplo.com', url: 'https://correo.ejemplo.com/inbox' }),
      ],
      'abre el ultimo correo',
    );
    expect(resultado.promovida).toBe(true);
    if (!resultado.promovida) return;
    expect(resultado.pasos).toHaveLength(2);
    expect(resultado.pasos.map((p) => p.accion)).toEqual(['click', 'click']);
  });
});
