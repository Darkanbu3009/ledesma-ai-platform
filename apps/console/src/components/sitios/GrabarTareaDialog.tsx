import { useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, GraduationCap, Loader2, ShieldCheck, X } from 'lucide-react';
import { useDialog } from '../ui/useDialog';
import {
  TIPOS_DE_DATO,
  pasosConDatos,
  variablesDesdeMarcado,
  type Grabacion,
  type TipoDeDato,
} from '../../lib/grabaciones';

/**
 * Modal de ENSENARLE UNA TAREA al sistema. Tres momentos, un solo dialogo:
 *
 *  1. El usuario escribe en lenguaje llano que va a ensenar.
 *  2. Se abre la vista en vivo (el MISMO iframe directo al navegador seguro que usa el inicio de
 *     sesion) y el usuario hace la tarea como la haria normalmente, hasta que presiona "Ya termine".
 *  3. Se le muestran los datos que escribio y marca cuales cambian cada vez; al guardar, el sistema
 *     ya puede repetir la tarea sola.
 *
 * PRINCIPIO NO NEGOCIABLE: aqui no se inicia sesion. El modal solo se abre sobre un sitio que ya esta
 * conectado, y si aparece un campo de contrasena la grabacion se detiene y no se guarda nada (el
 * estado llega en la propia grabacion y este componente lo dice con todas sus letras).
 *
 * VOCABULARIO: todo lo que se ve esta escrito para alguien que no es tecnico. No aparece ningun
 * termino de implementacion, y los tipos de dato se ofrecen como "Para quien es", "El asunto", "El
 * monto"..., nunca como el nombre interno del parametro.
 *
 * Sin efectos: los tres momentos se DERIVAN de la grabacion que llega por props (que la pagina obtiene
 * con polling de react-query). Lo unico que este componente guarda en estado es lo que el usuario esta
 * escribiendo o marcando.
 */
