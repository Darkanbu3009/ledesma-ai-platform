/**
 * SUPERFICIE MINIMA de jsdom que usa guion-grabador-dom.test.ts, declarada aqui a mano.
 *
 * POR QUE NO @types/jsdom: ese paquete tipa el DOM completo y para eso exige que TypeScript cargue la
 * libreria `dom`. Este worker declara `"lib": ["ES2022"]` A PROPOSITO -- su codigo corre en Node y no
 * debe poder usar `document` ni `window` por descuido -- y activar la libreria del navegador para todo
 * el proyecto por una dependencia de prueba invertiria esa garantia.
 *
 * Se describe SOLO lo que el test toca. Cualquier cosa que haga falta de mas hay que agregarla aqui,
 * que es justamente lo que mantiene la prueba honesta sobre la superficie que usa.
 */
declare module 'jsdom' {
  /** Un elemento de la pagina de prueba, con lo justo para escribir en el y disparar eventos. */
  export interface ElementoJsdom {
    textContent: string | null;
    /** Solo en los campos que lo exponen (input, textarea). */
    value?: string;
    dispatchEvent(evento: unknown): boolean;
    setAttribute(nombre: string, valor: string): void;
    appendChild(hijo: ElementoJsdom): ElementoJsdom;
  }

  /** Constructor de evento tal como lo expone la ventana (Event, MouseEvent, KeyboardEvent). */
  export type ConstructorDeEvento = new (
    tipo: string,
    opciones?: { bubbles?: boolean; key?: string },
  ) => unknown;

  export interface VentanaJsdom {
    document: {
      getElementById(id: string): ElementoJsdom | null;
      createElement(tag: string): ElementoJsdom;
      body: ElementoJsdom;
    };
    /** Ejecuta un guion DENTRO de la ventana (requiere runScripts: 'outside-only'). */
    eval(codigo: string): unknown;
    /** Cierra la ventana y detiene sus temporizadores. */
    close(): void;
    Event: ConstructorDeEvento;
    MouseEvent: ConstructorDeEvento;
    KeyboardEvent: ConstructorDeEvento;
  }

  export class JSDOM {
    constructor(html: string, opciones?: { url?: string; runScripts?: 'outside-only' });
    readonly window: VentanaJsdom;
  }
}
