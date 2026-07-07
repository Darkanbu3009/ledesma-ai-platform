import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useDeleteAccount } from '../../lib/account-mutations';
import { deleteAccountErrorMessage } from '../../lib/account';
import { DeleteAccountDialog } from './DeleteAccountDialog';
import { focusRing } from '../../lib/utils';

/**
 * ZONA DE PELIGRO del perfil: seccion visualmente SEPARADA (acento de advertencia `brasa`, dentro del
 * sistema de diseno) al final de /perfil. Explica que eliminar la cuenta es PERMANENTE e IRREVERSIBLE y
 * ofrece un unico boton que abre el modal de confirmacion fuerte (DeleteAccountDialog), donde el usuario
 * debe escribir su email para habilitar el borrado.
 *
 * Orquesta la mutacion: al confirmar dispara useDeleteAccount (DELETE /v1/me), que al exito cierra sesion
 * y redirige fuera -- por eso NO hay estado de exito que mostrar aqui (la pantalla se desmonta al salir).
 * El error se traduce con deleteAccountErrorMessage y se pasa al modal. Al abrir se resetea la mutacion
 * (limpia un error previo). Estado 100% en React/react-query (sin localStorage). El email esperado llega
 * como prop desde useAuth().user?.email.
 */
export function DangerZoneSection({ email }: { email: string | undefined }) {
  const [open, setOpen] = useState(false);
  const deleteAccount = useDeleteAccount();

  function openDialog() {
    deleteAccount.reset();
    setOpen(true);
  }

  function confirmDelete(confirmEmail: string) {
    deleteAccount.mutate(confirmEmail);
  }

  return (
    <section>
      <div className="mb-4">
        <h2 className="font-display text-lg font-bold text-brasa">Zona de peligro</h2>
        <p className="mt-0.5 text-[13px] text-muted">
          Acciones permanentes sobre tu cuenta. Procede con cuidado.
        </p>
      </div>

      <div className="rounded-2xl border border-brasa-line bg-brasa-soft p-5">
        <h3 className="text-sm font-semibold text-ink">Eliminar mi cuenta</h3>
        <p className="mt-1.5 text-sm text-muted">
          Se borrarán <span className="font-medium text-ink">de forma permanente</span> todos tus datos
          —agentes, credenciales, recetas, tareas, triggers e historial— y no se podrán recuperar. Esta
          acción <span className="font-medium text-ink">no se puede deshacer</span>.
        </p>
        <button
          type="button"
          onClick={openDialog}
          className={`mt-4 inline-flex items-center gap-2 rounded-[10px] bg-brasa px-4 py-2.5 text-sm font-semibold text-white shadow-[0_1px_2px_rgba(31,30,28,0.10)] transition hover:bg-brasa-hover ${focusRing}`}
        >
          <Trash2 className="h-[17px] w-[17px]" />
          Eliminar mi cuenta
        </button>
      </div>

      {open && (
        <DeleteAccountDialog
          expectedEmail={email}
          busy={deleteAccount.isPending}
          error={deleteAccount.isError ? deleteAccountErrorMessage(deleteAccount.error) : undefined}
          onConfirm={confirmDelete}
          onCancel={() => setOpen(false)}
        />
      )}
    </section>
  );
}
