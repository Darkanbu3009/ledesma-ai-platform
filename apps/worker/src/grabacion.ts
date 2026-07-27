import {
  GRABAR_TAREA_JOB_KIND,
  MAX_PASOS_GRABACION,
  MAX_PASOS_RECETA,
  PROMOVER_GRABACION_JOB_KIND,
  ordenarEstrategias,
  parsearRuta,
  parseGrabacionJobPayload,
  type EstrategiaLocalizacion,
  type Job,
  type MarcadoDeVariable,
  type MotivoDescarte,
  type PasoDeReceta,
  type PasoGrabado,
} from '@ledesma-platform/shared';
// IMPORT DE TIPOS (type-only): igual que sitios.ts, los repositorios reales se INYECTAN. Y, como en
// sitios.ts, aca NO se importa NINGUN cliente de modelo ni SDK de proveedor de IA -- ni siquiera
// type-only. La propiedad "cero llamadas al modelo durante la grabacion" es ESTRUCTURAL: en la ruta de
// estos jobs hay un humano manejando el navegador y no existe el import con el que llamar a un modelo.
import type { SitioConectado } from '@ledesma-platform/backend/sitios';
import type { Grabacion } from '@ledesma-platform/backend/grabaciones';
import type { NuevaRecetaWeb, RecetaWeb } from '@ledesma-platform/backend/recetas-web';
import { PermanentExecutionError } from './errores.js';
import { SalidaDeRedNoDisponibleError } from './sitios.js';
import { censurarUrl, censurarValor, VALOR_CENSURADO } from './censura.js';
import { estrategiasIndependientesDelValor, sanearEstrategias } from './localizacion.js';
import { detectarVerboBloqueado } from './prompt-tarea-web.js';
import { firmaDeObjetivo } from './receta-web.js';
import type { Logger } from './logger.js';

/**
 * GRABACION DE TAREAS: la via COMPLEMENTARIA para SEMBRAR una receta. El usuario le ENSENA una tarea al
 * sistema haciendola el mismo una vez en la vista en vivo; el worker captura lo que hace y despues eso
 * se convierte en una receta que se repite sin llamar al modelo.
 *
 * LA ARQUITECTURA PRINCIPAL NO CAMBIA: el agente sigue navegando libremente cualquier sitio donde el
 * usuario ya inicio sesion, y esa universalidad es la propuesta de valor. Esto existe para dos casos:
 * sitios donde el agente falla de forma repetida, y arrancar el sistema de recetas sin depender de una
 * primera corrida exitosa del agente.
 *
 * LINEAS ROJAS (las mismas de 7.1b/7.1d, mas la propia de la grabacion):
 *  - EL LOGIN JAMAS SE GRABA. La grabacion solo se inicia sobre una conexion en estado 'activo', cuya
 *    sesion establecio el flujo de login existente. Antes de capturar nada se corre el MISMO
 *    pre-chequeo determinista de campo de contrasena que usa la tarea web; y si aparece un campo de
 *    contrasena DURANTE la grabacion, la captura se detiene al instante, lo capturado se DESCARTA (la
 *    fila queda con pasos vacios y motivo 'contrasena') y se le avisa al usuario.
 *  - CERO LLAMADAS AL MODELO. Este modulo no importa ningun cliente de modelo, ni recibe una api key,
 *    ni tiene un puerto por el que hablar con uno. La captura es lectura de DOM y eventos del
 *    navegador; la promocion es transformacion de datos.
 *  - EL PAIS de salida es el PINEADO o ninguno, igual que en la tarea web: si el observado difiere del
 *    pineado (o no se puede observar) se aborta sin abrir nada al usuario. Jamas se degrada.
 *  - UNA RECETA GRABADA NO SALTA NADA. Se promueve a una fila normal de recetas_web y se ejecuta con la
 *    MISMA verificacion determinista de parametros y la MISMA politica del usuario que cualquier otra.
 *    El campo `origen` sirve para distinguirlas, no para tratarlas distinto.
 */

/** Cuanto puede durar UNA grabacion antes de que el worker la de por abandonada (10 min). */
export const GRABACION_TIMEOUT_MS = 10 * 60 * 1000;

/** Cada cuanto el worker mira si el usuario ya dijo "ya termine" (ms). */
export const SONDEO_DE_GRABACION_MS = 2000;

/** Sesion de navegador abierta para grabar: referencias minimas (nunca credenciales). */
export interface SesionDeGrabacionAbierta {
  sesionExternaId: string;
  /** URL de la vista en vivo donde el usuario hace la tarea. */
  vistaEnVivoUrl: string;
  egressIp: string | null;
  /** PAIS de salida OBSERVADO (ISO 3166-1 alpha-2). Se verifica contra proxy_country. */
  egressCountry: string | null;
}

/** Una captura instalada y corriendo. `detener` es idempotente. */
export interface CapturaEnCurso {
  detener(): Promise<void>;
}

/**
 * PUERTO hacia el proveedor de navegador para la grabacion. Lo implementa NavegadorBrowserbase
 * (browserbase.ts, el unico modulo que importa el SDK); los tests pasan fakes y no abren nada.
 *
 * Ningun metodo recibe ni devuelve credenciales del sitio, y no hay ninguno que sirva para escribir en
 * la pagina: durante una grabacion el worker SOLO observa.
 */
