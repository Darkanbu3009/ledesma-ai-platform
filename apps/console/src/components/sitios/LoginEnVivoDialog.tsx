import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, ShieldCheck, TriangleAlert, X } from 'lucide-react';
import type { SitioConectado } from '../../lib/sitios';
import { useDialog } from '../ui/useDialog';

/**
 * Modal de la VISTA EN VIVO del login (7.1c): un iframe que apunta DIRECTO a la vista en vivo del
 * proveedor del navegador remoto (Browserbase), donde el usuario inicia sesion EL MISMO en el sitio.
 * Accesible via el hook compartido useDialog (trampa de foco, Escape, retorno del foco al cerrar),
 * el mismo patron del modal de triggers (5.4b).
 *
 * RESTRICCION DURA: la contrasena del usuario JAMAS toca el backend ni el dominio de Ledesma. Se
 * teclea dentro del iframe, contra el proveedor. Por eso aqui NO hay ningun input (menos aun de
 * contrasena) y NO se adjunta NINGUN listener sobre el iframe (ni load, ni message, ni nada): esta
 * consola no puede leer, interceptar ni reenviar lo que ocurre alli dentro, por construccion.
 *
 * LIMITACION EN TELEFONOS: la vista en vivo de Browserbase no soporta el teclado movil ("Mobile
 * keyboards aren't officially supported", doc de Session Live View). El tap si llega como click a la
 * sesion remota, pero como no existe ningun campo editable LOCAL que enfocar, el sistema operativo
 * jamas despliega su teclado: no es un problema de este iframe ni de sus estilos, y abrir la vista
 * en pestana propia tampoco lo resuelve. El unico workaround documentado (teclado virtual propio que
 * reenvia las teclas a la sesion) capturaria lo que el usuario teclea y viola la restriccion de
 * arriba, asi que queda descartado. Mientras el proveedor no lo soporte, en dispositivos tactiles
 * sin puntero fino se muestra un aviso pidiendo completar la conexion desde una computadora.
 */
export function LoginEnVivoDialog({
  sitio,
  confirmando,
  error,
  onConfirmar,
  onCerrar,
}: {
  sitio: SitioConectado;
  /** true mientras POST /confirmar esta en vuelo (deshabilita el boton). */
  confirmando: boolean;
  /** Mensaje de error si la confirmacion fallo. */
  error: string | null;
  onConfirmar: () => void;
  onCerrar: () => void;
}) {
  const { t } = useTranslation();
  const confirmarRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useDialog({ onClose: onCerrar, initialFocus: confirmarRef });

  // Dispositivo tactil sin puntero fino ni hover (telefono/tablet): ahi el teclado movil no
  // funciona dentro de la vista en vivo (limitacion del proveedor, ver arriba). Se evalua en el
  // render (sin estado ni efectos): el medio no cambia durante la vida del modal, y el guard de
  // matchMedia cubre los entornos de test sin esa API (mismo criterio que use-reveal-on-scroll).
  const esDispositivoTactil =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(hover: none) and (pointer: coarse)').matches;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-6">
      <div className="absolute inset-0 bg-ink/40" onClick={onCerrar} aria-hidden="true" />
      {/* El modal ocupa la pantalla casi completa (hasta 90vw/1400px en desktop) con ALTURA FIJA:
          asi el iframe (flex-1) recibe todo el alto restante y la vista en vivo se ve grande. El
          tamano del CONTENIDO remoto lo gobierna el viewport de la sesion (LOGIN_VIEWPORT del
          worker), no este CSS: agrandar solo el iframe fue el intento previo que no surtio efecto. */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="login-en-vivo-title"
        className="relative flex h-[96vh] w-full max-w-[1400px] flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-card-hover sm:h-[92vh] sm:w-[90vw]"
      >
        <div className="flex flex-none items-start justify-between gap-4 border-b border-line-soft px-6 py-4">
          <div className="min-w-0">
            <h2 id="login-en-vivo-title" className="truncate font-display text-lg font-bold text-ink">
              {t('sitios.modal.titulo', { dominio: sitio.dominio })}
            </h2>
            <p className="mt-1 flex items-start gap-1.5 text-sm text-muted">
              <ShieldCheck className="mt-0.5 h-4 w-4 flex-none text-ok" aria-hidden="true" />
              <span>{t('sitios.modal.instruccion')}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onCerrar}
            aria-label={t('sitios.modal.cerrarAria')}
            className="flex h-8 w-8 flex-none items-center justify-center rounded-lg text-muted transition hover:bg-line-soft hover:text-ink"
          >
            <X className="h-[18px] w-[18px]" />
          </button>
        </div>

        {/* Aviso SOLO en dispositivos tactiles: la vista sigue visible (el usuario ve la pagina de
            login y puede tocarla), pero sin teclado movil no puede escribir; se le pide terminar
            desde una computadora. No es un error de esta sesion, por eso role="note" y no alert. */}
        {esDispositivoTactil && (
          <div role="note" className="flex-none border-b border-brasa-line bg-brasa-soft px-6 py-3">
            <p className="flex items-start gap-1.5 text-sm font-medium text-brasa">
              <TriangleAlert className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" />
              <span>{t('sitios.modal.avisoMovil')}</span>
            </p>
          </div>
        )}

        {/* La vista en vivo EMBEBIDA: apunta directo al proveedor. Sin listeners, por diseno.
            flex-1: llena TODO el alto que el modal (de altura fija) deja entre la cabecera y el
            pie; en un desktop tipico (ventana >= ~840px de alto) eso ya supera los 600px pedidos.
            El aviso de seguridad (cabecera) y el boton de confirmar (pie) son flex-none y mandan:
            el piso del iframe es DELIBERADAMENTE bajo (solo evita el colapso total si cabecera o
            pie crecieran, p.ej. con el alert de error) para que en pantallas bajas -- telefono
            apaisado incluido -- el iframe ceda y JAMAS los empuje fuera del overflow-hidden. */}
        <iframe
          src={sitio.vistaEnVivoUrl ?? undefined}
          title={t('sitios.modal.iframeTitulo', { dominio: sitio.dominio })}
          className="min-h-[120px] w-full flex-1 border-0 bg-ink/5"
          allow="clipboard-read; clipboard-write"
        />

        <div className="flex-none border-t border-line-soft px-6 py-4">
          {error && (
            <div
              role="alert"
              className="mb-3 rounded-xl border border-brasa-line bg-brasa-soft px-4 py-3 text-sm font-medium text-brasa"
            >
              {error}
            </div>
          )}
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted-soft">{t('sitios.modal.pie')}</p>
            <button
              ref={confirmarRef}
              type="button"
              onClick={onConfirmar}
              disabled={confirmando}
              className="inline-flex items-center justify-center gap-2 rounded-[10px] bg-brasa px-[22px] py-2.5 text-sm font-semibold text-white shadow-[0_1px_2px_rgba(31,30,28,0.10)] transition hover:bg-brasa-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              {confirmando && <Loader2 className="h-4 w-4 animate-spin" />}
              {confirmando ? t('sitios.modal.confirmando') : t('sitios.modal.confirmar')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
