import type { A11yNode } from '@browserbasehq/stagehand/lib/v3/types/private/snapshot.js';

/**
 * VERIFICACION DE ARRANQUE del parche de Stagehand (`patches/@browserbasehq+stagehand+3.6.0.patch`).
 *
 * El parche lo aplica `patch-package` desde el script `parche` de ESTE workspace, encadenado en su
 * `build` y en su `dev` (`apps/worker/package.json`). Ya NO cuelga del `postinstall` de la raiz: ese
 * `postinstall` tambien corria en el build de la consola en Vercel, que no usa Stagehand para nada.
 *
 * El problema de mover el parche a un script es que un script se puede saltar: un `npm ci` que no
 * construye, un despliegue que copia `dist/` sin re-parchear, un `node_modules` reinstalado despues
 * del build. Y un worker SIN parche no se rompe de forma visible: navega igual y falla mas tarde,
 * de forma determinista, con `NoObjectGeneratedError` en la tarea web. Eso es exactamente lo que ya
 * paso una vez. Por eso el arranque comprueba el parche y, si no esta, el worker NO arranca.
 *
 * Lo que se comprueba es el COMPORTAMIENTO del `formatTreeLine` real de `node_modules`, no la
 * presencia de un comentario: un nodo cuyo `encodedId` no cumpla el patron que exige el esquema de
 * `act` (`/^\d+-\d+$/`) no debe rotularse, y sus hijos validos deben conservarse.
 */
const MODULO_FORMATO_ARBOL =
  '@browserbasehq/stagehand/lib/v3/understudy/a11y/snapshot/treeFormatUtils.js';

/** El patron que el esquema de `act` de Stagehand (`lib/inference.js`) exige en `elementId`. */
const PATRON_ID_DEL_ESQUEMA = /^\d+-\d+$/;

/** Como se aplica el parche a mano cuando la verificacion falla. */
const COMO_APLICARLO = 'npm run parche -w apps/worker';

export type FormateadorDeArbol = (node: A11yNode, level?: number) => string;

export class ParcheStagehandAusenteError extends Error {
  constructor(motivo: string) {
    super(
      `${motivo}\n` +
        `Parche esperado: patches/@browserbasehq+stagehand+3.6.0.patch sobre ${MODULO_FORMATO_ARBOL}.\n` +
        `Sin el, el arbol de accesibilidad le ofrece al modelo identificadores que el esquema de ` +
        `act rechaza y la tarea web falla de forma determinista.\n` +
        `Aplicarlo con: ${COMO_APLICARLO}`,
    );
    this.name = 'ParcheStagehandAusenteError';
  }
}

/** Los ids que el arbol formateado le ofrece al modelo, uno por linea rotulada. */
function idsRotulados(arbol: string): string[] {
  return arbol
    .split('\n')
    .map((linea) => /^\s*\[([^\]]+)]/.exec(linea)?.[1])
    .filter((id): id is string => id !== undefined);
}

/**
 * Corre el formateador contra un arbol de prueba y lanza si el parche no esta aplicado. Recibe el
 * formateador INYECTADO para que los tests puedan pasarle tambien la version sin parchear.
 */
export function comprobarFormateador(formatTreeLine: FormateadorDeArbol): void {
  // Nodo sin encodedId (el caso real: Stagehand solo lo calcula para los nodos AX con
  // backendDOMNodeId numerico) con un hijo cuyo id SI es valido.
  const arbol = formatTreeLine({
    encodedId: '0-1',
    nodeId: '1',
    role: 'RootWebArea',
    children: [
      {
        nodeId: '5662',
        role: 'generic',
        children: [{ encodedId: '0-5663', nodeId: '5663', role: 'button', name: 'Enviar' }],
      },
    ],
  });

  const ids = idsRotulados(arbol);
  const malformados = ids.filter((id) => !PATRON_ID_DEL_ESQUEMA.test(id));
  if (malformados.length > 0) {
    throw new ParcheStagehandAusenteError(
      `El arbol de accesibilidad de Stagehand sigue rotulando identificadores que el esquema de ` +
        `act rechaza: ${malformados.map((id) => `"${id}"`).join(', ')}.`,
    );
  }

  // El parche omite el nodo invalido, NO su subarbol: si tambien se perdieran los hijos validos, el
  // modelo se quedaria sin elementos con los que trabajar y la tarea web fallaria por otro lado.
  if (!ids.includes('0-5663')) {
    throw new ParcheStagehandAusenteError(
      'El arbol de accesibilidad de Stagehand descarta los hijos validos de un nodo omitido: ' +
        `se esperaba el identificador "0-5663" y el arbol ofrece [${ids.join(', ')}].`,
    );
  }
}

/**
 * Carga el `formatTreeLine` REAL de `node_modules` y lo comprueba. Import dinamico a proposito: si
 * una subida de version mueve el archivo, el fallo se reporta con el mismo mensaje accionable en vez
 * de romper la carga del entrypoint con un error de resolucion de modulo.
 */
export async function verificarParcheStagehand(): Promise<void> {
  let formatTreeLine: FormateadorDeArbol;
  try {
    ({ formatTreeLine } = await import(MODULO_FORMATO_ARBOL));
  } catch (err) {
    throw new ParcheStagehandAusenteError(
      `No se pudo cargar ${MODULO_FORMATO_ARBOL} de node_modules: ` +
        `${err instanceof Error ? err.message : String(err)}.`,
    );
  }
  comprobarFormateador(formatTreeLine);
}