export interface NavegadorParaGrabacion {
  /**
   * Abre una sesion RECONECTANDO el contexto guardado y FORZANDO la salida pineada, y devuelve la URL
   * de la vista en vivo. Igual que la tarea web: si el pin no es reconstruible, lanza
   * SalidaDeRedNoDisponibleError; jamas degrada a otra salida.
   */
  abrirSesionParaGrabacion(params: {
    contextoExternoId: string;
    proxyRef: string;
    proxyCountry: string;
  }): Promise<SesionDeGrabacionAbierta>;
  /** Inyecta el contexto de sesion DESCIFRADO (cookies) en la sesion viva, antes de navegar. */
  inyectarContexto(sesionExternaId: string, contexto: string): Promise<void>;
  /** El MISMO pre-chequeo determinista de campo de contrasena que usa la tarea web. Sin modelo. */
  detectarPantallaDeLogin(sesionExternaId: string, url: string): Promise<boolean>;
  /**
   * Instala el grabador en la pagina y empieza a recibir sus eventos. `alRecibir` llega con el JSON
   * CRUDO que emitio el guion; este modulo lo parsea y lo sanea (asi la logica se testea sin navegador).
   */
  iniciarCaptura(
    sesionExternaId: string,
    alRecibir: (crudo: string) => void,
  ): Promise<CapturaEnCurso>;
  /** Cierra (libera) la sesion en el proveedor. */
  cerrarSesion(sesionExternaId: string): Promise<void>;
}

/** Subconjunto del SitiosConectadosRepository que la grabacion usa (solo lectura de la conexion). */
export interface RepositorioSitiosParaGrabacion {
  obtenerPorId(id: string, ownerId: string): Promise<SitioConectado | null>;
  obtenerContextoDescifrado(id: string, ownerId: string, vaultSecret: string): Promise<string | null>;
}

/** Subconjunto del GrabacionesRepository que el worker usa. */
export interface RepositorioGrabaciones {
  obtener(id: string, ownerId: string): Promise<Grabacion | null>;
  publicarVistaEnVivo(id: string, ownerId: string, vistaEnVivoUrl: string): Promise<void>;
  sigueGrabando(id: string, ownerId: string): Promise<boolean>;
  guardarPasos(id: string, ownerId: string, pasos: PasoGrabado[]): Promise<void>;
  descartar(id: string, ownerId: string, motivo: MotivoDescarte): Promise<void>;
}

/** Subconjunto del RecetasWebRepository que la promocion de una grabacion usa. */
export interface RepositorioRecetasParaGrabacion {
  promover(input: NuevaRecetaWeb): Promise<RecetaWeb | null>;
}

/** Dependencias de los jobs de grabacion. index.ts cablea las reales; los tests pasan fakes. */
export interface GrabacionDeps {
  repo: RepositorioSitiosParaGrabacion;
  grabaciones: RepositorioGrabaciones;
  recetas: RepositorioRecetasParaGrabacion;
  navegador: NavegadorParaGrabacion;
  /** Secreto de la boveda: descifra el contexto de sesion del sitio (7.1a). */
  vaultSecret: string;
  /** Persiste el resultado del job (jobs.resultado, V026) antes del cierre. */
  guardarResultado(jobId: string, resultado: unknown): Promise<void>;
  /** Espera de pared entre sondeos. OPCIONAL: sin ella se usa un setTimeout real (los tests inyectan). */
  esperar?: ((ms: number) => Promise<void>) | undefined;
  /** Reloj inyectable para el deadline de la grabacion (los tests avanzan el tiempo sin dormir). */
  ahora?: (() => number) | undefined;
  logger: Logger;
}

/** CONTROL EXTERNO de la grabacion: la senal de cancelacion del job (terminar desde la consola). */
export interface ControlDeGrabacion {
  signal?: AbortSignal | undefined;
  alCambiarSesion?: ((sesionExternaId: string | null) => void) | undefined;
}

/** Mensaje accionable cuando la conexion no esta en condiciones de grabar. */
const MENSAJE_RECONECTAR =
  'el sitio no esta conectado o la sesion caduco, vuelve a conectarlo desde la consola';

function describir(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return 'error desconocido';
}

function esperarMs(ms: number): Promise<void> {
  return new Promise((resolver) => setTimeout(resolver, ms));
}

/* -------------------------------------------------------------------------------------------------
 * PARTE PURA: parseo de lo que emite el guion grabador y acumulacion de pasos.
 * ---------------------------------------------------------------------------------------------- */

/** Un evento del guion grabador, ya parseado y saneado. */
export interface EventoCapturado {
  tipo: 'clic' | 'escritura' | 'tecla' | 'navegacion' | 'contrasena';
  url: string | null;
  estrategias: EstrategiaLocalizacion[];
  /** Solo 'escritura': lo que el usuario tecleo, YA CENSURADO. */
  valor: string | null;
  /** Solo 'tecla'. */
  teclas: string | null;
}

/** Teclas que el contrato de recetas sabe repetir. Cerrada: el texto libre va por 'escritura'. */
const TECLAS_ADMITIDAS = new Set(['Enter', 'Tab', 'Escape']);

function comoTexto(valor: unknown): string | null {
  return typeof valor === 'string' && valor.length > 0 ? valor : null;
}

