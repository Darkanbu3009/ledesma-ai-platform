import { useRef, useState, type FormEvent } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useDialog } from '../ui/useDialog';
import { Field, inputClass } from '../ui/Field';
import { emailConfirmationMatches } from '../../lib/account';

/**
 * MODAL DE CONFIRMACION FUERTE del borrado de cuenta -- el punto de UX de esta pieza. Mas fuerte que los
 * otros dialogos destructivos (DeleteCredentialDialog, etc.): no basta con un click, el usuario debe
 * ESCRIBIR su propio email. El boton "Eliminar definitivamente" esta DESHABILITADO hasta que el email
 * escrito coincide (normalizado trim+lowercase, misma regla que el backend) con `expectedEmail`. Esto hace
 * IMPOSIBLE el borrado accidental: exige una accion deliberada. Es UX que COMPLEMENTA la validacion
 * server-side (que ya revalida el email); nunca la reemplaza.
 *
 * El email objetivo se muestra SIEMPRE como texto visible y persistente (no solo como placeholder, que
 * desaparece al teclear): el usuario tiene la referencia exacta a la vista mientras escribe y cuando falla.
 *
 * Se monta CONDICIONALMENTE (el padre lo renderiza solo cuando abre), asi el input arranca vacio cada vez.
 * Accesible via useDialog: trampa de foco, cierra con Escape o click en el fondo, enfoca "Cancelar" al abrir
 * (la salida facil, nunca el boton destructivo) y devuelve el foco al disparador al cerrar. El dialogo
 * describe sus consecuencias (aria-describedby) para que un lector de pantalla las anuncie al abrir.
 *
 * BLOQUEO DURANTE EL BORRADO: mientras la peticion esta en curso (busy) el modal NO se puede cerrar (Escape,
 * fondo ni Cancelar). El borrado es IRREVERSIBLE y la peticion no se puede abortar, asi que permitir
 * "cancelar" a mitad seria enganoso: la cuenta se borra igual y el usuario seria deslogueado por sorpresa.
 */
export function DeleteAccountDialog({
  expectedEmail,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  /** Email de la cuenta (useAuth().user?.email): el valor que el usuario debe reproducir para confirmar. */
  expectedEmail: string | undefined;
  busy: boolean;
  /** Mensaje de error del backend (p.ej. 400 email no coincide) para mostrarlo dentro del modal. */
  error?: string;
  onConfirm: (confirmEmail: string) => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Cierre GUARDADO por `busy`: no se cierra mientras el borrado corre. useDialog lee onClose por ref en
  // cada render, asi que este guard siempre ve el `busy` actual (aplica a Escape, al fondo y a Cancelar).
  function handleClose() {
    if (busy) return;
    onCancel();
  }

  const dialogRef = useDialog({ onClose: handleClose, initialFocus: cancelRef });
  const [typed, setTyped] = useState('');

  const matches = emailConfirmationMatches(typed, expectedEmail);
  const canConfirm = matches && !busy;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canConfirm) return;
    // Enviamos el email escrito (recortado). El backend lo revalida y normaliza; esta barrera es UX.
    onConfirm(typed.trim());
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-ink/40" onClick={handleClose} aria-hidden="true" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-account-title"
        aria-describedby="delete-account-desc"
        className="relative w-full max-w-md rounded-2xl border border-brasa-line bg-surface p-6 shadow-card-hover"
      >
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 flex-none items-center justify-center rounded-full bg-brasa-soft text-brasa">
            <AlertTriangle className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h2 id="delete-account-title" className="font-display text-lg font-bold text-ink">
              Eliminar tu cuenta
            </h2>
            <p id="delete-account-desc" className="mt-1 text-sm text-muted">
              Esta acción es <span className="font-semibold text-ink">permanente e irreversible</span>. Se
              borrará <span className="font-semibold text-ink">todo</span>: tus agentes, credenciales,
              recetas, tareas programadas, triggers e historial de actividad. No podremos recuperarlo.
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} noValidate className="mt-5">
          {/* El email objetivo SIEMPRE visible (no solo placeholder): referencia exacta mientras se escribe. */}
          <div className="mb-3 rounded-xl border border-line bg-field px-4 py-3 text-sm">
            <span className="text-muted">Email de tu cuenta: </span>
            <span className="select-all break-all font-mono font-medium text-ink">
              {expectedEmail ?? '—'}
            </span>
          </div>
          <Field
            label="Para confirmar, escribe tu email"
            hint={
              matches
                ? undefined
                : 'El botón se habilita cuando el email coincide exactamente con el de tu cuenta.'
            }
          >
            {(field) => (
              <input
                {...field}
                type="email"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                placeholder={expectedEmail ?? 'tu@email.com'}
                className={inputClass}
              />
            )}
          </Field>

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
              ref={cancelRef}
              type="button"
              onClick={handleClose}
              disabled={busy}
              className="rounded-[10px] border border-line bg-surface px-4 py-2 text-sm font-medium text-muted transition hover:border-ink-soft hover:text-ink disabled:cursor-not-allowed disabled:opacity-60"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!canConfirm}
              aria-disabled={!canConfirm}
              className="rounded-[10px] bg-brasa px-4 py-2 text-sm font-semibold text-white transition hover:bg-brasa-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? 'Eliminando...' : 'Eliminar definitivamente'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
