/**
 * TAREAS QUE EL SISTEMA YA SABE HACER, en la consola. Espeja la forma camelCase de
 * /v1/tareas-ensenadas (apps/backend/src/routes/tareas-ensenadas.ts). Sin React ni red: aqui viven
 * las derivaciones que la pagina usa, y se testean como funciones puras (igual que grabaciones.ts).
 *
 * NO ES /recetas. Esa pantalla es otra funcionalidad (cadenas de instrucciones para un agente
 * conversacional, tabla `recipes`), con sus propios datos y sus propias rutas. Esta lista es lo que
 * el usuario le enseno haciendolo el mismo, mas lo que el sistema aprendio solo de una vez que salio
 * bien.
 *
 * VOCABULARIO: en esta pantalla NO se nombra nada tecnico. El usuario final no sabe -- ni tiene por
 * que -- que hay debajo. Se habla de "tareas que ya sabe hacer" y de "datos que le tienes que dar".
 */

import { currentLanguage } from '../i18n';

/** Los tipos de dato que una tarea puede necesitar. Los mismos seis de la grabacion. */
export type TipoDeDato = 'destinatario' | 'asunto' | 'cuerpo' | 'monto' | 'producto' | 'cantidad';

/** Una tarea ya ensenada, tal como la devuelve GET /v1/tareas-ensenadas. */
export interface TareaEnsenada {
  id: string;
  /** El sitio donde la sabe hacer. */
  dominio: string;
  /**
   * Lo que el usuario escribio al ensenarla. null en las que el sistema aprendio solo: ahi la
   * pantalla pone su propia frase, en vez de mostrar un texto interno.
   */
  descripcion: string | null;
  ensenadaEn: string;
  usos: number;
  ultimoUsoEn: string | null;
  /**
   * Cuantas veces se ajusto sola (cuando el sitio cambio, aprendio a encontrar sus botones de otra
   * forma). Opcional para tolerar un backend anterior a este campo: ausente cuenta como 0.
   */
  ajustes?: number;
  datosQueNecesita: TipoDeDato[];
}

/**
 * Agrupa las tareas POR SITIO, conservando el orden en que llegaron (de la mas reciente a la mas
 * vieja) tanto entre sitios como dentro de cada uno. Es como se muestran: primero el sitio, y debajo
 * lo que sabe hacer alli.
 */
export function agruparPorSitio(
  tareas: readonly TareaEnsenada[],
): Array<{ dominio: string; tareas: TareaEnsenada[] }> {
  const grupos: Array<{ dominio: string; tareas: TareaEnsenada[] }> = [];
  for (const tarea of tareas) {
    const grupo = grupos.find((candidato) => candidato.dominio === tarea.dominio);
    if (grupo === undefined) grupos.push({ dominio: tarea.dominio, tareas: [tarea] });
    else grupo.tareas.push(tarea);
  }
  return grupos;
}

/** Fecha corta en el idioma de la consola (mismo criterio que el resto de las pantallas). */
export function formatearFecha(iso: string): string {
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return iso;
  return fecha.toLocaleDateString(currentLanguage() === 'en' ? 'en' : 'es-MX', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}