/**
 * Parsea UN evento crudo del guion grabador. Devuelve null ante cualquier cosa que no reconozca: un
 * evento raro se descarta, nunca tumba la grabacion.
 *
 * Aqui se aplica la CENSURA EXISTENTE (censura.ts) a todo valor capturado, con el mismo contexto que
 * usa la verificacion determinista para juzgar si un campo es sensible. Un valor que la censura toca
 * queda como marcador: el dato en claro no llega ni siquiera a la memoria del acumulador.
 */
export function parsearEventoCapturado(crudo: string): EventoCapturado | null {
  let parseado: unknown;
  try {
    parseado = JSON.parse(crudo);
  } catch {
    return null;
  }
  if (typeof parseado !== 'object' || parseado === null) return null;
  const objeto = parseado as Record<string, unknown>;
  const tipo = objeto.tipo;
  const base = { url: null as string | null, estrategias: [] as EstrategiaLocalizacion[], valor: null, teclas: null };

  if (tipo === 'contrasena') return { ...base, tipo: 'contrasena' };

  const urlCruda = comoTexto(objeto.url);
  // La URL se guarda SIN query string ni fragment (ahi viajan tokens de reset y codigos OAuth).
  const url = urlCruda === null ? null : censurarUrl(urlCruda);
  const estrategias = sanearEstrategias(JSON.stringify(objeto.estrategias ?? []));

  if (tipo === 'navegacion') return { ...base, tipo: 'navegacion', url };
  if (tipo === 'clic') return { ...base, tipo: 'clic', url, estrategias };
  if (tipo === 'tecla') {
    const teclas = comoTexto(objeto.teclas);
    if (teclas === null || !TECLAS_ADMITIDAS.has(teclas)) return null;
    return { ...base, tipo: 'tecla', url, estrategias, teclas };
  }
  if (tipo === 'escritura') {
    const valor = comoTexto(objeto.valor);
    if (valor === null) return null;
    // El contexto con el que se juzga si el campo es sensible: lo que el guion leyo del campo mas lo
    // que describe al elemento. Mismo criterio que la censura de la traza.
    const contexto = [comoTexto(objeto.contexto) ?? '', ...estrategias.map(textoDeEstrategia)].join(' ');
    return { ...base, tipo: 'escritura', url, estrategias, valor: censurarValor(valor.trim(), contexto) };
  }
  return null;
}

/** El texto que una estrategia expone, para armar el contexto de la censura. */
function textoDeEstrategia(estrategia: EstrategiaLocalizacion): string {
  switch (estrategia.tipo) {
    case 'atributo':
      return `${estrategia.atributo} ${estrategia.valor}`;
    case 'rol':
      return `${estrategia.rol} ${estrategia.nombre}`;
    case 'texto':
      return estrategia.texto;
    case 'xpath':
      return estrategia.xpath;
  }
}

/** Como termino de acumular un evento. */
export type ResultadoDeAcumular = 'ok' | 'ignorado' | 'contrasena' | 'excedida' | 'no_repetible';

/** Clave de identidad de un elemento a partir de sus estrategias (para deduplicar escrituras). */
function claveDeElemento(estrategias: EstrategiaLocalizacion[]): string {
  return JSON.stringify(ordenarEstrategias(estrategias));
}

/**
 * ACUMULADOR de los pasos de una grabacion. PURO (sin navegador ni base) para poder testear el
 * comportamiento entero con eventos sinteticos.
 *
 * DECISIONES que importan, todas deterministas:
 *  - Una NAVEGACION solo se guarda como paso mientras NO haya ninguna interaccion grabada: es la
 *    pagina de la que arranca la tarea. Las navegaciones posteriores son CONSECUENCIA de los clics que
 *    ya se grabaron, y repetirlas ademas del clic haria que la receta recargara la pagina y perdiera
 *    el estado que el clic acababa de abrir. Una cadena de redirecciones al principio colapsa en la
 *    ultima URL.
 *  - Una navegacion FUERA del dominio de la conexion no se guarda (mismo invariante que la receta: una
 *    receta solo sabe operar dentro del sitio que el usuario conecto).
 *  - Una ESCRITURA sobre el mismo elemento REEMPLAZA a la anterior en vez de acumularse: el guion emite
 *    el valor al confirmar el campo y de nuevo al salir de el, y lo que la receta teclea es el valor
 *    FINAL, no cada version intermedia.
 *  - NINGUN paso se localiza por el VALOR que el usuario acaba de teclear (CAMBIO 2 y 5). En una
 *    escritura se descartan las estrategias que dependen de lo tecleado (un campo no se encuentra por
 *    su contenido: antes de escribir esta vacio). En el paso que CONFIRMA esa escritura -- el clic
 *    sobre la sugerencia del autocompletado -- se descartan las mismas, y queda la posicion en la
 *    lista, que es lo unico que sirve con otro dato.
 *  - Si al descartarlas el paso de confirmacion se queda SIN NINGUNA pista, no se graba como clic: si
 *    el usuario ya habia confirmado con Tab o Enter, esa tecla es el paso (y ya esta grabada); si no,
 *    la grabacion entera es 'no_repetible'.
 *  - Una interaccion cuyo elemento no dejo NINGUNA estrategia utilizable corta la grabacion entera
 *    ('no_repetible'): guardar el resto ensenaria una tarea a la que le falta un paso, que es
 *    exactamente lo que hay que evitar.
 */
export class AcumuladorDeGrabacion {
  private readonly capturados: PasoGrabado[] = [];
  /** ¿Ya hubo alguna interaccion? Decide si una navegacion sigue siendo "la pagina de inicio". */
  private huboInteraccion = false;

