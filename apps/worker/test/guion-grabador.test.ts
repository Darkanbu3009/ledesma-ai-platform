import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  EXPRESION_HAY_CAMPO_DE_CONTRASENA,
  SELECTOR_CAMPO_CONTRASENA,
} from '../src/contrasena.js';
import {
  ENLACE_DE_GRABACION,
  GUION_GRABADOR,
  MUNDO_DE_GRABACION,
} from '../src/guion-grabador.js';

/**
 * EL GUION QUE GRABA es texto que corre DENTRO de la pagina, asi que no se puede ejecutar aqui sin un
 * navegador. Lo que si se puede -- y es lo que importa -- es fijar sus INVARIANTES como propiedades del
 * texto que se inyecta, para que no puedan desaparecer en una edicion futura:
 *
 *  1. usa la MISMA deteccion de campo de contrasena que el pre-chequeo determinista de la tarea web;
 *  2. comprueba esa guardia ANTES de cada evento y tambien de forma periodica;
 *  3. nunca lee el valor de un campo de contrasena;
 *  4. escucha en FASE DE CAPTURA (un sitio que detiene la propagacion no puede esconder la accion);
 *  5. reusa los MISMOS ayudantes de DOM que la ejecucion determinista (misma forma de describir los
 *     elementos que despues los localiza).
 */

describe('el detector de campo de contrasena es uno solo', () => {
  it('el pre-chequeo de la tarea web y la guardia de la grabacion usan la misma expresion', () => {
    const browserbase = readFileSync(new URL('../src/browserbase.ts', import.meta.url), 'utf8');
    // El adaptador ya no lleva la comprobacion escrita a mano: la importa del modulo compartido.
    expect(browserbase).toContain('EXPRESION_HAY_CAMPO_DE_CONTRASENA');
    expect(browserbase).not.toContain("!!document.querySelector('input[type=password]')");
    expect(GUION_GRABADOR).toContain(EXPRESION_HAY_CAMPO_DE_CONTRASENA);
  });

  it('el selector es el tipo del campo, no una heuristica de texto', () => {
    expect(SELECTOR_CAMPO_CONTRASENA).toBe('input[type=password]');
  });
});

describe('GUION_GRABADOR', () => {
  it('emite el corte por contrasena y se apaga (deja de escuchar)', () => {
    expect(GUION_GRABADOR).toContain("emitir({ tipo: 'contrasena' })");
    expect(GUION_GRABADOR).toContain('apagado = true');
    // La guardia se consulta al entrar en cada escucha.
    expect(GUION_GRABADOR.match(/if \(guardia\(\)\) return;/g)?.length).toBeGreaterThanOrEqual(3);
    // Y ademas de forma periodica, para la pantalla de login que aparece sin que el usuario toque nada.
    expect(GUION_GRABADOR).toContain('setInterval');
  });

  it('NUNCA lee el valor de un campo de contrasena', () => {
    expect(GUION_GRABADOR).toContain("if (tipo === 'password') return null;");
    expect(GUION_GRABADOR).toContain(`el.matches('${SELECTOR_CAMPO_CONTRASENA}')`);
  });

  it('escucha escritura, clic, cierre de campo y tecla en FASE DE CAPTURA', () => {
    for (const evento of ['input', 'click', 'change', 'focusout', 'keydown']) {
      expect(GUION_GRABADOR).toContain(`addEventListener('${evento}'`);
    }
    // El tercer argumento `true` de addEventListener es la fase de captura: los cinco escuchas.
    expect(GUION_GRABADOR.match(/, true\);/g)?.length).toBe(5);
  });

  it('al pulsar una tecla emite PRIMERO el valor del campo y despues la tecla', () => {
    const posicionEscritura = GUION_GRABADOR.indexOf('volcar();\n    emitir({');
    const posicionTecla = GUION_GRABADOR.indexOf("tipo: 'tecla'");
    expect(posicionEscritura).toBeGreaterThan(-1);
    expect(posicionEscritura).toBeLessThan(posicionTecla);
  });

  it('anota lo tecleado mientras se escribe, para que sobreviva a que el sitio vacie el campo', () => {
    // El valor NO se lee al cerrar el campo (para entonces el sitio ya lo reemplazo por una
    // etiqueta): se anota en cada pulsacion y se emite al confirmar.
    expect(GUION_GRABADOR).toContain('let pendiente = null;');
    expect(GUION_GRABADOR).toContain('function anotar(el)');
    expect(GUION_GRABADOR).toContain('function volcar()');
  });

  it('lee tambien los campos que no son input: contenteditable y rol de campo', () => {
    expect(GUION_GRABADOR).toContain('el.isContentEditable === true');
    expect(GUION_GRABADOR).toContain('["combobox","textbox","searchbox"]');
    expect(GUION_GRABADOR).toContain('ROLES_EDITABLES.indexOf(rolDe(el))');
  });

  it('describe los elementos con los MISMOS ayudantes que la ejecucion determinista', () => {
    for (const ayudante of ['function rolDe(', 'function nombreDe(', 'function xpathDe(', 'estrategiasDe(']) {
      expect(GUION_GRABADOR).toContain(ayudante);
    }
  });

  it('es idempotente: instalarlo dos veces en el mismo documento no duplica escuchas', () => {
    expect(GUION_GRABADOR).toContain('if (window.__ledesmaGrabadorInstalado) return;');
  });

  it('solo graba teclas NO imprimibles (el texto libre va como escritura)', () => {
    expect(GUION_GRABADOR).toContain('["Enter","Tab","Escape"]');
  });

  it('el canal hacia el worker vive en un mundo aislado con nombre propio', () => {
    expect(MUNDO_DE_GRABACION).toBe('ledesma-grabacion');
    expect(ENLACE_DE_GRABACION).toBe('__ledesmaGrabacion');
    expect(GUION_GRABADOR).toContain(`${ENLACE_DE_GRABACION}(JSON.stringify(dato))`);
  });

  it('ningun fallo propio del guion se propaga a la pagina del usuario', () => {
    expect(GUION_GRABADOR).toContain('catch (e)');
  });
});
