import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Trash2 } from 'lucide-react';
import { useDeleteAccount } from '../../lib/account-mutations';
import { deleteAccountErrorMessage } from '../../lib/account';
import { DeleteAccountDialog } from './DeleteAccountDialog';
import { Button } from '../ui/button';

/**
 * ZONA DE PELIGRO del perfil: fila visualmente SEPARADA (borde punteado rojizo, unico lugar de la
 * pagina con rojo destructivo) al final de Mi cuenta (/configuracion/cuenta). Explica que eliminar la cuenta es PERMANENTE e
 * IRREVERSIBLE y ofrece un unico boton (variante destructiva) que abre el modal de confirmacion fuerte
 * (DeleteAccountDialog), donde el usuario debe escribir su email para habilitar el borrado.
 *
 * Orquesta la mutacion: al confirmar dispara useDeleteAccount (DELETE /v1/me), que al exito cierra sesion
 * y redirige fuera -- por eso NO hay estado de exito que mostrar aqui (la pantalla se desmonta al salir).
 * El error se traduce con deleteAccountErrorMessage y se pasa al modal. Al abrir se resetea la mutacion
 * (limpia un error previo). Estado 100% en React/react-query (sin localStorage). El email esperado llega
 * como prop desde useAuth().user?.email.
 */
export function DangerZoneSection({ email }: { email: string | undefined }) {
  const { t } = useTranslation();
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
    <section className="flex flex-wrap items-center gap-3.5 rounded-[14px] border-[0.5px] border-dashed border-[#E9C4C4] px-[22px] py-4">
      <span
        aria-hidden="true"
        className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[9px] bg-[#FCEBEB] text-[#A32D2D]"
      >
        <Trash2 className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="text-[13.5px] font-medium text-[#A32D2D]">{t('cuenta.eliminar.zonaTitulo')}</h2>
        <p className="text-xs text-[#5F5E5A]">
          {t('cuenta.eliminar.zonaDescripcion')}
        </p>
      </div>
      <Button type="button" variant="destructive" size="sm" onClick={openDialog}>
        {t('cuenta.eliminar.zonaBoton')}
      </Button>

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