  constructor(private readonly dominio: string) {}

  /** Los pasos capturados hasta ahora, ya con idx correlativo. */
  pasos(): PasoGrabado[] {
    return this.capturados.map((paso, idx) => ({ ...paso, idx }));
  }

  agregar(evento: EventoCapturado): ResultadoDeAcumular {
    if (evento.tipo === 'contrasena') return 'contrasena';

    if (evento.tipo === 'navegacion') {
      if (this.huboInteraccion) return 'ignorado';
      const ruta = this.rutaDe(evento.url);
      if (ruta === null) return 'ignorado';
      const paso: PasoGrabado = {
        idx: 0,
        accion: 'navegar',
        estrategias: [],
        valor: null,
        teclas: null,
        ruta,
      };
      // Una cadena de redirecciones colapsa: solo la ultima URL antes de la primera interaccion.
      if (this.capturados[0]?.accion === 'navegar') this.capturados[0] = paso;
      else this.capturados.unshift(paso);
      return 'ok';
    }

    if (evento.estrategias.length === 0 && evento.tipo !== 'tecla') return 'no_repetible';
    this.huboInteraccion = true;

    if (evento.tipo === 'escritura') {
      // Un campo NO se localiza por lo que se acaba de teclear dentro: antes de escribir esta vacio,
      // y con otro dato el texto es otro. Si esa es su unica pista, el paso no es repetible.
      const estrategias = estrategiasIndependientesDelValor(evento.estrategias, [
        evento.valor ?? '',
      ]);
      if (estrategias.length === 0) return 'no_repetible';
      const paso: PasoGrabado = {
        idx: 0,
        accion: 'escribir',
        estrategias,
        valor: evento.valor,
        teclas: null,
        ruta: null,
      };
      const previo = this.indiceDeEscrituraReemplazable(estrategias);
      if (previo !== null) {
        this.capturados[previo] = paso;
        return 'ok';
      }
      return this.empujar(paso);
    }

    if (evento.tipo === 'tecla') {
      return this.empujar({
        idx: 0,
        accion: 'teclas',
        // El contrato de recetas no localiza elemento en un paso de teclas: se pulsa sobre el foco que
        // dejo el paso anterior, que es justo lo que hizo el usuario.
        estrategias: [],
        valor: null,
        teclas: evento.teclas,
        ruta: null,
      });
    }

    // CLIC. Si viene DESPUES de una escritura, es (o puede ser) el paso que la CONFIRMA: la
    // sugerencia del autocompletado que el usuario eligio. Sus pistas no pueden ser el dato tecleado.
    const escrito = this.valorRecienEscrito();
    const estrategias =
      escrito === null
        ? evento.estrategias
        : estrategiasIndependientesDelValor(evento.estrategias, [escrito]);
    if (estrategias.length === 0) {
      // Sin ninguna pista independiente del valor: si el usuario ya habia confirmado con una tecla,
      // ESA tecla es el paso de confirmacion y ya quedo grabada, asi que el clic sobra. Si no la hay,
      // no existe forma honesta de repetir este paso con otro dato.
      return this.ultimoEsTecla() ? 'ignorado' : 'no_repetible';
    }
    return this.empujar({
      idx: 0,
      accion: 'click',
      estrategias,
      valor: null,
      teclas: null,
      ruta: null,
    });
  }

  /**
   * El valor de la escritura que este paso estaria CONFIRMANDO: la ultima escritura grabada, si desde
   * entonces solo hubo pulsaciones de tecla. Cualquier otra cosa en medio significa que el clic ya no
   * confirma nada de lo tecleado y sus pistas no tienen por que filtrarse.
   */
  private valorRecienEscrito(): string | null {
    for (let i = this.capturados.length - 1; i >= 0; i--) {
      const paso = this.capturados[i];
      if (paso === undefined) return null;
      if (paso.accion === 'teclas') continue;
      return paso.accion === 'escribir' ? paso.valor : null;
    }
    return null;
  }

  /** ¿El ultimo paso grabado es una pulsacion de tecla (Enter/Tab al confirmar el campo)? */
  private ultimoEsTecla(): boolean {
    return this.capturados[this.capturados.length - 1]?.accion === 'teclas';
  }

  private empujar(paso: PasoGrabado): ResultadoDeAcumular {
    if (this.capturados.length >= MAX_PASOS_GRABACION) return 'excedida';
    this.capturados.push(paso);
    return 'ok';
  }

  /**
   * Indice de la ULTIMA escritura sobre el mismo elemento, si desde entonces solo hubo pulsaciones de
   * tecla (Enter/Tab al confirmar el campo). Cualquier otra cosa en medio significa que el usuario
   * volvio al campo mas tarde, y eso SI es un paso nuevo.
   */
  private indiceDeEscrituraReemplazable(estrategias: EstrategiaLocalizacion[]): number | null {
    const clave = claveDeElemento(estrategias);
    for (let i = this.capturados.length - 1; i >= 0; i--) {
      const paso = this.capturados[i];
      if (paso === undefined) return null;
      if (paso.accion === 'teclas') continue;
      if (paso.accion !== 'escribir') return null;
      return claveDeElemento(paso.estrategias) === clave ? i : null;
    }
    return null;
  }

