import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyRound, Plus } from 'lucide-react';
import { useCredentials } from '../lib/queries';
import { useDeleteCredential } from '../lib/mutations';
import type { ProviderCredential } from '../lib/credentials';
import { CredentialCard } from '../components/credentials/CredentialCard';
import { CredentialFormDialog } from '../components/credentials/CredentialFormDialog';
import { DeleteCredentialDialog } from '../components/credentials/DeleteCredentialDialog';
import { PageHeader } from '../components/ui/PageHeader';
import { SkeletonList } from '../components/ui/SkeletonList';
import { ErrorState } from '../components/ui/ErrorState';
import { Notice } from '../components/ui/Notice';
import { focusRing } from '../lib/utils';

const addButtonClass =
  'inline-flex items-center gap-2 rounded-[10px] bg-brasa px-[22px] py-[11px] text-sm font-semibold text-white shadow-[0_1px_2px_rgba(31,30,28,0.10)] transition hover:-translate-y-px hover:bg-brasa-hover hover:shadow-[0_2px_6px_rgba(31,30,28,0.14)]';

/** Las tres garantias de la franja inferior de la tarjeta de ejemplo (claves de traduccion). */
const GARANTIAS = [
  {
    tituloKey: 'credenciales.vacio.garantias.cifradaTitulo',
    textoKey: 'credenciales.vacio.garantias.cifradaTexto',
  },
  {
    tituloKey: 'credenciales.vacio.garantias.mascaraTitulo',
    textoKey: 'credenciales.vacio.garantias.mascaraTexto',
  },
  {
    tituloKey: 'credenciales.vacio.garantias.tuyaTitulo',
    textoKey: 'credenciales.vacio.garantias.tuyaTexto',
  },
] as const;

/**
 * Estado vacio de Credenciales: encabezado propio (titulo + subtitulo + CTA a la derecha,
 * reemplaza al PageHeader en este estado) y una tarjeta con una credencial de EJEMPLO
 * enmascarada mas la franja de garantias de seguridad. La fila de ejemplo es estatica y
 * ficticia (sin fetching, sin estado, aria-hidden) y anticipa la anatomia de CredentialCard:
 * badge de icono + nombre + badge de estado + metadata.
 *
 * Paleta: brasa solo en el CTA; verde solo en el badge "cifrada" (#0F6E56 sobre #E1F5EE).
 * Resto neutros calidos. Sin box-shadow.
 */
