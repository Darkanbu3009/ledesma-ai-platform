import { describe, it, expect, vi } from 'vitest';
import { SitiosConectadosRepository } from '../src/sitios/sitios-conectados-repository.js';
import { encryptToToken, decryptFromToken } from '../src/crypto/aes-gcm.js';
import type { Sql } from '../src/db/client.js';

const SITIO_ID = '99999999-9999-4999-8999-999999999999';
const VAULT_SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const OTRO_SECRET = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';

// Un contexto de sesion realista: cookies de un TERCERO. Es el dato que JAMAS puede persistirse ni
// loguearse en claro (vale lo mismo que la contrasena que se evito guardar).
const CONTEXTO_PLANO = JSON.stringify({
  cookies: [{ name: 'session', value: 'super-secreta-cookie-de-sesion-del-usuario', domain: 'app.ejemplo.com' }],
  localStorage: { token: 'jwt-de-la-sesion-del-usuario' },
});

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: SITIO_ID,
    owner_id: 'user-1',
    dominio: 'app.ejemplo.com',
    url_login: 'https://app.ejemplo.com/login',
    contexto_externo_id: null,
    proxy_ref: 'proxy-sticky-7',
    egress_ip: null,
    fingerprint_ref: null,
    estado: 'esperando_login',
    tiene_contexto: false,
    creado_en: '2026-07-16T00:00:00.000Z',
    ultimo_uso_en: null,
    expira_en: null,
    ...overrides,
  };
}

/** Mock del tagged template `sql`: devuelve el resultado preprogramado. */
function makeSqlReturning(result: unknown[]): Sql {
  return vi.fn(async () => result) as unknown as Sql;
}

/**
 * Mock que IMPLEMENTA el aislamiento por owner: devuelve la fila solo si ALGUN parametro de la query
 * es el owner almacenado. Reproduce el efecto del where owner_id sin DB.
 */
function makeOwnerScopedSql(storedOwner: string, row: Record<string, unknown>): Sql {
  return vi.fn(async (_strings: TemplateStringsArray, ...values: unknown[]) =>
    values.includes(storedOwner) ? [row] : [],
  ) as unknown as Sql;
}

function sqlText(sql: Sql): string {
  const calls = (sql as unknown as { mock: { calls: Array<[readonly string[], ...unknown[]]> } }).mock.calls;
  return (calls[0]?.[0] ?? []).join('<param>').replace(/\s+/g, ' ');
}

function sqlValues(sql: Sql): unknown[] {
  const calls = (sql as unknown as { mock: { calls: Array<[readonly string[], ...unknown[]]> } }).mock.calls;
  const [, ...values] = (calls[0] ?? [[]]) as [readonly string[], ...unknown[]];
  return values;
}