  /** Ruta relativa de una URL, solo si pertenece al dominio de la conexion. */
  private rutaDe(url: string | null): string | null {
    if (url === null) return null;
    try {
      const parsed = new URL(url);
      if (parsed.hostname.toLowerCase() !== this.dominio.toLowerCase()) return null;
      return parsearRuta(parsed.pathname === '' ? '/' : parsed.pathname);
    } catch {
      return null;
    }
  }
}

/* -------------------------------------------------------------------------------------------------
 * PARTE PURA: promocion de una grabacion a los pasos de una receta.
 * ---------------------------------------------------------------------------------------------- */

/** Resultado de convertir una grabacion en receta. */
export type ResultadoDePromocionDeGrabacion =
  | {
      promovida: true;
      /** Pasos de la receta, con los datos variables ya como MARCADOR (nunca el valor). */
      pasos: PasoDeReceta[];
      /**
       * La grabacion RE ESCRITA: los valores que el usuario marco como variables quedan sustituidos
       * por su marcador. Es lo que se vuelve a guardar en la fila, para que el dato en claro no siga
       * persistido en ningun lado.
       */
      grabados: PasoGrabado[];
    }
  | { promovida: false; motivo: string };

/** El marcador tal como se muestra dentro de la grabacion re escrita. */
function textoDeMarcador(marcador: MarcadoDeVariable['marcador']): string {
  return `<${marcador}>`;
}

/**
 * Donde va el paso `verificar` en una receta grabada. La verificacion determinista tiene que correr con
 * el formulario YA COMPLETO y ANTES de la accion que no se puede deshacer:
 *  - justo DESPUES de la ultima escritura, que es cuando todos los datos ya estan en la pagina y antes
 *    del clic que confirma;
 *  - si la grabacion no tiene ninguna escritura, ANTES del ultimo paso, que es el que compromete.
 * Devuelve la posicion de insercion. Es una regla DETERMINISTA y conservadora: si se equivoca, verifica
 * ANTES de lo necesario (y entonces detiene la tarea por datos incompletos, que es el lado seguro),
 * nunca despues.
 */
export function posicionDeVerificacion(pasos: PasoDeReceta[]): number {
  for (let i = pasos.length - 1; i >= 0; i--) {
    if (pasos[i]?.accion === 'escribir') return i + 1;
  }
  return Math.max(pasos.length - 1, 0);
}

/**
 * BORRA de las LOCALIZACIONES todo rastro de los valores marcados como variables (CAMBIO 5).
 *
 * Un valor marcado no puede quedar persistido en NINGUN lado, y una estrategia es un lado: en la
 * evidencia de produccion el paso que escribia el cuerpo del mensaje conservaba una estrategia de
 * texto con el cuerpo entero, que es justo el dato que el usuario habia marcado como variable. Se
 * limpian TODOS los pasos y no solo el marcado, porque el mismo dato reaparece despues (la etiqueta
 * del destinatario ya aceptado, el resumen de confirmacion) y ahi tambien seria un valor persistido y
 * una localizacion que con otro dato no encuentra nada.
 *
 * Se aplica ADEMAS de la limpieza que ya hace el acumulador al capturar: esta corre sobre lo que hay
 * en la fila, asi que tambien alcanza a las grabaciones hechas antes de este cambio.
 */
function depurarValoresMarcados(
  pasos: PasoGrabado[],
  marcados: readonly string[],
): PasoGrabado[] {
  if (marcados.length === 0) return pasos;
  return pasos.map((paso) => ({
    ...paso,
    estrategias: estrategiasIndependientesDelValor(paso.estrategias, marcados),
  }));
}

/**
 * PROMUEVE una grabacion terminada a los pasos de una receta.
 *
 * LOS DATOS VARIABLES NO SE PERSISTEN: un paso marcado como variable guarda el MARCADOR del parametro
 * ('destinatario', 'monto', ...), y el valor que el usuario tecleo se borra tambien de la grabacion
 * (ver `grabados`) Y de las estrategias de localizacion de todos los pasos (ver
 * `depurarValoresMarcados`). Los valores NO marcados son parte fija del procedimiento y se guardan
 * tal cual.
 *
 * LA RECETA GRABADA NO SALTA LA VERIFICACION: si la descripcion que dio el usuario contiene un verbo de
 * accion bloqueada, la receta se promueve CON su paso `verificar` en el punto del flujo donde
 * corresponde. Sin el, el ejecutor se negaria a usarla (recetaAplicable) y la tarea correria por el
 * camino normal; con el, la verificacion determinista compara los datos pedidos contra la pagina antes
 * de dejar pasar la accion, exactamente igual que en una receta aprendida sola.
 */
