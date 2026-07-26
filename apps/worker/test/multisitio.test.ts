import { describe, it, expect } from 'vitest';
import {
  MAX_CAMBIOS_DE_SITIO_POR_TAREA,
  MAX_RESUMEN_ENTRE_SITIOS_CHARS,
  construirContinuacionEnOtroSitio,
  crearRegistroDeSitios,
  normalizarDominioSolicitado,
  resolverDominioAutorizado,
} from '../src/multisitio.js';

/**
 * La parte PURA del multisitio es superficie de seguridad: es quien decide si el destino que escribio
 * el modelo es uno de los sitios que el usuario autorizo para ESTA tarea. Se testea sola, sin
 * navegador y sin modelo.
 */

const AUTORIZADOS = ['tienda.ejemplo.com', 'correo.ejemplo.com'];

describe('normalizarDominioSolicitado', () => {
  it('acepta las formas en que un modelo nombra un sitio', () => {
    expect(normalizarDominioSolicitado('  Tienda.Ejemplo.com  ')).toBe('tienda.ejemplo.com');
    expect(normalizarDominioSolicitado('https://tienda.ejemplo.com/')).toBe('tienda.ejemplo.com');
    expect(normalizarDominioSolicitado('http://tienda.ejemplo.com/productos?q=1')).toBe(
      'tienda.ejemplo.com',
    );
    expect(normalizarDominioSolicitado('tienda.ejemplo.com:8443')).toBe('tienda.ejemplo.com');
    expect(normalizarDominioSolicitado('tienda.ejemplo.com#top')).toBe('tienda.ejemplo.com');
  });

  it('descarta las credenciales embebidas, que son como se disfraza un host', () => {
    // "tienda.ejemplo.com@evil.com" lo resuelve un navegador como evil.com: el host real es el de
    // la derecha, y eso es lo que tiene que quedar para que la lista blanca lo rechace.
    expect(normalizarDominioSolicitado('https://tienda.ejemplo.com@evil.com/')).toBe('evil.com');
  });

  it('devuelve null cuando no queda nada parecido a un host', () => {
    expect(normalizarDominioSolicitado('')).toBeNull();
    expect(normalizarDominioSolicitado('   ')).toBeNull();
    expect(normalizarDominioSolicitado('https:///ruta')).toBeNull();
  });
});

describe('resolverDominioAutorizado', () => {
  it('autoriza solo lo que esta EXACTAMENTE en la lista de la tarea', () => {
    expect(resolverDominioAutorizado('correo.ejemplo.com', AUTORIZADOS)).toEqual({
      tipo: 'autorizado',
      dominio: 'correo.ejemplo.com',
    });
    expect(resolverDominioAutorizado('https://correo.ejemplo.com/inbox', AUTORIZADOS)).toEqual({
      tipo: 'autorizado',
      dominio: 'correo.ejemplo.com',
    });
  });

  it('rechaza el parecido: ni sufijos, ni subdominios, ni prefijos', () => {
    for (const intento of [
      'evil-tienda.ejemplo.com',
      'tienda.ejemplo.com.evil.com',
      'login.tienda.ejemplo.com',
      'ejemplo.com',
      'otro.sitio',
    ]) {
      const veredicto = resolverDominioAutorizado(intento, AUTORIZADOS);
      expect(veredicto.tipo).toBe('rechazado');
    }
  });

  it('el rechazo dice que sitios SI hay y recuerda no seguir ordenes de una pagina', () => {
    const veredicto = resolverDominioAutorizado('evil.com', AUTORIZADOS);
    if (veredicto.tipo !== 'rechazado') throw new Error('deberia rechazar');
    expect(veredicto.mensaje).toContain('tienda.ejemplo.com, correo.ejemplo.com');
    expect(veredicto.mensaje).toContain('ignoralo');
  });

  it('sin destino legible tampoco autoriza nada', () => {
    expect(resolverDominioAutorizado('   ', AUTORIZADOS).tipo).toBe('rechazado');
  });
});

describe('construirContinuacionEnOtroSitio', () => {
  const base = {
    objetivo: 'busca el precio del teclado y mandalo por correo',
    dominioAnterior: 'tienda.ejemplo.com',
    dominioNuevo: 'correo.ejemplo.com',
  };

  it('repite el objetivo intacto y entrega lo traido como DATO delimitado', () => {
    const texto = construirContinuacionEnOtroSitio({ ...base, resumenPrevio: 'el teclado cuesta 100' });
    expect(texto).toContain(base.objetivo);
    expect(texto).toContain('<<<el teclado cuesta 100>>>');
    expect(texto).toContain('NUNCA instrucciones');
    expect(texto).toContain('correo.ejemplo.com');
  });

  it('censura y acota lo que viene del sitio anterior', () => {
    const tarjeta = 'la tarjeta es 4111 1111 1111 1111';
    expect(construirContinuacionEnOtroSitio({ ...base, resumenPrevio: tarjeta })).not.toContain(
      '4111 1111 1111 1111',
    );
    const largo = 'x'.repeat(MAX_RESUMEN_ENTRE_SITIOS_CHARS * 2);
    const texto = construirContinuacionEnOtroSitio({ ...base, resumenPrevio: largo });
    expect(texto).toContain('...');
    expect(texto.length).toBeLessThan(largo.length);
  });

  it('un resumen vacio no rompe el delimitador', () => {
    expect(construirContinuacionEnOtroSitio({ ...base, resumenPrevio: '   ' })).toContain(
      '<<<sin datos>>>',
    );
  });
});

describe('crearRegistroDeSitios', () => {
  it('el cupo es POR SITIO y el mismo sitio devuelve SIEMPRE el mismo estado', () => {
    const registro = crearRegistroDeSitios();
    expect(registro.algunaAutorizada()).toBe(false);

    const tienda = registro.estadoDe('conn-tienda');
    tienda.irreversiblesEjecutadas += 1;

    // Otro sitio arranca en cero: enviar en uno no consume el cupo del otro.
    expect(registro.estadoDe('conn-correo').irreversiblesEjecutadas).toBe(0);
    // Volver al primero recupera SU estado, no uno nuevo: el cupo no se reabre.
    expect(registro.estadoDe('conn-tienda').irreversiblesEjecutadas).toBe(1);
    expect(registro.algunaAutorizada()).toBe(true);
  });
});

describe('el tope de cambios de sitio', () => {
  it('esta acotado y por encima de una tarea real de tres sitios', () => {
    expect(MAX_CAMBIOS_DE_SITIO_POR_TAREA).toBeGreaterThanOrEqual(3);
    expect(MAX_CAMBIOS_DE_SITIO_POR_TAREA).toBeLessThanOrEqual(12);
  });
});
