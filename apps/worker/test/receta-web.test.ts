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
import {
  construirPasoDeBloqueo,
  construirPasoDeVerificacion,
  type Veredicto,
} from '../src/verificacion.js';
import { resumenDeIdentidad } from '../src/barrera-identidad.js';
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

  it('un click sin estrategias con un dato que el objetivo NO declara se descarta, no aborta', () => {
    // Politica de metodos no representables (FIX A): un click sin localizador no se puede repetir,
    // pero si el dato que lleva no es un dato DECLARADO del objetivo, descartarlo no le quita nada a
    // la receta. Antes abortaba la conversion entera; ahora se descarta y la escritura posterior
    // queda. La conversion solo se cae cuando el dato perdido si era del objetivo (ver mas abajo).
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
    expect(resultado.promovida).toBe(true);
    if (!resultado.promovida) return;
    expect(resultado.pasos.map((p) => p.accion)).toEqual(['escribir']);
    expect(resultado.metodosDescartados).toContain('click');
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

  it('un metodo que el ejecutor no sabe repetir (selectOption) sin dato del objetivo se descarta', () => {
    // FIX A: el selectOption ya no aborta por si mismo. Sin ningun dato declarado del objetivo se
    // descarta, y como era el unico paso la receta queda vacia y no se promueve por eso.
    const resultado = promover(
      [paso({ accion: { tipo: 'act', instruccion: null, metodo: 'selectOption', argumentos: ['a'] } })],
      'abre el correo',
    );
    expect(resultado.promovida).toBe(false);
    if (resultado.promovida) return;
    expect(resultado.motivo).toContain('ningun paso re-ejecutable');
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

/**
 * METODOS NO REPRESENTABLES (FIX A): cerrar la CATEGORIA para que ninguna tool futura vuelva a abortar
 * una conversion. Un gesto de enfoque o ajuste (clickAndHold, scroll), un select nativo o una tool
 * DESCONOCIDA de una version futura de Stagehand se DESCARTA en silencio (fail-open); la conversion
 * solo aborta cuando el paso llevaba un dato DECLARADO del objetivo que ningun otro paso cubre.
 */
describe('promoverTrayectoria con metodos no representables (FIX A)', () => {
  const ROL_COMPOSE: EstrategiaLocalizacion = { tipo: 'rol', rol: 'button', nombre: 'Redactar' };
  const ROL_SEND: EstrategiaLocalizacion = { tipo: 'rol', rol: 'button', nombre: 'Enviar' };
  const ATRIBUTO_TO: EstrategiaLocalizacion = { tipo: 'atributo', atributo: 'aria-label', valor: 'Para' };
  const ATRIBUTO_SUBJ: EstrategiaLocalizacion = { tipo: 'atributo', atributo: 'aria-label', valor: 'Asunto' };
  const ATRIBUTO_BODY: EstrategiaLocalizacion = { tipo: 'atributo', atributo: 'aria-label', valor: 'Cuerpo del mensaje' };
  const ATRIBUTO_FS: EstrategiaLocalizacion = { tipo: 'atributo', atributo: 'aria-label', valor: 'Pantalla completa' };

  /** Un click de enfoque sobre el cuerpo, sin localizador (Stagehand lo resolvio por vision). */
  const focoCuerpo = (idx: number, metodo: string | null = 'click'): PasoCensurado =>
    paso({
      idx,
      accion: { tipo: 'act', instruccion: 'click the message body area', metodo, argumentos: [] },
      estrategias: [],
      selector: null,
    });

  it('convierte COMPLETA la corrida real (28 pasos, clickAndHold en la posicion 22, 13 focos)', () => {
    // Corrida del 30 jul 06:14 UTC: envio de correo exitoso que el conversor rechazaba por el
    // clickAndHold del paso 22. Debe convertir entera, sin rastro del gesto ni de los clicks de
    // enfoque redundantes sobre el cuerpo, produciendo una receta de 6 a 10 pasos.
    const OBJETIVO_CORREO =
      'Enviar un correo electronico a omar.ledesm91@gmail.com con el asunto "Trayectoria fresca" y ' +
      'el siguiente cuerpo del mensaje "Este correo lo envio el sistema". La tarea termina cuando el ' +
      'correo haya sido enviado exitosamente.';

    const pasosCorrida: PasoCensurado[] = [
      // navegar al correo
      paso({ idx: 0, accion: { tipo: 'goto', instruccion: null, metodo: null, argumentos: [] }, estrategias: [], selector: null, url: `https://${DOMINIO}/mail` }),
      // exploracion: el motor mira, no actua
      paso({ idx: 1, accion: { tipo: 'screenshot', instruccion: null, metodo: null, argumentos: [] }, estrategias: [], selector: null }),
      paso({ idx: 2, accion: { tipo: 'ariaTree', instruccion: null, metodo: null, argumentos: [] }, estrategias: [], selector: null }),
      // abrir el redactor
      paso({ idx: 3, accion: { tipo: 'act', instruccion: 'click the Compose button', metodo: 'click', argumentos: [] }, estrategias: [ROL_COMPOSE, XPATH], selector: '/html/body/div/div[3]' }),
      paso({ idx: 4, accion: { tipo: 'think', instruccion: null, metodo: null, argumentos: [] }, estrategias: [], selector: null }),
      // foco del destinatario (redundante: lo cubre la escritura siguiente)
      paso({ idx: 5, accion: { tipo: 'act', instruccion: 'click the recipients field', metodo: 'click', argumentos: [] }, estrategias: [], selector: null }),
      // escribir destinatario
      paso({ idx: 6, accion: { tipo: 'act', instruccion: 'type the recipient', metodo: 'fill', argumentos: ['omar.ledesm91@gmail.com'] }, estrategias: [ATRIBUTO_TO, XPATH], selector: '/html/body/div/form/input[1]' }),
      paso({ idx: 7, accion: { tipo: 'extract', instruccion: null, metodo: null, argumentos: [] }, estrategias: [], selector: null }),
      // foco del asunto (redundante)
      paso({ idx: 8, accion: { tipo: 'act', instruccion: 'click the subject field', metodo: 'click', argumentos: [] }, estrategias: [], selector: null }),
      // escribir asunto
      paso({ idx: 9, accion: { tipo: 'act', instruccion: 'type the subject', metodo: 'fill', argumentos: ['Trayectoria fresca'] }, estrategias: [ATRIBUTO_SUBJ, XPATH], selector: '/html/body/div/form/input[2]' }),
      // control de cabecera del compose (pantalla completa): conmuta la vista, no acerca al objetivo
      paso({ idx: 10, accion: { tipo: 'act', instruccion: 'click the full screen button', metodo: 'click', argumentos: [] }, estrategias: [ATRIBUTO_FS, XPATH], selector: '/html/body/div/div[9]' }),
      // pelea por enfocar el cuerpo: trece clicks de enfoque, con un clickAndHold en el medio
      focoCuerpo(11), focoCuerpo(12), focoCuerpo(13), focoCuerpo(14, null), focoCuerpo(15),
      focoCuerpo(16), focoCuerpo(17), focoCuerpo(18), focoCuerpo(19), focoCuerpo(20),
      // POSICION 22 (idx 21): clickAndHold sin selector y sin dato, el gesto que abortaba la conversion
      paso({ idx: 21, accion: { tipo: 'clickAndHold', instruccion: 'click and hold on the message body', metodo: null, argumentos: [] }, estrategias: [], selector: null }),
      focoCuerpo(22), focoCuerpo(23), focoCuerpo(24),
      // escribir el cuerpo (cubre todos los clicks de enfoque anteriores sobre el mismo campo)
      paso({ idx: 25, accion: { tipo: 'act', instruccion: 'type the message into the body', metodo: 'fill', argumentos: ['Este correo lo envio el sistema'] }, estrategias: [ATRIBUTO_BODY, XPATH], selector: '/html/body/div/form/div[1]' }),
      // verificacion determinista antes del envio irreversible
      paso({ idx: 26, accion: { tipo: 'verificacion', instruccion: 'ok', metodo: null, argumentos: [] }, estrategias: [], selector: null }),
      // enviar
      paso({ idx: 27, accion: { tipo: 'act', instruccion: 'click the Send button', metodo: 'click', argumentos: [] }, estrategias: [ROL_SEND, XPATH], selector: '/html/body/div/form/div[2]' }),
    ];

    expect(pasosCorrida).toHaveLength(28);

    const resultado = promover(pasosCorrida, OBJETIVO_CORREO, 'exitosa', true);
    expect(resultado.promovida).toBe(true);
    if (!resultado.promovida) return;

    // La receta queda dentro del rango pedido (6 a 10 pasos), en este caso exactamente 7.
    expect(resultado.pasos.length).toBeGreaterThanOrEqual(6);
    expect(resultado.pasos.length).toBeLessThanOrEqual(10);
    expect(resultado.pasos).toHaveLength(7);
    expect(resultado.pasos.map((p) => p.accion)).toEqual([
      'navegar', 'click', 'escribir', 'escribir', 'escribir', 'verificar', 'click',
    ]);

    // Ni rastro del clickAndHold ni de los clicks de enfoque redundantes sobre el cuerpo.
    expect(JSON.stringify(resultado.pasos)).not.toContain('clickAndHold');
    expect(JSON.stringify(resultado.pasos)).not.toContain('message body area');

    // Los tres datos del objetivo viajan como marcadores, nunca como valor literal (D8).
    expect(resultado.pasos.filter((p) => p.accion === 'escribir').map((p) => p.valor)).toEqual([
      { tipo: 'parametro', parametro: 'destinatario' },
      { tipo: 'parametro', parametro: 'asunto' },
      { tipo: 'parametro', parametro: 'cuerpo' },
    ]);
    expect(JSON.stringify(resultado.pasos)).not.toContain('omar.ledesm91');
    expect(JSON.stringify(resultado.pasos)).not.toContain('Este correo lo envio el sistema');

    // El gesto no representable quedo registrado por su nombre, para el log de fail-open.
    expect(resultado.metodosDescartados).toEqual(['clickAndHold']);

    // Y el resultado valida contra el contrato compartido: es lo que se persiste como jsonb.
    expect(parsearPasosDeReceta(JSON.parse(JSON.stringify(resultado.pasos)))).not.toBeNull();
  });

  it('una tool DESCONOCIDA de una version futura de Stagehand se descarta, no aborta (fail-open)', () => {
    // Metodo que este conversor no conoce (toolFutura): se trata como no representable y se descarta,
    // dejando su nombre en metodosDescartados, en vez de tumbar una corrida exitosa.
    const resultado = promover(
      [
        paso({ accion: { tipo: 'toolFutura', instruccion: 'do something new', metodo: null, argumentos: [] }, estrategias: [], selector: null }),
        paso({ idx: 1 }),
      ],
      'abre el ultimo correo',
    );
    expect(resultado.promovida).toBe(true);
    if (!resultado.promovida) return;
    expect(resultado.pasos.map((p) => p.accion)).toEqual(['click']);
    expect(resultado.metodosDescartados).toEqual(['toolFutura']);
  });

  it('un metodo no representable que lleva un dato DECLARADO sin cobertura SI aborta', () => {
    // Un select nativo que fija el destinatario, sin ninguna escritura que teclee ese destinatario:
    // descartarlo perderia un dato del objetivo, asi que la conversion se cae (unica causa de aborto).
    const resultado = promover(
      [
        paso({ accion: { tipo: 'act', instruccion: 'pick recipient', metodo: 'selectOption', argumentos: ['juan@ejemplo.com'] } }),
        paso({ idx: 1, accion: { tipo: 'act', instruccion: 'click enviar', metodo: 'click', argumentos: [] } }),
      ],
      'envia el informe a juan@ejemplo.com',
    );
    expect(resultado.promovida).toBe(false);
    if (resultado.promovida) return;
    expect(resultado.motivo).toContain('destinatario');
  });

  it('el mismo metodo no representable NO aborta cuando otra escritura cubre ese dato', () => {
    // El select fija el destinatario, pero un paso 'escribir' teclea ese mismo destinatario: el dato
    // no se pierde, asi que el select se descarta y la receta se promueve.
    const resultado = promover(
      [
        paso({ accion: { tipo: 'act', instruccion: 'pick recipient', metodo: 'selectOption', argumentos: ['juan@ejemplo.com'] } }),
        paso({ idx: 1, accion: { tipo: 'act', instruccion: 'type the recipient', metodo: 'fill', argumentos: ['juan@ejemplo.com'] } }),
      ],
      'envia el informe a juan@ejemplo.com',
    );
    expect(resultado.promovida).toBe(true);
    if (!resultado.promovida) return;
    expect(resultado.pasos.map((p) => p.accion)).toEqual(['escribir']);
    expect(resultado.pasos[0]?.valor).toEqual({ tipo: 'parametro', parametro: 'destinatario' });
    expect(resultado.metodosDescartados).toEqual(['selectOption']);
  });
});

/**
 * COBERTURA DE LOS DATOS DECLARADOS (FIX A/B, corrida real del 30 jul 06:14 UTC). El mismo envio
 * exitoso de arriba, ahora con los DOS detalles que la reconstruccion anterior no tenia: el
 * fillFormVision VACIO que el agente emitio en la POSICION 3, antes de escribir nada, y la
 * instruccion REAL del paso que teclea el destinatario. La conversion abortaba con
 *
 *   paso fillFormVision de llenado sin campos registrados: destinatario sin ningun otro paso que lo cubra
 *
 * pese a que la corrida SI escribia el destinatario en la posicion 6. Las dos causas, encadenadas:
 *  A. la cabecera de llenado VACIA reclamaba la cobertura de todos los datos del objetivo, cuando
 *     no habia escrito ninguno (es un intento de llenado por vision sin constancia de que llenara);
 *  B. la escritura del destinatario se destilaba fuera ANTES de convertirse, porque el grupo de
 *     equivalencia de ese campo ('to', 'para', 'destinatarios', 'recipients') tiene dos palabras
 *     funcionales: cualquier instruccion posterior que diga "to" o "para" -- y la comparacion mira
 *     la instruccion entera, con el valor tecleado dentro -- pasaba por una re-escritura del mismo
 *     campo. La cobertura miraba bien los pasos CONSERVADOS; el paso ya no estaba entre ellos.
 */
describe('promoverTrayectoria con la corrida real del 30 jul 06:14 UTC (fillFormVision vacio)', () => {
  const DESTINATARIO = 'martin.ledesm91@gmail.com';
  const ASUNTO = 'Trayectoria fresca';
  const CUERPO = 'Este correo lo envio el sistema';
  const OBJETIVO_REAL =
    `Enviar un correo electronico a ${DESTINATARIO} con el asunto "${ASUNTO}" y el siguiente cuerpo ` +
    `del mensaje "${CUERPO}". La tarea termina cuando el correo haya sido enviado exitosamente.`;

  const ROL_COMPOSE: EstrategiaLocalizacion = { tipo: 'rol', rol: 'button', nombre: 'Redactar' };
  const ROL_SEND: EstrategiaLocalizacion = { tipo: 'rol', rol: 'button', nombre: 'Enviar' };
  const ATRIBUTO_TO: EstrategiaLocalizacion = { tipo: 'atributo', atributo: 'aria-label', valor: 'Para' };
  const ATRIBUTO_SUBJ: EstrategiaLocalizacion = { tipo: 'atributo', atributo: 'aria-label', valor: 'Asunto' };
  const ATRIBUTO_BODY: EstrategiaLocalizacion = { tipo: 'atributo', atributo: 'aria-label', valor: 'Cuerpo del mensaje' };

  const foco = (idx: number, metodo: string | null = 'click'): PasoCensurado =>
    paso({
      idx,
      accion: { tipo: 'act', instruccion: 'click the message body area', metodo, argumentos: [] },
      estrategias: [],
      selector: null,
    });

  function corridaReal(): PasoCensurado[] {
    return [
      paso({ idx: 0, accion: { tipo: 'goto', instruccion: null, metodo: null, argumentos: [] }, estrategias: [], selector: null, url: `https://${DOMINIO}/mail` }),
      paso({ idx: 1, accion: { tipo: 'screenshot', instruccion: null, metodo: null, argumentos: [] }, estrategias: [], selector: null }),
      // POSICION 3: el llenado por vision que no dejo constancia de haber llenado nada.
      paso({ idx: 2, accion: { tipo: 'fillFormVision', instruccion: 'llenar los campos del correo', metodo: null, argumentos: [] }, estrategias: [], selector: null }),
      paso({ idx: 3, accion: { tipo: 'act', instruccion: 'click the Compose button', metodo: 'click', argumentos: [] }, estrategias: [ROL_COMPOSE, XPATH], selector: '/html/body/div/div[3]' }),
      paso({ idx: 4, accion: { tipo: 'think', instruccion: null, metodo: null, argumentos: [] }, estrategias: [], selector: null }),
      paso({ idx: 5, accion: { tipo: 'act', instruccion: 'click the Para input field', metodo: 'click', argumentos: [] }, estrategias: [], selector: null }),
      // POSICION 6: la escritura del destinatario, con selector y con valor.
      paso({ idx: 6, accion: { tipo: 'act', instruccion: `type "${DESTINATARIO}" into the Para input field`, metodo: 'fill', argumentos: [DESTINATARIO] }, estrategias: [ATRIBUTO_TO, XPATH], selector: '/html/body/div[7]/div[3]/div/form/input[1]', valorCensurado: DESTINATARIO }),
      paso({ idx: 7, accion: { tipo: 'act', instruccion: 'press Tab key to confirm the recipient', metodo: 'press', argumentos: ['Tab'] }, estrategias: [ATRIBUTO_TO], selector: '/html/body/div[7]/div[3]/div/form/input[1]' }),
      paso({ idx: 8, accion: { tipo: 'act', instruccion: 'click the Asunto input field', metodo: 'click', argumentos: [] }, estrategias: [], selector: null }),
      paso({ idx: 9, accion: { tipo: 'act', instruccion: `type "${ASUNTO}" into the Asunto input field`, metodo: 'fill', argumentos: [ASUNTO] }, estrategias: [ATRIBUTO_SUBJ, XPATH], selector: '/html/body/div[7]/div[3]/div/form/input[2]', valorCensurado: ASUNTO }),
      paso({ idx: 10, accion: { tipo: 'act', instruccion: 'click the full screen button', metodo: 'click', argumentos: [] }, estrategias: [XPATH], selector: '/html/body/div/div[9]' }),
      foco(11), foco(12), foco(13), foco(14, null), foco(15),
      foco(16), foco(17), foco(18), foco(19), foco(20),
      paso({ idx: 21, accion: { tipo: 'clickAndHold', instruccion: 'click and hold on the message body', metodo: null, argumentos: [] }, estrategias: [], selector: null }),
      foco(22), foco(23), foco(24),
      // La instruccion del cuerpo termina en "to finish the email": ese "to" es el que hacia pasar
      // esta escritura por una re-escritura del campo Para y borraba el destinatario de la receta.
      paso({ idx: 25, accion: { tipo: 'act', instruccion: `type "${CUERPO}" into the message body to finish the email`, metodo: 'fill', argumentos: [CUERPO] }, estrategias: [ATRIBUTO_BODY, XPATH], selector: '/html/body/div[7]/div[3]/div/form/div[1]', valorCensurado: CUERPO }),
      paso({ idx: 26, accion: { tipo: 'verificacion', instruccion: 'ok', metodo: null, argumentos: [] }, estrategias: [], selector: null }),
      paso({ idx: 27, accion: { tipo: 'act', instruccion: 'click the Send button', metodo: 'click', argumentos: [] }, estrategias: [ROL_SEND, XPATH], selector: '/html/body/div/form/div[2]' }),
    ];
  }

  it('convierte COMPLETA, con el destinatario, el asunto y el cuerpo como marcadores', () => {
    const pasos = corridaReal();
    expect(pasos).toHaveLength(28);

    const resultado = promover(pasos, OBJETIVO_REAL, 'exitosa', true);
    expect(resultado.promovida).toBe(true);
    if (!resultado.promovida) return;

    // La receta queda dentro del rango pedido (6 a 10 pasos), en este caso exactamente 8.
    expect(resultado.pasos.length).toBeGreaterThanOrEqual(6);
    expect(resultado.pasos.length).toBeLessThanOrEqual(10);
    expect(resultado.pasos).toHaveLength(8);
    expect(resultado.pasos.map((p) => p.accion)).toEqual([
      'navegar', 'click', 'escribir', 'teclas', 'escribir', 'escribir', 'verificar', 'click',
    ]);

    // Los tres datos viajan como marcadores. El destinatario es el que se perdia.
    expect(resultado.pasos.filter((p) => p.accion === 'escribir').map((p) => p.valor)).toEqual([
      { tipo: 'parametro', parametro: 'destinatario' },
      { tipo: 'parametro', parametro: 'asunto' },
      { tipo: 'parametro', parametro: 'cuerpo' },
    ]);
    expect(JSON.stringify(resultado.pasos)).not.toContain('martin.ledesm91');

    // La cabecera vacia y el gesto quedan como metodos descartados, que es el rastro del fail-open.
    expect(resultado.metodosDescartados).toEqual(['fillFormVision', 'clickAndHold']);
    expect(parsearPasosDeReceta(JSON.parse(JSON.stringify(resultado.pasos)))).not.toBeNull();
  });

  it('una escritura con dato declarado NO la destila una escritura de OTRO dato (FIX B)', () => {
    // El caso desnudo: dos campos distintos cuyas instrucciones comparten la palabra "to". Las dos
    // escrituras se conservan, cada una con su marcador.
    const resultado = promover(
      [
        paso({ idx: 0, accion: { tipo: 'act', instruccion: `type "${DESTINATARIO}" into the Para input field`, metodo: 'fill', argumentos: [DESTINATARIO] }, estrategias: [ATRIBUTO_TO] }),
        paso({ idx: 1, accion: { tipo: 'act', instruccion: `type "${ASUNTO}" into the subject box to continue`, metodo: 'fill', argumentos: [ASUNTO] }, estrategias: [ATRIBUTO_SUBJ] }),
      ],
      `Enviar un correo a ${DESTINATARIO} con el asunto "${ASUNTO}"`,
    );
    expect(resultado.promovida).toBe(true);
    if (!resultado.promovida) return;
    expect(resultado.pasos.map((p) => p.valor)).toEqual([
      { tipo: 'parametro', parametro: 'destinatario' },
      { tipo: 'parametro', parametro: 'asunto' },
    ]);
  });

  it('un desvio real (el MISMO dato re-escrito despues) se sigue destilando', () => {
    // La destilacion estricta no se relaja: cuando la escritura posterior teclea el MISMO dato en el
    // mismo campo, la primera quedo anulada por el desvio y solo la ultima es el camino que llego.
    const resultado = promover(
      [
        paso({ idx: 0, accion: { tipo: 'act', instruccion: `type "${DESTINATARIO}" into the Para input field`, metodo: 'fill', argumentos: [DESTINATARIO] }, estrategias: [ATRIBUTO_TO] }),
        paso({ idx: 1, accion: { tipo: 'act', instruccion: `type "${DESTINATARIO}" into the Para input field`, metodo: 'fill', argumentos: [DESTINATARIO] }, estrategias: [ATRIBUTO_TO] }),
      ],
      `Enviar un correo a ${DESTINATARIO}`,
    );
    expect(resultado.promovida).toBe(true);
    if (!resultado.promovida) return;
    expect(resultado.pasos).toHaveLength(1);
    expect(resultado.pasos[0]?.valor).toEqual({ tipo: 'parametro', parametro: 'destinatario' });
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

/**
 * LA POLITICA CONDICIONADA DEL PR 274, APLICADA AL ULTIMO ABORTO QUE LE FALTABA (30 jul 2026).
 *
 * Una ESCRITURA sin localizacion abortaba la conversion entera sin preguntar nada. Es el mismo caso
 * que ya cerraron los metodos no representables y los clicks de foco: si lo que ese paso tecleaba es
 * un dato DECLARADO del objetivo y OTRO paso conservado teclea ese mismo dato, el intento fallido no
 * le quita nada al procedimiento. Sin cobertura sigue abortando, con el motivo de siempre.
 *
 * Y LA IDENTIDAD DEL ELEMENTO POR SU LOCALIZADOR: dos pasos que comparten un nombre accesible tocaron
 * el mismo elemento, aunque no compartan selector ni descripcion. Es lo que colapsa los clicks por
 * coordenadas, y NO cambia el camino de la receta, donde los pasos llegan sin estrategias.
 */
describe('promoverTrayectoria con escrituras sin localizacion (politica condicionada)', () => {
  const ATRIBUTO_BODY: EstrategiaLocalizacion = {
    tipo: 'atributo',
    atributo: 'aria-label',
    valor: 'Cuerpo del mensaje',
  };
  const OBJETIVO_CUERPO =
    'Enviar un correo con el siguiente cuerpo del mensaje "hola que tal". La tarea termina cuando el ' +
    'correo haya sido enviado exitosamente.';

  it('el intento SIN localizacion se descarta cuando otro paso conservado teclea ese mismo dato', () => {
    const resultado = promover(
      [
        // El primer intento de escribir el cuerpo: la percepcion no alcanzo el elemento, asi que el
        // paso llega sin nada con lo que localizarlo, y ademas por coordenadas (sin instruccion).
        paso({
          idx: 0,
          accion: { tipo: 'type', instruccion: null, metodo: 'type', argumentos: ['hola que tal'] },
          estrategias: [],
          selector: null,
        }),
        // El segundo, el que si quedo: mismo dato, con localizador propio.
        paso({
          idx: 1,
          accion: {
            tipo: 'act',
            instruccion: 'type the body of the message',
            metodo: 'fill',
            argumentos: ['hola que tal'],
          },
          estrategias: [ATRIBUTO_BODY, XPATH],
          selector: '/html/body/div/form/div[1]',
        }),
      ],
      OBJETIVO_CUERPO,
    );
    expect(resultado.promovida).toBe(true);
    if (!resultado.promovida) return;
    expect(resultado.pasos.map((p) => p.accion)).toEqual(['escribir']);
    expect(resultado.pasos[0]?.valor).toEqual({ tipo: 'parametro', parametro: 'cuerpo' });
  });

  it('sin ningun paso que cubra ese dato SIGUE abortando, con el mismo motivo y su paso', () => {
    const resultado = promover(
      [
        paso({
          idx: 0,
          accion: {
            tipo: 'act',
            instruccion: 'type the body of the message',
            metodo: 'fill',
            argumentos: ['hola que tal'],
          },
          estrategias: [],
          selector: null,
        }),
      ],
      OBJETIVO_CUERPO,
    );
    expect(resultado.promovida).toBe(false);
    if (resultado.promovida) return;
    expect(resultado.motivo).toContain('sin estrategia y sin paso adyacente que cubra el campo');
    expect(resultado.regla).toBe('escritura_sin_localizacion');
    expect(resultado.paso).toBe(0);
  });

  it('un click sin instruccion ni selector se colapsa contra el campo que su localizador nombra', () => {
    const resultado = promover(
      [
        // Click POR COORDENADAS: ni instruccion ni selector; solo el nombre que la percepcion leyo.
        paso({
          idx: 0,
          accion: { tipo: 'click', instruccion: null, metodo: 'click', argumentos: [] },
          estrategias: [ATRIBUTO_BODY],
          selector: null,
        }),
        paso({
          idx: 1,
          accion: {
            tipo: 'act',
            instruccion: 'type the body of the message',
            metodo: 'fill',
            argumentos: ['hola que tal'],
          },
          estrategias: [ATRIBUTO_BODY, XPATH],
          selector: '/html/body/div/form/div[1]',
        }),
      ],
      OBJETIVO_CUERPO,
    );
    expect(resultado.promovida).toBe(true);
    if (!resultado.promovida) return;
    expect(resultado.pasos.map((p) => p.accion)).toEqual(['escribir']);
  });

  it('dos elementos DISTINTOS con el mismo TIPO de estrategia no se colapsan entre si', () => {
    // La identidad la da el NOMBRE, no la clase de estrategia: dos campos con aria-label son dos
    // campos, y el click del asunto no puede desaparecer por la escritura del cuerpo.
    const ATRIBUTO_SUBJ: EstrategiaLocalizacion = {
      tipo: 'atributo',
      atributo: 'aria-label',
      valor: 'Asunto',
    };
    const resultado = promover(
      [
        paso({
          idx: 0,
          accion: { tipo: 'click', instruccion: null, metodo: 'click', argumentos: [] },
          estrategias: [ATRIBUTO_SUBJ],
          selector: null,
        }),
        paso({
          idx: 1,
          accion: {
            tipo: 'act',
            instruccion: 'type the body of the message',
            metodo: 'fill',
            argumentos: ['hola que tal'],
          },
          estrategias: [ATRIBUTO_BODY, XPATH],
          selector: '/html/body/div/form/div[1]',
        }),
      ],
      OBJETIVO_CUERPO,
    );
    expect(resultado.promovida).toBe(true);
    if (!resultado.promovida) return;
    expect(resultado.pasos.map((p) => p.accion)).toEqual(['click', 'escribir']);
  });
});

// -------------------------------------------------------------------------------------------------

/**
 * PASOS SINTETICOS FALLIDOS: los que el SISTEMA escribe en la traza para dejar constancia de una
 * accion que NUNCA LLEGO AL NAVEGADOR (caso real de produccion del 31 jul 2026 01:02 UTC, ver el
 * bloque de la corrida real en plantillas-motor-libre.test.ts).
 *
 * Los pasos se construyen con las MISMAS funciones que corren en produccion -- no con literales
 * copiados aqui -- para que un cambio de tipo o de `exito` en cualquiera de las dos familias rompa
 * este test en vez de reabrir el rechazo en silencio.
 */
describe('promoverTrayectoria con pasos sinteticos fallidos (la accion no llego al navegador)', () => {
  const OBJETIVO = 'envia el correo a martin@x.com';

  /** El paso que la conversion tiene que conservar para que quede procedimiento que armar. */
  const clickUtil = (idx: number): PasoCensurado =>
    paso({ idx, accion: { tipo: 'act', instruccion: 'click the Send button', metodo: 'click', argumentos: [] } });

  const enTrayectoria = (sintetico: PasoCensurado, idx: number): PasoCensurado => ({
    ...sintetico,
    idx,
    url: `https://${DOMINIO}/inbox`,
  });

  it('el RECHAZO DE LA GUARDIA por control de ventana se descarta y la conversion sigue', () => {
    // El paso EXACTO del idx 12 de la corrida del 31 jul: la guardia no dejo salir el click sobre
    // "Pantalla completa" y la corrida siguio hasta enviar el correo.
    const rechazo = construirPasoDeBloqueo(
      'guardia: la accion NO se ejecuto (control de ventana fuera del alcance de la tarea: pantalla completa): click button Pantalla completa',
    );
    expect(rechazo.exito).toBe(false);
    const resultado = promover([clickUtil(0), enTrayectoria(rechazo, 1), clickUtil(2)], OBJETIVO);
    expect(resultado.promovida).toBe(true);
    if (!resultado.promovida) return;
    // Ni un paso 'verificar' de mas: el rechazo no aporta nada al procedimiento.
    expect(resultado.pasos.map((p) => p.accion)).toEqual(['click', 'click']);
  });

  it('los OTROS rechazos de la guardia se descartan por la MISMA regla, no caso por caso', () => {
    // Los cinco motivos restantes con los que la guardia registra un rechazo (tarea-web.ts): el cupo
    // de accion irreversible ya consumido y el fallo al leer la politica llegan con el motivo CRUDO
    // del contrato de detencion, que es lo que compone bloquearRegistrando. Ninguno ejecuto nada, y
    // la conversion no puede ni debe distinguirlos del de arriba.
    for (const motivo of [
      'cancelada desde la consola',
      'reintento irreversible ya agotado',
      'efecto probable: el formulario verificado ya no esta en la pagina',
      'otraAccion',
      'politicaNoDisponible',
    ]) {
      const rechazo = construirPasoDeBloqueo(`guardia: la accion NO se ejecuto (${motivo}): click button Enviar`);
      const resultado = promover([clickUtil(0), enTrayectoria(rechazo, 1)], OBJETIVO);
      expect(resultado.promovida, motivo).toBe(true);
    }
  });

  it('la VERIFICACION que detuvo o encontro incompleta la accion se descarta', () => {
    // Las dos formas en que el paso de la verificacion determinista queda con exito false. La
    // 'incompleto' es la que aparece en corridas que TERMINAN BIEN: el agente completa lo que
    // faltaba y sigue.
    const fallidos: Veredicto[] = [
      { tipo: 'incompleto', comparaciones: [], faltantes: ['cuerpo'] },
      { tipo: 'detener', detencion: { motivo: 'noCoincide' }, comparaciones: [] },
    ];
    for (const veredicto of fallidos) {
      const sintetico = construirPasoDeVerificacion(veredicto);
      expect(sintetico.exito, veredicto.tipo).toBe(false);
      const resultado = promover([clickUtil(0), enTrayectoria(sintetico, 1)], OBJETIVO);
      expect(resultado.promovida, veredicto.tipo).toBe(true);
      if (!resultado.promovida) return;
      expect(resultado.pasos.map((p) => p.accion), veredicto.tipo).toEqual(['click']);
    }
  });

  it('la VERIFICACION que autorizo la accion sigue promoviendose como paso verificar', () => {
    // El contrato de D7 no cambia: el unico paso de verificacion que la receta aprende es el que
    // COMPARO y dejo pasar. Un exigeVerificacion sobre una traza cuya unica verificacion fallo NO se
    // da por satisfecho, que es lo correcto: ahi no se verifico nada.
    const autorizada = construirPasoDeVerificacion({ tipo: 'ejecutar', comparaciones: [] });
    expect(autorizada.exito).toBe(true);
    const conAutorizacion = promover([enTrayectoria(autorizada, 0), clickUtil(1)], OBJETIVO, 'exitosa', true);
    expect(conAutorizacion.promovida).toBe(true);
    if (!conAutorizacion.promovida) return;
    expect(conAutorizacion.pasos.map((p) => p.accion)).toEqual(['verificar', 'click']);

    const detenida = construirPasoDeVerificacion({
      tipo: 'detener',
      detencion: { motivo: 'noCoincide' },
      comparaciones: [],
    });
    const soloFallida = promover([enTrayectoria(detenida, 0), clickUtil(1)], OBJETIVO, 'exitosa', true);
    expect(soloFallida.promovida).toBe(false);
    if (soloFallida.promovida) return;
    expect(soloFallida.regla).toBe('sin_verificacion_de_accion_irreversible');
  });

  it('el BLOQUEO de la barrera de identidad se descarta, y sus otros tres veredictos no fallan', () => {
    // La etiqueta y el `exito` los resuelve resumenDeIdentidad, que es la fuente compartida por el
    // camino de recetas y el del motor libre: el unico veredicto con exito false es el bloqueo
    // EFECTIVO (modo activa), y ese es el que la accion no llego a ejecutar.
    const veredictos = [
      { resultado: { tipo: 'bloquear', motivo: 'clase_no_corroborada' }, modo: 'activa' },
      { resultado: { tipo: 'bloquear', motivo: 'clase_no_corroborada' }, modo: 'observacion' },
      { resultado: { tipo: 'permitir' }, modo: 'activa' },
      { resultado: { tipo: 'no_evaluable' }, modo: 'activa' },
    ] as const;
    for (const { resultado, modo } of veredictos) {
      const { etiqueta, exito } = resumenDeIdentidad(resultado, modo);
      expect(etiqueta.startsWith('identidad:'), etiqueta).toBe(true);
      const sintetico = paso({
        idx: 1,
        accion: { tipo: etiqueta, instruccion: 'barrera de identidad sobre la accion del motor', metodo: null, argumentos: [] },
        estrategias: [],
        selector: null,
        exito,
      });
      const promocion = promover([clickUtil(0), sintetico], OBJETIVO);
      expect(promocion.promovida, etiqueta).toBe(true);
      if (!promocion.promovida) return;
      expect(promocion.pasos.map((p) => p.accion), etiqueta).toEqual(['click']);
    }
  });

  it('una accion del MOTOR que SI llego al navegador y fallo sigue abortando la conversion', () => {
    // El otro lado de la regla, y el que no se puede aflojar: un act, un click, una navegacion o un
    // llenado que el navegador RECIBIO y que fallo es un fallo real del procedimiento, y una
    // plantilla que lo omitiera haria una tarea distinta de la aprendida.
    for (const tipo of ['act', 'click', 'goto', 'fillForm', 'fillFormVision']) {
      const resultado = promover(
        [clickUtil(0), paso({ idx: 1, accion: { tipo, instruccion: 'click button Enviar', metodo: 'click', argumentos: [] }, exito: false })],
        OBJETIVO,
      );
      expect(resultado.promovida, tipo).toBe(false);
      if (resultado.promovida) return;
      expect(resultado.regla, tipo).toBe('paso_fallido');
      expect(resultado.paso, tipo).toBe(1);
    }
  });
});