export function promoverGrabacion(entrada: {
  pasos: PasoGrabado[];
  descripcion: string;
  variables: MarcadoDeVariable[];
}): ResultadoDePromocionDeGrabacion {
  if (entrada.pasos.length === 0) {
    return { promovida: false, motivo: 'la grabacion no capturo ningun paso' };
  }
  const porIdx = new Map(entrada.variables.map((v) => [v.idx, v.marcador]));
  const pasos: PasoDeReceta[] = [];
  const grabados: PasoGrabado[] = [];
  // Los valores que el usuario marco como variables, para borrarlos tambien de las localizaciones.
  const marcados = entrada.pasos
    .filter((paso) => porIdx.has(paso.idx) && paso.valor !== null)
    .map((paso) => paso.valor as string);

  for (const grabado of depurarValoresMarcados(entrada.pasos, marcados)) {
    const marcador = porIdx.get(grabado.idx);
    const base = {
      idx: pasos.length,
      estrategias: grabado.estrategias,
      valor: null,
      teclas: null,
      ruta: null,
      esperaMs: null,
    } as const;

    if (grabado.accion === 'navegar') {
      if (grabado.ruta === null) {
        return { promovida: false, motivo: 'un paso de navegacion quedo sin ruta' };
      }
      pasos.push({ ...base, accion: 'navegar', estrategias: [], ruta: grabado.ruta });
      grabados.push({ ...grabado, idx: grabados.length });
      continue;
    }
    if (grabado.accion === 'teclas') {
      if (grabado.teclas === null) {
        return { promovida: false, motivo: 'un paso de teclas quedo sin combinacion' };
      }
      pasos.push({ ...base, accion: 'teclas', estrategias: [], teclas: grabado.teclas });
      grabados.push({ ...grabado, idx: grabados.length });
      continue;
    }
    if (grabado.accion === 'click') {
      if (grabado.estrategias.length === 0) {
        return { promovida: false, motivo: 'un paso no dejo ninguna forma de encontrar su elemento' };
      }
      pasos.push({ ...base, accion: 'click' });
      grabados.push({ ...grabado, idx: grabados.length });
      continue;
    }

    // Escritura: marcador si el usuario dijo que ese dato cambia cada vez; si no, literal fijo.
    if (grabado.estrategias.length === 0 || grabado.valor === null) {
      return { promovida: false, motivo: 'un paso de escritura quedo sin elemento o sin valor' };
    }
    if (marcador !== undefined) {
      pasos.push({ ...base, accion: 'escribir', valor: { tipo: 'parametro', parametro: marcador } });
      // EL DATO NO SE PERSISTE: en la grabacion queda el marcador, igual que en la receta.
      grabados.push({ ...grabado, idx: grabados.length, valor: textoDeMarcador(marcador) });
      continue;
    }
    // Un valor que la censura marco como sensible JAMAS se guarda como texto fijo de la receta. Sin un
    // marcador al que atarlo no hay forma honesta de repetirlo: la grabacion no se promueve.
    if (grabado.valor.includes(VALOR_CENSURADO)) {
      return {
        promovida: false,
        motivo: 'un dato de la grabacion es sensible y no se marco como dato que cambia cada vez',
      };
    }
    pasos.push({ ...base, accion: 'escribir', valor: { tipo: 'literal', texto: grabado.valor } });
    grabados.push({ ...grabado, idx: grabados.length });
  }

  // La receta grabada NO se salta la verificacion previa a una accion que no se puede deshacer.
  if (detectarVerboBloqueado(entrada.descripcion) !== null) {
    const posicion = posicionDeVerificacion(pasos);
    pasos.splice(posicion, 0, {
      idx: posicion,
      accion: 'verificar',
      estrategias: [],
      valor: null,
      teclas: null,
      ruta: null,
      esperaMs: null,
    });
  }
  if (pasos.length > MAX_PASOS_RECETA) {
    return { promovida: false, motivo: 'la grabacion excede el tope de pasos de una receta' };
  }
  return {
    promovida: true,
    pasos: pasos.map((paso, idx) => ({ ...paso, idx })),
    grabados,
  };
}

/* -------------------------------------------------------------------------------------------------
 * HANDLERS de los dos jobs.
 * ---------------------------------------------------------------------------------------------- */

/**
 * kind:'grabar_tarea': abre la sesion sobre el sitio ACTIVO, publica la vista en vivo y captura lo que
 * el usuario hace hasta que dice "ya termine" (o hasta que aparece un campo de contrasena, o hasta que
 * vence el plazo). NO llama a ningun modelo en ningun punto.
 */
