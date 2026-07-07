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
 * Se monta CONDICIONALMENTE (el padre lo renderiza solo cuando abre), asi el input arranca vacio cada vez.
 * Accesible via useDialog: trampa de foco, cierra con Escape o click en el fondo, enfoca "Cancelar" al abrir
 * (la salida facil, nunca el boton destructivo) y devuelve el foco al disparador al cerrar.
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
  const dialogRef = useDialog({ onClose: onCancel, initialFocus: cancelRef });
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
      <div className="absolute inset-0 bg-ink/40" onClick={onCancel} aria-hidden="true" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-account-title"
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
            <p className="mt-1 text-sm text-muted">
              Esta acción es <span className="font-semibold text-ink">permanente e irreversible</span>. Se
              borrará <span className="font-semibold text-ink">todo</span>: tus agentes, credenciales,
              recetas, tareas programadas, triggers e historial de actividad. No podremos recuperarlo.
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} noValidate className="mt-5">
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
              onClick={onCancel}
              className="rounded-[10px] border border-line bg-surface px-4 py-2 text-sm font-medium text-muted transition hover:border-ink-soft hover:text-ink"
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
