import { describe, it, expect } from 'vitest';
import { marcadorDeRanura, TERMINOS_SIN_MARCADOR_DELIBERADO } from '@ledesma-platform/shared';
import { VOCABULARIO_DE_CONTEXTO } from '../src/verificacion.js';

/**
 * SIMETRIA DE LOS DOS VOCABULARIOS DEL MISMO CAMPO (FIX defecto 3).
 *
 * La plataforma decide DOS veces que dato es un campo, con dos tablas distintas:
 *  - VOCABULARIO_DE_CONTEXTO (apps/worker/src/verificacion.ts) decide si el campo que se leyo del DOM
 *    es "el destinatario" o "el monto" para COMPARARLO contra lo que el usuario pidio;
 *  - MARCADOR_POR_NOMBRE_DE_CLASE (packages/shared/src/plantillas/contrato.ts) decide con que dato se
 *    LLENA la ranura de una plantilla ajena cuyo campo se llama asi.
 *
 * El contrato de plantillas afirma que la segunda se sembro de la primera, y habian divergido: la
 * verificacion trataba "Correo electronico" como destinatario y la tabla no le daba marcador, asi que
 * ese campo se comparaba como destinatario pero jamas se podia publicar como ranura de destinatario.
 * La divergencia no se ve en ninguna corrida: se descubre midiendo. Este test la vuelve un fallo de
 * CI, y obliga a que toda excepcion se declare con su motivo.
 */

/** La clase de una ranura de escritura cuyo nombre de campo es exactamente ese termino. */
function claseDeRanura(nombre: string): string {
  return `escribir|rol:textbox|${nombre}`;
}

/** Los terminos declarados como divergencia deliberada, para saltarlos en el barrido. */
const DELIBERADOS = new Set(TERMINOS_SIN_MARCADOR_DELIBERADO.map((entrada) => entrada.termino));

describe('los dos vocabularios que nombran el mismo campo no divergen', () => {
  it('cada termino de la verificacion mapea al MISMO marcador en la tabla de ranuras', () => {
    for (const [marcador, terminos] of Object.entries(VOCABULARIO_DE_CONTEXTO)) {
      for (const termino of terminos) {
        if (DELIBERADOS.has(termino)) continue;
        expect(marcadorDeRanura(claseDeRanura(termino)), termino).toBe(marcador);
      }
    }
  });

  it('el nombre real de un campo, con su sufijo, mapea igual que el termino pelado', () => {
    // La tabla compara por PREFIJO, asi que el termino sirve tambien con el nombre completo que el
    // sitio pone de verdad. Son los nombres medidos en produccion mas el que motivo el fix.
    expect(marcadorDeRanura(claseDeRanura('correo electronico'))).toBe('destinatario');
    expect(marcadorDeRanura(claseDeRanura('destinatarios en para'))).toBe('destinatario');
    expect(marcadorDeRanura(claseDeRanura('cuerpo del mensaje'))).toBe('cuerpo');
    expect(marcadorDeRanura(claseDeRanura('email del cliente'))).toBe('destinatario');
    expect(marcadorDeRanura(claseDeRanura('total a pagar'))).toBe('monto');
  });

  it('las divergencias DELIBERADAS estan declaradas, con motivo, y siguen siendo divergencias', () => {
    for (const entrada of TERMINOS_SIN_MARCADOR_DELIBERADO) {
      // El termino existe de verdad en el vocabulario de la verificacion, con ese marcador.
      expect(
        VOCABULARIO_DE_CONTEXTO[
          entrada.marcadorEnLaVerificacion as keyof typeof VOCABULARIO_DE_CONTEXTO
        ],
        entrada.termino,
      ).toContain(entrada.termino);
      // Y aqui NO mapea. Si alguien le da marcador, tiene que sacarlo de la lista de excepciones.
      expect(marcadorDeRanura(claseDeRanura(entrada.termino)), entrada.termino).toBeNull();
      // Una excepcion sin motivo escrito es un olvido disfrazado.
      expect(entrada.motivo.length, entrada.termino).toBeGreaterThan(20);
    }
  });

  it('la excepcion de "titulo" no se lleva por delante el asunto de verdad', () => {
    expect(marcadorDeRanura(claseDeRanura('asunto'))).toBe('asunto');
    expect(marcadorDeRanura(claseDeRanura('subject'))).toBe('asunto');
    expect(marcadorDeRanura(claseDeRanura('subjectbox'))).toBe('asunto');
  });
});

/**
 * EL OTRO SENTIDO: lo que la tabla dice DE MAS. No es una divergencia que haya que cerrar, y por eso
 * se fija aqui con su motivo en vez de "alinearse": los vocabularios de contexto son listas de
 * terminos sueltos y no pueden expresar ni un nombre de varias palabras, ni un marcador que la
 * verificacion no busca por el contexto de un campo.
 */
describe('lo que la tabla de ranuras dice de mas, y por que es deliberado', () => {
  it('nombres de varias palabras: "cantidad a pagar" es dinero, no un numero de unidades', () => {
    expect(marcadorDeRanura(claseDeRanura('cantidad a pagar'))).toBe('monto');
    expect(marcadorDeRanura(claseDeRanura('cantidad'))).toBe('cantidad');
  });

  it('producto no tiene vocabulario de contexto: la verificacion lo busca en el texto de la pagina', () => {
    expect(Object.keys(VOCABULARIO_DE_CONTEXTO)).not.toContain('producto');
    expect(marcadorDeRanura(claseDeRanura('producto'))).toBe('producto');
  });

  it('los tres de la interpretacion natural entran solo por aqui, y no por el extractor', () => {
    for (const [nombre, marcador] of [
      ['fecha', 'fecha'],
      ['lugar', 'lugar'],
      ['nombre', 'nombre'],
    ] as const) {
      expect(Object.keys(VOCABULARIO_DE_CONTEXTO)).not.toContain(marcador);
      expect(marcadorDeRanura(claseDeRanura(nombre))).toBe(marcador);
    }
  });

  it('FALLA CERRADA: un nombre que no es de ningun vocabulario sigue sin marcador', () => {
    expect(marcadorDeRanura(claseDeRanura('etiqueta interna'))).toBeNull();
    expect(marcadorDeRanura(claseDeRanura('archivar'))).toBeNull();
  });
});
