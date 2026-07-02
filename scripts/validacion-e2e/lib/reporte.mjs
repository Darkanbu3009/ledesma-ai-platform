import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Registro de resultados PASS/FAIL/SKIP/INFO por fase, con evidencia SIEMPRE redactada (el
 * redactor se inyecta al crear el reporte). Al final se vuelca a JSON + una tabla markdown que
 * sirve de insumo para el informe en docs/.
 */
export function crearReporte(redactar) {
  const checks = [];

  function anotar(estado, fase, prueba, evidencia) {
    const entrada = {
      fase,
      prueba,
      estado,
      evidencia: redactar(typeof evidencia === 'string' ? evidencia : JSON.stringify(evidencia ?? '')).slice(0, 800),
      hora: new Date().toISOString(),
    };
    checks.push(entrada);
    const icono = { PASS: 'PASS', FAIL: 'FAIL', SKIP: 'SKIP', INFO: 'INFO' }[estado];
    console.log(`  [${icono}] ${fase} :: ${prueba}${entrada.evidencia ? ` :: ${entrada.evidencia.slice(0, 200)}` : ''}`);
  }

  return {
    pass: (fase, prueba, evidencia) => anotar('PASS', fase, prueba, evidencia),
    fail: (fase, prueba, evidencia) => anotar('FAIL', fase, prueba, evidencia),
    skip: (fase, prueba, evidencia) => anotar('SKIP', fase, prueba, evidencia),
    info: (fase, prueba, evidencia) => anotar('INFO', fase, prueba, evidencia),
    checks,
    hayFallas: () => checks.some((c) => c.estado === 'FAIL'),

    guardar(dirSalida, contexto) {
      mkdirSync(dirSalida, { recursive: true });
      const marca = new Date().toISOString().replace(/[:.]/g, '-');
      const rutaJson = resolve(dirSalida, `resultados-${marca}.json`);
      writeFileSync(
        rutaJson,
        redactar(JSON.stringify({ generado: new Date().toISOString(), contexto, checks }, null, 2)),
      );
      const rutaMd = resolve(dirSalida, `resultados-${marca}.md`);
      writeFileSync(rutaMd, this.renderMarkdown());
      return { rutaJson, rutaMd };
    },

    renderMarkdown() {
      const lineas = [
        '| Fase | Prueba | Resultado | Evidencia |',
        '| --- | --- | --- | --- |',
      ];
      for (const c of checks) {
        const evidencia = c.evidencia.replace(/\|/g, '\\|').replace(/\n/g, ' ');
        lineas.push(`| ${c.fase} | ${c.prueba} | ${c.estado} | ${evidencia} |`);
      }
      const totales = ['PASS', 'FAIL', 'SKIP', 'INFO']
        .map((e) => `${e}: ${checks.filter((c) => c.estado === e).length}`)
        .join(' / ');
      return `${lineas.join('\n')}\n\nTotales: ${totales}\n`;
    },
  };
}