async function grabarTarea(
  deps: GrabacionDeps,
  job: Job,
  connectionId: string,
  grabacionId: string,
  control?: ControlDeGrabacion,
): Promise<void> {
  const esperar = deps.esperar ?? esperarMs;
  const ahora = deps.ahora ?? Date.now;

  const grabacion = await deps.grabaciones.obtener(grabacionId, job.ownerId);
  if (!grabacion) {
    throw new PermanentExecutionError(`la grabacion ${grabacionId} no existe o no es del owner del job`);
  }
  if (grabacion.estado !== 'grabando') {
    // Un reintento sobre una grabacion ya cerrada no debe reabrir una sesion: no-op idempotente.
    deps.logger.info('grabacion: la grabacion ya no esta en curso (no-op idempotente)', {
      jobId: job.id,
      grabacionId,
      estado: grabacion.estado,
    });
    return;
  }

  // EL INVARIANTE: solo sobre un sitio YA ACTIVO, con su sesion establecida por el flujo de login.
  const sitio = await deps.repo.obtenerPorId(connectionId, job.ownerId);
  if (!sitio || sitio.estado !== 'activo') {
    await deps.grabaciones.descartar(grabacionId, job.ownerId, 'sitio_no_disponible');
    throw new PermanentExecutionError(MENSAJE_RECONECTAR);
  }
  if (!sitio.contextoExternoId || !sitio.proxyRef || !sitio.proxyCountry) {
    await deps.grabaciones.descartar(grabacionId, job.ownerId, 'sitio_no_disponible');
    throw new PermanentExecutionError(MENSAJE_RECONECTAR);
  }

  const contexto = await deps.repo.obtenerContextoDescifrado(connectionId, job.ownerId, deps.vaultSecret);
  if (contexto === null) {
    await deps.grabaciones.descartar(grabacionId, job.ownerId, 'sitio_no_disponible');
    throw new PermanentExecutionError(MENSAJE_RECONECTAR);
  }

  const sesion = await deps.navegador.abrirSesionParaGrabacion({
    contextoExternoId: sitio.contextoExternoId,
    proxyRef: sitio.proxyRef,
    proxyCountry: sitio.proxyCountry,
  });
  control?.alCambiarSesion?.(sesion.sesionExternaId);

  const acumulador = new AcumuladorDeGrabacion(sitio.dominio);
  // El motivo de CORTE vive en un objeto (no en una variable suelta) porque lo escribe el callback de
  // la captura, que corre fuera de este flujo: asi queda explicito que su valor puede cambiar entre dos
  // lineas consecutivas de este handler.
  const estado: { corte: MotivoDescarte | null } = { corte: null };
  let captura: CapturaEnCurso | null = null;

  try {
    // El PAIS de salida se verifica ANTES de mostrarle nada al usuario. Jamas se degrada a otro pais.
    if (sesion.egressCountry !== sitio.proxyCountry) {
      await deps.grabaciones.descartar(grabacionId, job.ownerId, 'sitio_no_disponible');
      throw new SalidaDeRedNoDisponibleError(
        `no hay ruta de red disponible para tu region (pais pineado al dominio ${sitio.dominio}: ` +
          `${sitio.proxyCountry}; pais observado: ${sesion.egressCountry ?? 'ninguno'}); la grabacion ` +
          'NO se abrio y no se degrada a otro pais. Reintenta mas tarde o reconecta el sitio.',
      );
    }

    await deps.navegador.inyectarContexto(sesion.sesionExternaId, contexto);

    // PRE-CHEQUEO DETERMINISTA, el MISMO de la tarea web: si el sitio ya pide login, no se graba nada.
    const urlInicial = `https://${sitio.dominio}/`;
    if (await deps.navegador.detectarPantallaDeLogin(sesion.sesionExternaId, urlInicial)) {
      await deps.grabaciones.descartar(grabacionId, job.ownerId, 'contrasena');
      deps.logger.warn('grabacion descartada antes de empezar: el sitio pide login', {
        jobId: job.id,
        grabacionId,
        dominio: sitio.dominio,
      });
      await deps.guardarResultado(job.id, { estado: 'descartada', grabacionId, motivo: 'contrasena' });
      return;
    }

    captura = await deps.navegador.iniciarCaptura(sesion.sesionExternaId, (crudo) => {
      if (estado.corte !== null) return;
      const evento = parsearEventoCapturado(crudo);
      if (evento === null) return;
      const resultado = acumulador.agregar(evento);
      if (resultado === 'contrasena') estado.corte = 'contrasena';
      else if (resultado === 'excedida') estado.corte = 'demasiados_pasos';
      else if (resultado === 'no_repetible') estado.corte = 'no_repetible';
    });

    // La vista en vivo se publica DESPUES de instalar el grabador: si se publicara antes, el usuario
    // podria empezar a hacer la tarea con la captura todavia sin instalar y perderiamos sus primeros
    // pasos (y, peor, la guardia de contrasena no estaria mirando).
    await deps.grabaciones.publicarVistaEnVivo(grabacionId, job.ownerId, sesion.vistaEnVivoUrl);
    // RESULTADO INTERMEDIO (se sobreescribe con el desenlace final): publica la sesion del proveedor
    // para que el backend pueda acunar el token del relay de teclado movil SOBRE ESTA sesion (la tabla
    // grabaciones no la guarda). Es un metadato, no contenido: el mismo id que ya viaja en los logs.
    await deps.guardarResultado(job.id, {
      estado: 'grabando',
      grabacionId,
      sesionExternaId: sesion.sesionExternaId,
    });
    deps.logger.info('grabacion abierta: el usuario ya puede hacer la tarea', {
      jobId: job.id,
      grabacionId,
      connectionId: sitio.id,
      dominio: sitio.dominio,
      sesionExternaId: sesion.sesionExternaId,
      pais: sesion.egressCountry,
    });

    const limite = ahora() + GRABACION_TIMEOUT_MS;
    let termino = false;
    while (estado.corte === null && !termino) {
      // Terminar el job desde la consola CORTA la grabacion y descarta lo capturado: es lo unico
      // honesto con alguien que acaba de decir "para".
      if (control?.signal?.aborted === true || ahora() >= limite) {
        estado.corte = 'vencida';
        break;
      }
      await esperar(SONDEO_DE_GRABACION_MS);
      if (estado.corte !== null) break;
      // El usuario dijo "ya termine": la transicion la escribio el backend en la propia fila.
      termino = !(await deps.grabaciones.sigueGrabando(grabacionId, job.ownerId));
    }
  } finally {
    if (captura) {
      try {
        await captura.detener();
      } catch (error) {
        deps.logger.warn('grabacion: no se pudo detener la captura (se ignora, best-effort)', {
          jobId: job.id,
          err: describir(error),
        });
      }
    }
    try {
      await deps.navegador.cerrarSesion(sesion.sesionExternaId);
    } catch (error) {
      deps.logger.warn('grabacion: no se pudo cerrar la sesion de navegador (se ignora, best-effort)', {
        jobId: job.id,
        err: describir(error),
      });
    }
    control?.alCambiarSesion?.(null);
  }

  const corte = estado.corte;
  if (corte !== null) {
    // DESCARTE: no se guarda NADA de lo capturado. Es el camino del invariante innegociable cuando el
    // motivo es 'contrasena', y el mismo tratamiento para el resto (no guardamos medias tareas).
    await deps.grabaciones.descartar(grabacionId, job.ownerId, corte);
    deps.logger.warn('grabacion descartada: no se guarda nada de lo capturado', {
      jobId: job.id,
      grabacionId,
      motivo: corte,
    });
    await deps.guardarResultado(job.id, { estado: 'descartada', grabacionId, motivo: corte });
    return;
  }

  const pasos = acumulador.pasos();
  await deps.grabaciones.guardarPasos(grabacionId, job.ownerId, pasos);
  await deps.guardarResultado(job.id, { estado: 'grabada', grabacionId, pasos: pasos.length });
  deps.logger.info('grabacion terminada: pasos guardados a la espera de la revision del usuario', {
    jobId: job.id,
    grabacionId,
    pasos: pasos.length,
  });
}