function CredentialsEmptyState({ onAdd }: { onAdd: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="max-w-[520px]">
          <h1 className="font-display text-3xl font-extrabold tracking-tight text-ink">
            {t('credenciales.titulo')}
          </h1>
          <p className="mt-1.5 text-[13.5px] leading-[1.55] text-[#5F5E5A]">
            {t('credenciales.vacio.subtitulo')}
          </p>
        </div>
        <button
          type="button"
          onClick={onAdd}
          className={`inline-flex flex-none items-center gap-2 rounded-[10px] bg-brasa px-[22px] py-[11px] text-sm font-semibold text-white transition hover:bg-brasa-hover ${focusRing}`}
        >
          <Plus className="h-[17px] w-[17px]" />
          {t('credenciales.agregar')}
        </button>
      </div>

      <div className="overflow-hidden rounded-[14px] border-[0.5px] border-[#E9E7DF] bg-white">
        {/* Header de la tarjeta: label + badge delineado "Ejemplo" (mismo estilo que los gates). */}
        <div className="flex items-center justify-between gap-3 border-b-[0.5px] border-[#F1EFE8] px-[18px] py-[12px]">
          <span className="text-[11px] uppercase tracking-[0.07em] text-[#B4B2A9]">
            {t('credenciales.vacio.tarjetaLabel')}
          </span>
          <span className="flex-none rounded-full border-[0.5px] border-[#E9E7DF] px-[9px] py-[2px] text-[11px] uppercase tracking-[0.07em] text-[#B4B2A9]">
            {t('credenciales.vacio.ejemploBadge')}
          </span>
        </div>

        {/* Fila de credencial de ejemplo: estatica, ficticia y decorativa. */}
        <div
          aria-hidden="true"
          className="flex flex-wrap items-center gap-[14px] border-b-[0.5px] border-[#F1EFE8] px-[18px] py-[14px] opacity-[0.55]"
        >
          <span className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[9px] bg-[#F1EFE8] text-[#5F5E5A]">
            <KeyRound className="h-4 w-4" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[13.5px] font-medium text-ink">
              {t('credenciales.vacio.ejemploNombre')}
            </span>
            <span className="block truncate font-mono text-[11.5px] text-[#8A8880]">
              sk-ant-••••••••••••••••••••7Kq2
            </span>
          </span>
          <span className="flex-none rounded-full bg-[#E1F5EE] px-2 py-[2px] font-mono text-[11px] text-[#0F6E56]">
            {t('credenciales.vacio.ejemploCifrada')}
          </span>
          <span className="flex-none font-mono text-[11px] text-[#B4B2A9]">
            {t('credenciales.vacio.ejemploUso')}
          </span>
        </div>

        {/* Franja de garantias: 3 columnas en desktop, apilada en angosto. */}
        <div className="grid grid-cols-1 bg-[#FAF9F5] sm:grid-cols-3">
          {GARANTIAS.map((garantia) => (
            <div
              key={garantia.tituloKey}
              className="border-[#F1EFE8] px-[18px] py-[14px] [&:not(:last-child)]:border-b-[0.5px] sm:[&:not(:last-child)]:border-b-0 sm:[&:not(:last-child)]:border-r-[0.5px]"
            >
              <h3 className="text-[12.5px] font-medium text-ink">{t(garantia.tituloKey)}</h3>
              <p className="mt-1 text-[12px] leading-[1.5] text-[#8A8880]">
                {t(garantia.textoKey)}
              </p>
            </div>
          ))}
        </div>
      </div>

      <p className="text-center text-[12px] text-[#8A8880]">
        {t('credenciales.vacio.compatibilidad')}
      </p>
    </div>
  );
}

export function CredentialsPage() {
  const { t } = useTranslation();
  const { data: credentials, isLoading, isError, refetch } = useCredentials();
  const deleteCredential = useDeleteCredential();

  const [formOpen, setFormOpen] = useState(false);
  const [toDelete, setToDelete] = useState<ProviderCredential | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // El aviso de exito se descarta solo a los pocos segundos.
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  const hasCredentials = Array.isArray(credentials) && credentials.length > 0;
  // El estado vacio trae su propio encabezado (titulo + subtitulo + CTA): en ese caso el
  // PageHeader compartido no se renderiza, igual que en los gates de Tareas y Triggers.
  const showEmpty = !isLoading && !isError && !hasCredentials;

  function openDelete(credential: ProviderCredential) {
    deleteCredential.reset();
    setToDelete(credential);
  }

  function confirmDelete() {
    if (!toDelete) return;
    deleteCredential.mutate(toDelete.id, {
      onSuccess: () => {
        setToDelete(null);
        setNotice(t('credenciales.noticeEliminada'));
      },
    });
  }

  return (
    <div className="mx-auto flex min-h-full max-w-4xl flex-col">
      {!showEmpty && (
        <PageHeader
          title={t('credenciales.titulo')}
          subtitle={t('credenciales.subtitulo')}
          action={
            hasCredentials && (
              <button type="button" onClick={() => setFormOpen(true)} className={addButtonClass}>
                <Plus className="h-[17px] w-[17px]" />
                {t('credenciales.agregar')}
              </button>
            )
          }
        />
      )}

      <Notice notice={notice ? { kind: 'ok', text: notice } : null} />

      {isLoading ? (
        <SkeletonList cardClassName="h-[88px]" />
      ) : isError ? (
        <ErrorState title={t('credenciales.errorCargar')} onRetry={() => void refetch()} />
      ) : !hasCredentials ? (
        <CredentialsEmptyState onAdd={() => setFormOpen(true)} />
      ) : (
        <div className="mt-6 space-y-3">
          {credentials.map((credential) => (
            <CredentialCard
              key={credential.id}
              credential={credential}
              onDelete={() => openDelete(credential)}
            />
          ))}
          <button
            type="button"
            onClick={() => setFormOpen(true)}
            className="flex w-full items-center justify-center gap-2 rounded-2xl border-[1.5px] border-dashed border-line p-4 text-sm font-semibold text-muted transition hover:border-brasa-line hover:bg-brasa/[0.03] hover:text-brasa"
          >
            <Plus className="h-[18px] w-[18px]" />
            {t('credenciales.agregar')}
          </button>
        </div>
      )}

      {formOpen && (
        <CredentialFormDialog
          onClose={() => setFormOpen(false)}
          onCreated={() => setNotice(t('credenciales.noticeGuardada'))}
        />
      )}

      <DeleteCredentialDialog
        open={toDelete !== null}
        label={toDelete?.label ?? ''}
        busy={deleteCredential.isPending}
        error={deleteCredential.isError ? t('credenciales.eliminar.error') : undefined}
        onConfirm={confirmDelete}
        onCancel={() => setToDelete(null)}
      />
    </div>
  );
}
