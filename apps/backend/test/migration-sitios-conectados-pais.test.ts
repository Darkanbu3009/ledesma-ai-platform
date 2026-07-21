import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// Contrato ESTATICO de la migracion V028 (pinning por pais), mismo enfoque que
// migration-sitios-conectados.test.ts: sin runner ni DB en CI, se verifica que la migracion agregue
// proxy_country/proxy_state de forma aditiva, idempotente y reversible, con el CHECK de formato
// ISO-2, y que documente la reversion. El comportamiento runtime (repositorio y handlers del worker)
// se cubre con mocks aparte.
const sql = readFileSync(
  new URL('../migrations/V028__sitios_conectados_pais.sql', import.meta.url),
  'utf8',
)
  .toLowerCase()
  .replace(/\s+/g, ' ');

describe('migracion V028 (sitios_conectados: pinning por pais)', () => {
  it('agrega proxy_country y proxy_state de forma ADITIVA e idempotente', () => {
    expect(sql).toContain('alter table sitios_conectados add column if not exists proxy_country text');
    expect(sql).toContain('alter table sitios_conectados add column if not exists proxy_state text');
  });

  it('impone el formato ISO 3166-1 alpha-2 en mayusculas via CHECK (null permitido en filas legadas)', () => {
    expect(sql).toContain('drop constraint if exists sitios_conectados_proxy_country_ck');
    expect(sql).toContain(
      "check (proxy_country is null or proxy_country ~ '^[a-z]{2}$')",
    );
  });

  it('NO toca egress_ip (queda como referencia informativa) ni ninguna otra tabla', () => {
    expect(sql).not.toContain('drop column if exists egress_ip');
    expect(sql).not.toMatch(/alter table (?!sitios_conectados)/);
    expect(sql).not.toContain('create table');
  });

  it('documenta la decision de arquitectura (criterio por PAIS) y la reversion limpia', () => {
    // El criterio de pinning es el pais (rotacion de IP dentro del pais es normal), y banca migrara
    // a proxies sticky dedicados en el futuro.
    expect(sql).toContain('pais');
    expect(sql).toContain('sticky');
    expect(sql).toContain('drop column if exists proxy_country');
    expect(sql).toContain('drop column if exists proxy_state');
  });
});