export function GrabarTareaDialog({
  dominio,
  grabacion,
  abriendo,
  guardada,
  error,
  onComenzar,
  onTerminar,
  onGuardar,
  onCerrar,
  ocupado,
}: {
  dominio: string;
  /** La grabacion en curso, o null mientras el usuario todavia esta describiendo la tarea. */
  grabacion: Grabacion | null;
  /** true mientras se espera a que la vista en vivo este lista. */
  abriendo: boolean;
  /** true cuando la tarea ya quedo guardada (ultimo momento del flujo). */
  guardada: boolean;
  /** Mensaje de error a mostrar dentro del modal, o null. */
  error: string | null;
  onComenzar: (descripcion: string) => void;
  onTerminar: () => void;
  onGuardar: (variables: Array<{ idx: number; marcador: TipoDeDato }>) => void;
  onCerrar: () => void;
  /** true mientras una de las acciones esta en vuelo (deshabilita los botones). */
  ocupado: boolean;
}) {
  const { t } = useTranslation();
  // El foco inicial va al campo donde el usuario escribe que va a ensenar. En los momentos en que ese
  // campo no existe, el ref queda vacio y useDialog cae a su comportamiento por defecto (primer
  // elemento enfocable del dialogo).
  const primerFoco = useRef<HTMLTextAreaElement>(null);
  const dialogRef = useDialog({ onClose: onCerrar, initialFocus: primerFoco });

  const [descripcion, setDescripcion] = useState('');
  const [descripcionError, setDescripcionError] = useState<string | null>(null);
  /** Marcado del usuario: indice del paso -> tipo de dato. Ausente = el dato es siempre el mismo. */
  const [marcado, setMarcado] = useState<Record<number, TipoDeDato | undefined>>({});

  const enVivo = grabacion?.estado === 'grabando' && grabacion.vistaEnVivoUrl !== null;
  const detenidaPorContrasena =
    grabacion?.estado === 'descartada' && grabacion.motivo === 'contrasena';
  const descartada = grabacion?.estado === 'descartada' && !detenidaPorContrasena;
  const aRevisar = grabacion?.estado === 'terminada' && !guardada;
  const datos = pasosConDatos(grabacion ?? undefined);

  function handleComenzar(evento: FormEvent) {
    evento.preventDefault();
    const limpia = descripcion.trim();
    if (limpia === '') {
      setDescripcionError(t('grabacion.descripcionRequerida'));
      return;
    }
    setDescripcionError(null);
    onComenzar(limpia);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-6">
      <div className="absolute inset-0 bg-ink/40" onClick={onCerrar} aria-hidden="true" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="grabar-tarea-title"
        className={[
          'relative flex w-full flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-card-hover',
          // Con la vista en vivo el modal ocupa la pantalla casi entera (el iframe necesita alto real,
          // igual que el del inicio de sesion); en el resto de los momentos es un dialogo normal.
          enVivo
            ? 'h-[96vh] max-w-[1400px] sm:h-[92vh] sm:w-[90vw]'
            : 'max-h-[90vh] max-w-[560px] overflow-y-auto',
        ].join(' ')}
      >
        <div className="flex flex-none items-start justify-between gap-4 border-b border-line-soft px-6 py-4">
          <div className="min-w-0">
            <h2 id="grabar-tarea-title" className="truncate font-display text-lg font-bold text-ink">
              {t('grabacion.titulo', { dominio })}
            </h2>
            <p className="mt-1 flex items-start gap-1.5 text-sm text-muted">
              <ShieldCheck className="mt-0.5 h-4 w-4 flex-none text-ok" aria-hidden="true" />
              <span>{t('grabacion.ayuda')}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onCerrar}
            aria-label={t('grabacion.cerrarAria')}
            className="flex h-8 w-8 flex-none items-center justify-center rounded-lg text-muted transition hover:bg-line-soft hover:text-ink"
          >
            <X className="h-[18px] w-[18px]" />
          </button>
        </div>

        {/* MOMENTO 1: que le vas a ensenar. */}
        {grabacion === null && !abriendo && (
          <form onSubmit={handleComenzar} className="flex flex-col gap-4 px-6 py-5" noValidate>
            <label htmlFor="grabacion-descripcion" className="text-sm font-medium text-ink">
              {t('grabacion.descripcion')}
            </label>
            <textarea
              id="grabacion-descripcion"
              ref={primerFoco}
              value={descripcion}
              onChange={(evento) => {
                setDescripcion(evento.target.value);
                setDescripcionError(null);
              }}
              rows={3}
              placeholder={t('grabacion.descripcionPlaceholder')}
              className="w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-sm text-ink outline-none transition focus:border-brasa"
            />
            {descripcionError && (
              <p role="alert" className="text-sm text-brasa">
                {descripcionError}
              </p>
            )}
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={ocupado}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-brasa px-[22px] py-2.5 text-sm font-semibold text-white shadow-[0_1px_2px_rgba(31,30,28,0.10)] transition hover:bg-brasa-hover disabled:cursor-not-allowed disabled:opacity-60"
              >
                {ocupado ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <GraduationCap className="h-4 w-4" />
                )}
                {t('grabacion.comenzar')}
              </button>
            </div>
          </form>
        )}

        {/* Mientras el navegador seguro se abre. */}
        {(abriendo || (grabacion?.estado === 'grabando' && !enVivo)) && (
          <div
            role="status"
            className="flex items-center gap-2.5 px-6 py-6 text-sm text-muted"
          >
            <Loader2 className="h-4 w-4 flex-none animate-spin text-brasa" />
            {t('grabacion.abriendo', { dominio })}
          </div>
        )}

        {/* MOMENTO 2: la vista en vivo. El iframe apunta DIRECTO al navegador seguro; esta consola no
            adjunta ningun listener sobre el, igual que en el inicio de sesion. */}
        {enVivo && grabacion?.vistaEnVivoUrl && (
          <>
            <iframe
              src={grabacion.vistaEnVivoUrl}
              title={t('grabacion.iframeTitulo', { dominio })}
              className="min-h-[120px] w-full flex-1 border-0 bg-ink/5"
              allow="clipboard-read; clipboard-write"
            />
            <div className="flex-none border-t border-line-soft px-6 py-4">
              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-muted-soft">{t('grabacion.pie')}</p>
                <button
                  type="button"
                  onClick={onTerminar}
                  disabled={ocupado}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-brasa px-[22px] py-2.5 text-sm font-semibold text-white shadow-[0_1px_2px_rgba(31,30,28,0.10)] transition hover:bg-brasa-hover disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {ocupado && <Loader2 className="h-4 w-4 animate-spin" />}
                  {ocupado ? t('grabacion.terminando') : t('grabacion.terminar')}
                </button>
              </div>
            </div>
          </>
        )}

        {/* MOMENTO 3: que datos cambian cada vez. */}
        {aRevisar && (
          <div className="flex flex-col gap-4 px-6 py-5">
            <div>
              <h3 className="font-display text-[15px] font-bold text-ink">
                {t('grabacion.marcarVariables')}
              </h3>
              <p className="mt-1 text-[13px] text-muted">{t('grabacion.marcarAyuda')}</p>
            </div>
            {datos.length === 0 ? (
              <p className="text-sm text-muted">{t('grabacion.sinDatos')}</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {datos.map((paso) => (
                  <li
                    key={paso.idx}
                    className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-3.5 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <span className="min-w-0 break-words text-sm text-ink">{paso.valor}</span>
                    <label className="sr-only" htmlFor={`grabacion-dato-${paso.idx}`}>
                      {t('grabacion.marcarVariables')}
                    </label>
                    <select
                      id={`grabacion-dato-${paso.idx}`}
                      value={marcado[paso.idx] ?? ''}
                      onChange={(evento) =>
                        setMarcado((previo) => ({
                          ...previo,
                          [paso.idx]:
                            evento.target.value === ''
                              ? undefined
                              : (evento.target.value as TipoDeDato),
                        }))
                      }
                      className="flex-none rounded-[10px] border border-line bg-surface px-3 py-2 text-[13px] text-ink outline-none transition focus:border-brasa"
                    >
                      <option value="">{t('grabacion.datoFijo')}</option>
                      {TIPOS_DE_DATO.map((tipo) => (
                        <option key={tipo} value={tipo}>
                          {t(`grabacion.tipos.${tipo}`)}
                        </option>
                      ))}
                    </select>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={onCerrar}
                className="inline-flex items-center justify-center rounded-xl border border-line px-4 py-2.5 text-sm font-medium text-muted transition hover:text-ink"
              >
                {t('grabacion.cancelar')}
              </button>
              <button
                type="button"
                onClick={() => onGuardar(variablesDesdeMarcado(marcado))}
                disabled={ocupado}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-brasa px-[22px] py-2.5 text-sm font-semibold text-white shadow-[0_1px_2px_rgba(31,30,28,0.10)] transition hover:bg-brasa-hover disabled:cursor-not-allowed disabled:opacity-60"
              >
                {ocupado && <Loader2 className="h-4 w-4 animate-spin" />}
                {ocupado ? t('grabacion.guardando') : t('grabacion.guardar')}
              </button>
            </div>
          </div>
        )}

        {/* CIERRE FELIZ. */}
        {guardada && (
          <div className="flex flex-col gap-4 px-6 py-6">
            <p className="flex items-start gap-2 text-sm font-medium text-ink">
              <CheckCircle2 className="mt-0.5 h-4 w-4 flex-none text-ok" aria-hidden="true" />
              {t('grabacion.guardada')}
            </p>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={onCerrar}
                className="inline-flex items-center justify-center rounded-xl bg-brasa px-[22px] py-2.5 text-sm font-semibold text-white transition hover:bg-brasa-hover"
              >
                {t('sitios.comunes.entendido')}
              </button>
            </div>
          </div>
        )}

        {/* EL INVARIANTE, dicho de frente: aparecio un campo de contrasena y no se guardo nada. */}
        {(detenidaPorContrasena || descartada) && (
          <div className="flex flex-col gap-4 px-6 py-6">
            <p role="alert" className="rounded-xl border border-brasa-line bg-brasa-soft px-4 py-3 text-sm font-medium text-brasa">
              {detenidaPorContrasena
                ? t('grabacion.detenidaPorContrasena')
                : t('grabacion.descartada')}
            </p>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={onCerrar}
                className="inline-flex items-center justify-center rounded-xl bg-brasa px-[22px] py-2.5 text-sm font-semibold text-white transition hover:bg-brasa-hover"
              >
                {t('sitios.comunes.entendido')}
              </button>
            </div>
          </div>
        )}

        {error && (
          <div className="px-6 pb-5">
            <p role="alert" className="rounded-xl border border-brasa-line bg-brasa-soft px-4 py-3 text-sm font-medium text-brasa">
              {error}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