/**
 * kind:'promover_grabacion': convierte la grabacion terminada en una receta activa, con la MISMA firma
 * de objetivo y el MISMO formato que produce la promocion automatica desde una trayectoria exitosa.
 */
async function promover(
  deps: GrabacionDeps,
  job: Job,
  grabacionId: string,
  variables: MarcadoDeVariable[],
): Promise<void> {
  const grabacion = await deps.grabaciones.obtener(grabacionId, job.ownerId);
  if (!grabacion) {
    throw new PermanentExecutionError(`la grabacion ${grabacionId} no existe o no es del owner del job`);
  }
  if (grabacion.estado !== 'terminada') {
    throw new PermanentExecutionError(
      `la grabacion ${grabacionId} no esta lista para guardarse (estado: ${grabacion.estado})`,
    );
  }

  const promocion = promoverGrabacion({
    pasos: grabacion.pasos,
    descripcion: grabacion.descripcion,
    variables,
  });
  if (!promocion.promovida) {
    deps.logger.warn('grabacion: no se pudo convertir en algo repetible', {
      jobId: job.id,
      grabacionId,
      motivo: promocion.motivo,
    });
    throw new PermanentExecutionError(
      'lo que grabaste no se puede repetir tal cual; volve a grabarlo con calma y marca los datos que cambian cada vez',
    );
  }

  // Los valores marcados como variables se BORRAN de la grabacion ANTES de crear la receta: si la
  // creacion fallara, el dato tampoco queda persistido.
  await deps.grabaciones.guardarPasos(grabacionId, job.ownerId, promocion.grabados);

  // La FIRMA sale de la descripcion que dio el usuario, con el MISMO mecanismo que la promocion
  // automatica (firmaDeObjetivo): una sola funcion para las dos vias, si no, se podria sembrar una
  // receta bajo una firma y buscarla despues con otra.
  const receta = await deps.recetas.promover({
    ownerId: job.ownerId,
    dominio: grabacion.dominio,
    firmaObjetivo: firmaDeObjetivo(grabacion.descripcion),
    // La DESCRIPCION en palabras del usuario viaja tal cual (V037): es lo que la consola muestra y lo
    // que permite RECONOCER esta tarea cuando la pida con otras palabras y la firma no coincida. No
    // interviene en la ejecucion: los pasos se ejecutan con la misma verificacion y la misma politica.
    descripcion: grabacion.descripcion,
    pasos: promocion.pasos,
    creadaDesdeTrayectoria: null,
    origen: 'grabacion',
  });

  await deps.guardarResultado(job.id, {
    estado: 'ok',
    grabacionId,
    recetaId: receta?.id ?? null,
    via: 'grabacion',
  });
  deps.logger.info('grabacion guardada: la proxima vez la tarea se hace sola', {
    jobId: job.id,
    grabacionId,
    dominio: grabacion.dominio,
    recetaId: receta?.id ?? null,
    pasos: promocion.pasos.length,
    variables: variables.length,
  });
}

/**
 * Punto de entrada de los jobs de grabacion: parsea el payload (ya discriminado por kind) y despacha.
 * Lanza en fallo (execution.ts decide el cierre); el llamador marca completed.
 */
export async function procesarJobDeGrabacion(
  deps: GrabacionDeps | undefined,
  job: Job,
  control?: ControlDeGrabacion,
): Promise<void> {
  if (!deps) {
    throw new PermanentExecutionError(
      'la grabacion de tareas no esta configurada en este worker: faltan BROWSERBASE_API_KEY y/o ' +
        'BROWSERBASE_PROJECT_ID en el entorno',
    );
  }
  const parsed = parseGrabacionJobPayload(job.payload);
  if (!parsed.success) {
    throw new PermanentExecutionError(`payload de grabacion invalido: ${parsed.error}`);
  }
  const payload = parsed.data;
  switch (payload.kind) {
    case GRABAR_TAREA_JOB_KIND:
      return grabarTarea(deps, job, payload.connectionId, payload.grabacionId, control);
    case PROMOVER_GRABACION_JOB_KIND:
      return promover(deps, job, payload.grabacionId, payload.variables);
  }
}
