import { describe, it, expect } from 'vitest';
import { formatTreeLine } from '@browserbasehq/stagehand/lib/v3/understudy/a11y/snapshot/treeFormatUtils.js';
import type { A11yNode } from '@browserbasehq/stagehand/lib/v3/types/private/snapshot.js';
import {
  comprobarFormateador,
  verificarParcheStagehand,
  ParcheStagehandAusenteError,
  type FormateadorDeArbol,
} from '../src/parche-stagehand.js';

/**
 * PARCHE de @browserbasehq/stagehand (patches/@browserbasehq+stagehand+3.6.0.patch), aplicado por
 * patch-package desde el script `parche` de este workspace, encadenado en su `build` y en su `dev`.
 *
 * Estos tests corren contra el archivo REAL de node_modules, no contra una copia: si el parche no se
 * aplico (build saltado, patches/ borrado, upgrade de version que lo deja fuera de sitio), fallan y
 * CI lo detiene. Es la unica forma de vigilar un parche de dependencia.
 *
 * CAUSA que ataca el parche: `formatTreeLine` rotulaba cada linea con `node.encodedId ?? node.nodeId`
 * y, con `encodedId` undefined, el modelo veia `[5662]` en vez de `[0-5662]`. El esquema de `act`
 * (lib/inference.js) exige /^\d+-\d+$/ en `elementId`, asi que rechazaba la respuesta con
 * NoObjectGeneratedError SIEMPRE que el modelo eligiera ese nodo. El modelo no se equivocaba:
 * copiaba lo que el arbol le mostraba.
 */
const PATRON_DEL_ESQUEMA_DE_ACT = /^\d+-\d+$/;

/** Los ids que el arbol formateado le ofrece al modelo, uno por linea rotulada. */
function idsDelArbol(arbol: string): string[] {
  return arbol
    .split('\n')
    .map((linea) => /^\s*\[([^\]]+)]/.exec(linea)?.[1])
    .filter((id): id is string => id !== undefined);
}

/** Nodo AX, con el tipo REAL de Stagehand: si la forma del arbol cambia, este archivo no compila. */
function nodo(node: A11yNode): A11yNode {
  return node;
}

describe('parche de treeFormatUtils: el modelo solo ve identificadores validos', () => {
  it('un nodo SIN encodedId no aparece en el arbol formateado', () => {
    const arbol = formatTreeLine(nodo({ nodeId: '5662', role: 'generic', children: [] }));
    expect(arbol).toBe('');
    expect(arbol).not.toContain('5662');
  });

  it('un nodo con encodedId MALFORMADO (sin el prefijo de frame) tampoco aparece', () => {
    const arbol = formatTreeLine(
      nodo({ encodedId: '5662', nodeId: '5662', role: 'button', name: 'Enviar', children: [] }),
    );
    expect(arbol).toBe('');
  });

  it('los hijos VALIDOS de un nodo omitido se conservan y toman su lugar', () => {
    const arbol = formatTreeLine(
      nodo({
        encodedId: '0-1',
        nodeId: '1',
        role: 'RootWebArea',
        name: 'Bandeja',
        children: [
          nodo({
            nodeId: '5662',
            role: 'generic',
            children: [
              nodo({ encodedId: '0-5663', nodeId: '5663', role: 'button', name: 'Enviar' }),
            ],
          }),
        ],
      }),
    );

    // El nodo sin id valido desaparece; su hijo sube al nivel que ocupaba el padre omitido.
    expect(arbol).toBe('[0-1] RootWebArea: Bandeja\n  [0-5663] button: Enviar');
    for (const id of idsDelArbol(arbol)) {
      expect(id).toMatch(PATRON_DEL_ESQUEMA_DE_ACT);
    }
  });

  it('TODO id que el arbol ofrece cumple el patron que exige el esquema de act', () => {
    const arbol = formatTreeLine(
      nodo({
        encodedId: '0-1',
        nodeId: '1',
        role: 'RootWebArea',
        children: [
          nodo({ nodeId: '5662', role: 'generic' }),
          nodo({ encodedId: 'abc', nodeId: '77', role: 'link', name: 'Ayuda' }),
          nodo({ encodedId: '12-340', nodeId: '340', role: 'textbox', name: 'Para' }),
        ],
      }),
    );

    const ids = idsDelArbol(arbol);
    expect(ids).toEqual(['0-1', '12-340']);
    for (const id of ids) expect(id).toMatch(PATRON_DEL_ESQUEMA_DE_ACT);
  });

  it('con todos los nodos validos, el arbol es exactamente el de siempre (indentacion incluida)', () => {
    const arbol = formatTreeLine(
      nodo({
        encodedId: '0-1',
        nodeId: '1',
        role: 'RootWebArea',
        name: 'Bandeja',
        children: [
          nodo({
            encodedId: '0-2',
            nodeId: '2',
            role: 'navigation',
            children: [nodo({ encodedId: '0-3', nodeId: '3', role: 'button', name: 'Redactar' })],
          }),
        ],
      }),
    );

    expect(arbol).toBe(
      ['[0-1] RootWebArea: Bandeja', '  [0-2] navigation', '    [0-3] button: Redactar'].join('\n'),
    );
  });
});

/**
 * El formateador TAL CUAL viene en Stagehand 3.6.0 sin parchear (copiado de
 * dist/esm/.../treeFormatUtils.js). Es el unico modo de probar el camino negativo de la verificacion
 * de arranque sin desparchear node_modules a media suite.
 */
const formateadorSinParche: FormateadorDeArbol = function sinParche(node, level = 0): string {
  const indent = '  '.repeat(level);
  const labelId = node.encodedId ?? node.nodeId;
  const label = `[${labelId}] ${node.role}${node.name ? `: ${node.name}` : ''}`;
  const kids = node.children?.map((c) => sinParche(c, level + 1)).join('\n') ?? '';
  return kids ? `${indent}${label}\n${kids}` : `${indent}${label}`;
};

describe('verificacion de arranque: el worker no arranca sin el parche', () => {
  it('con el formateador SIN parchear, la verificacion lanza y dice que identificador sobra', () => {
    expect(() => comprobarFormateador(formateadorSinParche)).toThrow(ParcheStagehandAusenteError);
    expect(() => comprobarFormateador(formateadorSinParche)).toThrow(/"5662"/);
  });

  it('el motivo del fallo dice como aplicar el parche', () => {
    expect(() => comprobarFormateador(formateadorSinParche)).toThrow(
      /npm run parche -w apps\/worker/,
    );
  });

  it('un formateador que se come los hijos validos tampoco pasa', () => {
    expect(() => comprobarFormateador(() => '')).toThrow(/"0-5663"/);
  });

  it('con el formateador REAL de node_modules (parcheado), la verificacion pasa', () => {
    expect(() => comprobarFormateador(formatTreeLine)).not.toThrow();
  });

  it('verificarParcheStagehand carga el modulo real y no lanza', async () => {
    await expect(verificarParcheStagehand()).resolves.toBeUndefined();
  });
});
