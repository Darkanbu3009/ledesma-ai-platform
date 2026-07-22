import { describe, it, expect } from 'vitest';
import { censurarTexto, censurarValor, esContextoSensible, VALOR_CENSURADO } from '../src/censura.js';

/**
 * La censura es la garantia DURA de este PR: valores tecleados en campos sensibles (passwords,
 * tarjetas, tokens) JAMAS se persisten en pasos_trayectoria. Criterio asimetrico: ante la duda se
 * censura (un falso positivo pierde un dato de depuracion; un falso negativo filtra un secreto).
 */
describe('censurarValor', () => {
  describe('passwords (por contexto del campo)', () => {
    it('censura lo tecleado en un campo password (selector xpath tipico de Stagehand)', () => {
      const contexto = 'xpath=/html/body/form/input[@type="password"] the password field';
      expect(censurarValor('hunter2', contexto)).toBe(VALOR_CENSURADO);
    });

    it('censura variantes de credenciales en el contexto: contrasena, clave, passwd, pin, otp', () => {
      for (const campo of [
        'input#contrasena del formulario',
        'campo clave de acceso',
        'xpath=//input[@name="passwd"]',
        'el campo PIN de 4 digitos',
        'input one-time code (OTP)',
      ]) {
        expect(censurarValor('123456', campo)).toBe(VALOR_CENSURADO);
      }
    });

    it('censura tokens y api keys por contexto', () => {
      expect(censurarValor('sk-abc123', 'campo api_key de la integracion')).toBe(VALOR_CENSURADO);
      expect(censurarValor('ghp_xyz', 'personal access token input')).toBe(VALOR_CENSURADO);
    });
  });

  describe('numeros de tarjeta (por forma del valor, sin importar el contexto)', () => {
    it('censura una tarjeta de 16 digitos pegados aunque el campo parezca inocente', () => {
      expect(censurarValor('4111111111111111', 'campo buscar')).toBe(VALOR_CENSURADO);
    });

    it('censura tarjetas con espacios y con guiones', () => {
      expect(censurarValor('4111 1111 1111 1111', 'input generico')).toBe(VALOR_CENSURADO);
      expect(censurarValor('5500-0000-0000-0004', 'input generico')).toBe(VALOR_CENSURADO);
    });

    it('censura una amex de 15 digitos y una tarjeta de 19', () => {
      expect(censurarValor('378282246310005', 'campo')).toBe(VALOR_CENSURADO);
      expect(censurarValor('6221 2345 6789 0123 456', 'campo')).toBe(VALOR_CENSURADO);
    });

    it('censura el cvv y el numero por contexto de tarjeta aunque sean numeros cortos', () => {
      expect(censurarValor('123', 'input cvv')).toBe(VALOR_CENSURADO);
      expect(censurarValor('4111', 'campo tarjeta (ultimos 4)')).toBe(VALOR_CENSURADO);
    });
  });

  describe('valores inocentes pasan intactos', () => {
    it('texto de busqueda normal no se toca', () => {
      expect(censurarValor('zapatos de cuero talla 42', 'input de busqueda')).toBe(
        'zapatos de cuero talla 42',
      );
    });

    it('numeros cortos (cantidades, fechas) no disparan el patron de tarjeta', () => {
      expect(censurarValor('42', 'campo cantidad')).toBe('42');
      expect(censurarValor('2026-07-22', 'campo fecha')).toBe('2026-07-22');
    });

    it('un email en un campo generico no se censura', () => {
      expect(censurarValor('ana@example.com', 'campo email de contacto')).toBe('ana@example.com');
    });
  });
});

describe('censurarTexto', () => {
  it('reemplaza una tarjeta embebida en una instruccion conservando el resto', () => {
    expect(censurarTexto('type 4111 1111 1111 1111 into the card number field')).toBe(
      `type ${VALOR_CENSURADO} into the card number field`,
    );
  });

  it('reemplaza TODAS las tarjetas del texto', () => {
    const texto = 'probar 4111111111111111 y despues 5500-0000-0000-0004';
    expect(censurarTexto(texto)).toBe(`probar ${VALOR_CENSURADO} y despues ${VALOR_CENSURADO}`);
  });

  it('no toca un texto sin secuencias con pinta de tarjeta', () => {
    const texto = 'buscar el articulo sobre historia de Mexico y resumirlo en 3 puntos';
    expect(censurarTexto(texto)).toBe(texto);
  });
});

describe('esContextoSensible', () => {
  it('detecta espanol e ingles', () => {
    expect(esContextoSensible('el campo contrasena')).toBe(true);
    expect(esContextoSensible('the password input')).toBe(true);
    expect(esContextoSensible('numero de cuenta bancaria (CLABE)')).toBe(true);
    expect(esContextoSensible('campo de busqueda')).toBe(false);
  });
});
