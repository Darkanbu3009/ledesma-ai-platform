import { parsearDetencion, type DetencionDeVerificacion } from '@ledesma-platform/shared/verificacion';
import i18n from '../i18n';
import type { JobActivity } from './jobs';

/**
 * POLITICA DE EJECUCION y DETENCIONES en la consola. Dos cosas, una sola idea: los limites que el
 * usuario configura UNA vez (GET/PUT /v1/politicas-ejecucion) y el texto legible de una tarea que se
 * detuvo antes de ejecutar una accion que no se puede deshacer.
 *
 * El contrato de la detencion (prefijo y motivos) vive en shared y lo produce el worker: aqui solo
 * se traduce. Si el motivo no se reconoce o el last_error llego truncado, se cae al mensaje de error
 * generico de siempre; jamas se inventa una explicacion.
 *
 * Modulo sin React ni red: se testea como funcion pura, igual que jobs.ts.
 */

/** Los tres ajustes tal como los devuelve y acepta el backend. */
export interface PoliticaEjecucion {
  ejecutarAccionesIrreversibles: boolean;
  topeMontoSinConfirmacion: number;
  sitiosExcluidos: string[];
  /** false = el usuario nunca la configuro y estos son los defaults. */
  configurada: boolean;
}

/** Lo que el formulario envia (los tres ajustes, sin la marca de configurada). */
export type PoliticaEjecucionInput = Omit<PoliticaEjecucion, 'configurada'>;

/** Texto listo para pintar: titulo comun y detalle propio de cada motivo. */
export interface TextoDeDetencion {
  titulo: string;
  detalle: string;
}

/**
 * La detencion de un job, si termino detenido antes de ejecutar. null si el job no es una detencion
 * (o si su last_error no se puede interpretar).
 */
export function detencionDeJob(
  job: Pick<JobActivity, 'status' | 'lastError'>,
): DetencionDeVerificacion | null {
  if (job.status !== 'failed') return null;
  return parsearDetencion(job.lastError);
}

/** Valor a interpolar cuando el sitio no mostraba nada con que comparar. */
function oNada(valor: string | undefined): string {
  return valor === undefined || valor.trim() === '' ? i18n.t('verificacion.nada') : valor;
}

/**
 * Traduce la detencion a un texto para alguien NO tecnico: que se pidio, que se encontro y que
 * hacer. Nunca menciona campos, selectores, tareas en cola ni nada del mecanismo.
 */
export function textoDeDetencion(detencion: DetencionDeVerificacion): TextoDeDetencion {
  const titulo = i18n.t('verificacion.noCoincide.titulo');
  switch (detencion.motivo) {
    case 'noCoincide':
      return {
        titulo,
        detalle: i18n.t('verificacion.noCoincide.detalle', {
          pedido: oNada(detencion.pedido),
          encontrado: oNada(detencion.encontrado),
        }),
      };
    case 'noLeible':
      // El dato no se pudo LEER del sitio: se dice eso, jamas "en el sitio aparecia nada" (ese
      // era el diagnostico falso de la evidencia de produccion). SIN campo, lo ilegible fue LA
      // PAGINA entera (una sesion de navegador degradada): culpar a un dato del usuario mandaba a
      // diagnosticar lo que no fue, asi que se dice que la pagina no se pudo leer y que se puede
      // reintentar.
      if (detencion.campo === undefined) {
        return { titulo, detalle: i18n.t('verificacion.noLeible.pagina') };
      }
      return {
        titulo,
        detalle: i18n.t('verificacion.noLeible.detalle', {
          campo: i18n.t(`verificacion.campos.${detencion.campo}`),
        }),
      };
    case 'faltaDato':
      return {
        titulo,
        detalle: i18n.t('verificacion.faltaDato.detalle', {
          campo: i18n.t(`verificacion.campos.${detencion.campo ?? 'destinatario'}`),
        }),
      };
    case 'topeExcedido':
      return {
        titulo,
        detalle: i18n.t('politica.topeExcedido.detalle', {
          monto: oNada(detencion.monto),
          tope: oNada(detencion.tope),
        }),
      };
    case 'sitioExcluido':
      return {
        titulo,
        detalle: i18n.t('politica.sitioExcluido.detalle', { dominio: oNada(detencion.dominio) }),
      };
    case 'accionesDesactivadas':
      return { titulo, detalle: i18n.t('politica.accionesDesactivadas.detalle') };
    case 'otraAccion':
      return { titulo, detalle: i18n.t('verificacion.otraAccion.detalle') };
    case 'politicaNoDisponible':
      return { titulo, detalle: i18n.t('politica.noDisponible.detalle') };
    case 'sinEvidenciaParaComparar':
      // El sistema no pudo comprobar NADA antes de una accion que no se puede deshacer: no reconocio
      // que se pedia, o lo pedido no traia ningun dato que se pueda buscar en la pagina. Se dice eso
      // y que hacer, sin nombrar verbos, campos ni mecanica interna.
      return { titulo, detalle: i18n.t('verificacion.sinEvidencia.detalle') };
  }
}

/**
 * Convierte el campo de texto de sitios excluidos (separados por comas o saltos de linea) en la
 * lista que espera el backend. El backend vuelve a normalizar y valida: esto es solo comodidad.
 */
export function parsearSitiosExcluidos(texto: string): string[] {
  const sitios: string[] = [];
  for (const crudo of texto.split(/[,\n;]/)) {
    const sitio = crudo.trim().toLowerCase();
    if (sitio !== '' && !sitios.includes(sitio)) sitios.push(sitio);
  }
  return sitios;
}

/** La lista de sitios como texto editable. */
export function formatearSitiosExcluidos(sitios: string[]): string {
  return sitios.join(', ');
}