describe('SitiosConectadosRepository', () => {
  describe('crear', () => {
    it('inserta con columnas explicitas, nace en esperando_login y mapea snake -> camel', async () => {
      const sql = makeSqlReturning([makeRow()]);
      const sitio = await new SitiosConectadosRepository(sql).crear({
        ownerId: 'user-1',
        dominio: 'app.ejemplo.com',
        urlLogin: 'https://app.ejemplo.com/login',
        proxyRef: 'proxy-sticky-7',
      });
      expect(sitio).toMatchObject({
        id: SITIO_ID,
        ownerId: 'user-1',
        dominio: 'app.ejemplo.com',
        urlLogin: 'https://app.ejemplo.com/login',
        proxyRef: 'proxy-sticky-7',
        estado: 'esperando_login',
        tieneContexto: false,
      });
      // El INSERT fija el estado inicial literal y jamas recibe un contexto: el contexto llega
      // despues (guardarContexto), ya confirmado el login manual.
      expect(sqlText(sql)).toContain("'esperando_login'");
      expect(sqlText(sql)).not.toContain('contexto_cifrado =');
    });

    it('NO acepta ni envia ningun campo de contrasena', async () => {
      const sql = makeSqlReturning([makeRow()]);
      await new SitiosConectadosRepository(sql).crear({ ownerId: 'user-1', dominio: 'app.ejemplo.com' });
      const serializado = JSON.stringify({ text: sqlText(sql), values: sqlValues(sql) }).toLowerCase();
      expect(serializado).not.toContain('password');
      expect(serializado).not.toContain('contrasena');
    });
  });

  describe('metadata sin blobs', () => {
    it('listarPorOwner selecciona solo metadata: el blob viaja como booleano derivado, nunca crudo', async () => {
      const sql = makeSqlReturning([makeRow({ tiene_contexto: true, estado: 'activo' })]);
      const sitios = await new SitiosConectadosRepository(sql).listarPorOwner('user-1');
      expect(sitios).toHaveLength(1);
      expect(sitios[0]).toMatchObject({ estado: 'activo', tieneContexto: true });
      // Ninguna clave del resultado expone el contexto (ni cifrado ni en claro).
      expect(Object.keys(sitios[0] as object)).not.toContain('contextoCifrado');
      expect(Object.keys(sitios[0] as object)).not.toContain('contexto');
      const text = sqlText(sql);
      // contexto_cifrado SOLO aparece dentro del derivado (contexto_cifrado is not null).
      expect(text).toContain('(contexto_cifrado is not null) as tiene_contexto');
      expect(text.replace('(contexto_cifrado is not null) as tiene_contexto', '')).not.toContain('contexto_cifrado');
    });

    it('obtenerPorDominio acota por owner: un dominio ajeno no se resuelve', async () => {
      const repo = new SitiosConectadosRepository(makeOwnerScopedSql('user-1', makeRow()));
      await expect(repo.obtenerPorDominio('user-1', 'app.ejemplo.com')).resolves.toMatchObject({ id: SITIO_ID });
      const repoAjeno = new SitiosConectadosRepository(makeOwnerScopedSql('user-1', makeRow()));
      await expect(repoAjeno.obtenerPorDominio('user-2', 'app.ejemplo.com')).resolves.toBeNull();
    });
  });

  describe('actualizarEstado', () => {
    it('actualiza el estado acotado por id + owner; una conexion ajena no se toca (-> null)', async () => {
      const repo = new SitiosConectadosRepository(makeOwnerScopedSql('user-1', makeRow({ estado: 'caducado' })));
      await expect(repo.actualizarEstado(SITIO_ID, 'user-1', 'caducado')).resolves.toMatchObject({
        estado: 'caducado',
      });
      const repoAjeno = new SitiosConectadosRepository(makeOwnerScopedSql('user-1', makeRow()));
      await expect(repoAjeno.actualizarEstado(SITIO_ID, 'user-2', 'caducado')).resolves.toBeNull();
    });
  });

  describe('guardarContexto (el nucleo: cifrado en reposo)', () => {
    it('NUNCA persiste el contexto en claro: a la base viaja SOLO el blob AES-256-GCM', async () => {
      const sql = makeSqlReturning([makeRow({ estado: 'activo', tiene_contexto: true })]);
      await new SitiosConectadosRepository(sql).guardarContexto(
        SITIO_ID,
        'user-1',
        { contexto: CONTEXTO_PLANO, contextoExternoId: 'ctx-proveedor-1', egressIp: '203.0.113.7' },
        VAULT_SECRET,
      );
      const values = sqlValues(sql);
      // Ningun parametro (ni el texto SQL) contiene el claro, ni fragmentos de el.
      const serializado = JSON.stringify({ text: sqlText(sql), values }, (_k, v: unknown) =>
        v instanceof Buffer ? v.toString('base64url') : v,
      );
      expect(serializado).not.toContain('super-secreta-cookie-de-sesion-del-usuario');
      expect(serializado).not.toContain('jwt-de-la-sesion-del-usuario');
      expect(serializado).not.toContain(CONTEXTO_PLANO);
      // El primer parametro es el blob bytea: bytes iv | tag | ciphertext de aes-gcm.ts.
      const blob = values[0];
      expect(Buffer.isBuffer(blob)).toBe(true);
      // 12 (iv) + 16 (tag) + ciphertext no vacio.
      expect((blob as Buffer).length).toBeGreaterThan(28);
    });

    it('roundtrip correcto con VAULT_SECRET: el blob persistido descifra al claro EXACTO (y solo con ese secreto)', async () => {
      const sql = makeSqlReturning([makeRow({ estado: 'activo', tiene_contexto: true })]);
      await new SitiosConectadosRepository(sql).guardarContexto(
        SITIO_ID,
        'user-1',
        { contexto: CONTEXTO_PLANO },
        VAULT_SECRET,
      );
      const blob = sqlValues(sql)[0] as Buffer;
      const token = Buffer.from(blob).toString('base64url');
      expect(decryptFromToken(token, VAULT_SECRET)).toBe(CONTEXTO_PLANO);
      // Con otro secreto el tag GCM no autentica: el blob es inutil sin el VAULT_SECRET correcto.
      expect(() => decryptFromToken(token, OTRO_SECRET)).toThrow();
    });

    it('marca la conexion activo, sella ultimo_uso_en y guarda la identidad de red observada', async () => {
      const sql = makeSqlReturning([makeRow({ estado: 'activo', tiene_contexto: true, egress_ip: '203.0.113.7' })]);
      const sitio = await new SitiosConectadosRepository(sql).guardarContexto(
        SITIO_ID,
        'user-1',
        { contexto: CONTEXTO_PLANO, egressIp: '203.0.113.7', expiraEn: '2026-08-16T00:00:00.000Z' },
        VAULT_SECRET,
      );
      expect(sitio).toMatchObject({ estado: 'activo', tieneContexto: true, egressIp: '203.0.113.7' });
      const text = sqlText(sql);
      expect(text).toContain("estado = 'activo'");
      expect(text).toContain('ultimo_uso_en = now()');
    });

    it('acota por id + owner: no se puede inyectar contexto en la conexion de otro (-> null)', async () => {
      const repo = new SitiosConectadosRepository(makeOwnerScopedSql('user-1', makeRow()));
      await expect(
        repo.guardarContexto(SITIO_ID, 'user-2', { contexto: CONTEXTO_PLANO }, VAULT_SECRET),
      ).resolves.toBeNull();
    });
  });

  describe('obtenerContextoDescifrado (uso interno server-side)', () => {
    const blobValido = () => ({
      contexto_cifrado: Buffer.from(encryptToToken(CONTEXTO_PLANO, VAULT_SECRET), 'base64url'),
    });

    it('descifra el contexto del owner (roundtrip completo contra lo que guardaria la base)', async () => {
      const sql = makeSqlReturning([blobValido()]);
      await expect(
        new SitiosConectadosRepository(sql).obtenerContextoDescifrado(SITIO_ID, 'user-1', VAULT_SECRET),
      ).resolves.toBe(CONTEXTO_PLANO);
      // La query del blob pide SOLO contexto_cifrado (no arrastra metadata).
      expect(sqlText(sql)).toContain('select contexto_cifrado');
    });

    it('aislamiento CRITICO: un owner no descifra la sesion de otro (fila ajena -> null, jamas el contexto)', async () => {
      const repo = new SitiosConectadosRepository(makeOwnerScopedSql('user-1', blobValido()));
      await expect(repo.obtenerContextoDescifrado(SITIO_ID, 'user-2', VAULT_SECRET)).resolves.toBeNull();
    });

    it('sin contexto guardado -> null; blob corrupto -> null; secreto incorrecto -> null (sin lanzar ni filtrar)', async () => {
      await expect(
        new SitiosConectadosRepository(makeSqlReturning([{ contexto_cifrado: null }]))
          .obtenerContextoDescifrado(SITIO_ID, 'user-1', VAULT_SECRET),
      ).resolves.toBeNull();
      await expect(
        new SitiosConectadosRepository(makeSqlReturning([{ contexto_cifrado: Buffer.from('basura') }]))
          .obtenerContextoDescifrado(SITIO_ID, 'user-1', VAULT_SECRET),
      ).resolves.toBeNull();
      await expect(
        new SitiosConectadosRepository(makeSqlReturning([blobValido()]))
          .obtenerContextoDescifrado(SITIO_ID, 'user-1', OTRO_SECRET),
      ).resolves.toBeNull();
      await expect(
        new SitiosConectadosRepository(makeSqlReturning([]))
          .obtenerContextoDescifrado(SITIO_ID, 'user-1', VAULT_SECRET),
      ).resolves.toBeNull();
    });
  });

  describe('borrar (borrado ARCO por conexion)', () => {
    it('borra la conexion del owner y devuelve el contexto_externo_id para purgar en el proveedor (7.1b)', async () => {
      const sql = makeSqlReturning([
        { id: SITIO_ID, dominio: 'app.ejemplo.com', contexto_externo_id: 'ctx-proveedor-1' },
      ]);
      await expect(new SitiosConectadosRepository(sql).borrar(SITIO_ID, 'user-1')).resolves.toEqual({
        id: SITIO_ID,
        dominio: 'app.ejemplo.com',
        contextoExternoId: 'ctx-proveedor-1',
      });
      expect(sqlText(sql)).toContain('delete from sitios_conectados');
      expect(sqlText(sql)).toContain('returning id, dominio, contexto_externo_id');
    });

    it('una conexion ajena o inexistente no se borra (-> null)', async () => {
      const repo = new SitiosConectadosRepository(
        makeOwnerScopedSql('user-1', { id: SITIO_ID, dominio: 'app.ejemplo.com', contexto_externo_id: null }),
      );
      await expect(repo.borrar(SITIO_ID, 'user-2')).resolves.toBeNull();
    });
  });
});
