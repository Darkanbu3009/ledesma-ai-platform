import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { useDialog } from '../ui/useDialog';
import { opcionesDePais, paisDelNavegador } from '../../lib/paises';

/**
 * Captura del PAIS del usuario antes de su PRIMERA conexion de sitio (se muestra solo si
 * profiles.pais es null). El pais pinea la geolocalizacion del proxy: los agentes navegan desde el
 * pais del usuario para que los sitios no invaliden sus sesiones por saltos geograficos. Se pide UNA
 * vez: al guardarse queda en el perfil (PATCH /v1/me/profile) y no se vuelve a pedir; despues es
 * editable en la configuracion del perfil.
 *
 * Selector con la lista COMPLETA ISO 3166-1 (nombres localizados via Intl.DisplayNames, ordenados
 * por el collator del idioma activo): sirve a usuarios de CUALQUIER pais, ninguno privilegiado. La
 * unica preseleccion es la SUGERENCIA derivada del navegador (paisDelNavegador), que el usuario
 * confirma o cambia; si no es derivable, arranca sin seleccion y el boton queda deshabilitado.
 * Mismo patron accesible que DesconectarSitioDialog (useDialog): trampa de foco, Escape, click en
 * el fondo y foco de vuelta.
 */
export function SeleccionPaisDialog({
  open,
  busy,
  error,
  onGuardar,
  onCancelar,
}: {
  open: boolean;
  /** true mientras el PATCH del perfil esta en vuelo (deshabilita guardar). */
  busy: boolean;
  /** Mensaje de error del guardado (ya traducido), o null. */
  error: string | null;
  /** Recibe el codigo ISO-2 elegido; el llamador guarda y continua la conexion. */
  onGuardar: (codigo: string) => void;
  onCancelar: () => void;
}) {
  const { t, i18n } = useTranslation();
  const selectRef = useRef<HTMLSelectElement>(null);
  const dialogRef = useDialog({ open, onClose: onCancelar, initialFocus: selectRef });
  // Preseleccion: la sugerencia del navegador ('' = sin seleccion). Estado inicial perezoso: se
  // calcula una vez al montar; el usuario tiene la ultima palabra.
  const [codigo, setCodigo] = useState(() => paisDelNavegador() ?? '');

  if (!open) return null;

  const opciones = opcionesDePais(i18n.language);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-ink/40" onClick={onCancelar} aria-hidden="true" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('sitios.paisDialog.titulo')}
        className="relative w-full max-w-sm rounded-2xl border border-line bg-surface p-6 shadow-card-hover"
      >
        <h2 className="font-display text-lg font-bold text-ink">{t('sitios.paisDialog.titulo')}</h2>
        <p className="mt-2 text-sm text-muted">{t('sitios.paisDialog.porQue')}</p>
        <label htmlFor="pais-perfil" className="mt-4 block text-sm font-medium text-ink">
          {t('sitios.paisDialog.label')}
        </label>
        <select
          id="pais-perfil"
          ref={selectRef}
          value={codigo}
          onChange={(e) => setCodigo(e.target.value)}
          className="mt-1.5 h-11 w-full rounded-xl border border-line bg-field px-3 text-sm text-ink focus:border-brasa-line focus:outline-none"
        >
          <option value="" disabled>
            {t('sitios.paisDialog.placeholder')}
          </option>
          {opciones.map((opcion) => (
            <option key={opcion.codigo} value={opcion.codigo}>
              {opcion.nombre}
            </option>
          ))}
        </select>
        <p className="mt-2 text-xs text-muted">{t('sitios.paisDialog.editableDespues')}</p>
        {error && (
          <div
            role="alert"
            className="mt-4 rounded-xl border border-brasa-line bg-brasa-soft px-4 py-3 text-sm font-medium text-brasa"
          >
            {error}
          </div>
        )}
        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancelar}
            className="rounded-[10px] border border-line bg-surface px-4 py-2 text-sm font-medium text-muted transition hover:border-ink-soft hover:text-ink"
          >
            {t('sitios.comunes.cancelar')}
          </button>
          <button
            type="button"
            onClick={() => codigo !== '' && onGuardar(codigo)}
            disabled={busy || codigo === ''}
            className="inline-flex items-center gap-2 rounded-[10px] bg-brasa px-4 py-2 text-sm font-semibold text-white transition hover:bg-brasa-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {busy ? t('sitios.paisDialog.guardando') : t('sitios.paisDialog.guardar')}
          </button>
        </div>
      </div>
    </div>
  );
}
