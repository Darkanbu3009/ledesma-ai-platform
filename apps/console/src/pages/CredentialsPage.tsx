import { useEffect, useState } from 'react';
import { ArrowRight, CheckCircle2, KeyRound, Plus, RefreshCw } from 'lucide-react';
import { useCredentials } from '../lib/queries';
import { useDeleteCredential } from '../lib/mutations';
import type { ProviderCredential } from '../lib/credentials';
import { CredentialCard } from '../components/credentials/CredentialCard';
import { CredentialFormDialog } from '../components/credentials/CredentialFormDialog';
import { DeleteCredentialDialog } from '../components/credentials/DeleteCredentialDialog';

const addButtonClass =
  'inline-flex items-center gap-2 rounded-[10px] bg-brasa px-[22px] py-[11px] text-sm font-semibold text-white shadow-[0_1px_2px_rgba(31,30,28,0.10)] transition hover:-translate-y-px hover:bg-brasa-hover hover:shadow-[0_2px_6px_rgba(31,30,28,0.14)]';

function CredentialsEmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center text-center">
      {/* Maqueta decorativa de "asi se vera tu credencial". No interactiva; ancla el bloque centrado. */}
      <div className="mb-10 hidden md:block">
        <div
          aria-hidden="true"
          className="w-[230px] rounded-2xl border border-line-soft bg-surface p-[18px] shadow-card"
        >
          <div className="flex items-center gap-3">
            <span className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-[10px] bg-brasa-soft text-brasa">
              <KeyRound className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1 space-y-2">
              <span className="block h-2.5 w-[90px] rounded-full bg-line" />
              <span className="block h-2 w-[60px] rounded-full bg-line-soft" />
            </div>
          </div>
          <div className="mt-[18px] flex items-center gap-2">
            <span className="block h-[22px] w-[64px] rounded-full bg-brasa-soft" />
            <span className="block h-[22px] w-[44px] rounded-full bg-line-soft" />
          </div>
        </div>
      </div>
      <span className="inline-flex items-center rounded-md bg-brasa-soft px-2.5 py-1 text-[11px] font-semibold tracking-wide text-[#993C1D]">
        EMPIEZA AQUI
      </span>
      <h2 className="mt-4 max-w-md font-display text-[22px] font-bold leading-[1.2] text-ink">
        Tus llaves, en un solo lugar
      </h2>
      <p className="mt-3 max-w-md text-[13px] leading-[1.5] text-muted">
        Guarda las API keys de tus proveedores de IA, cifradas, para reutilizarlas en tus agentes
        sin volver a pegarlas.
      </p>
      <div className="mt-7">
        <button
          type="button"
          onClick={onAdd}
          className="group inline-flex h-11 items-center gap-3 rounded-full bg-brasa pl-6 pr-[7px] text-sm font-medium text-white transition hover:bg-brasa-hover"
        >
          Agregar credencial
          <span className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-white text-brasa transition group-hover:translate-x-0.5">
            <ArrowRight className="h-[18px] w-[18px]" />
          </span>
        </button>
      </div>
    </div>
  );
}

export function CredentialsPage() {
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

  function openDelete(credential: ProviderCredential) {
    deleteCredential.reset();
    setToDelete(credential);
  }

  function confirmDelete() {
    if (!toDelete) return;
    deleteCredential.mutate(toDelete.id, {
      onSuccess: () => {
        setToDelete(null);
        setNotice('Credencial eliminada.');
      },
    });
  }

  return (
    <div className="mx-auto flex min-h-full max-w-4xl flex-col">
      <div className="flex items-start justify-between gap-5">
        <div>
          <h1 className="font-display text-3xl font-extrabold tracking-tight text-ink">
            Credenciales
          </h1>
          <p className="mt-1.5 text-[15px] text-muted">
            Guarda las API keys de tus proveedores de IA para reutilizarlas en tus agentes.
          </p>
        </div>
        {hasCredentials && (
          <button type="button" onClick={() => setFormOpen(true)} className={addButtonClass}>
            <Plus className="h-[17px] w-[17px]" />
            Agregar credencial
          </button>
        )}
      </div>

      <div className="mt-3" aria-live="polite">
        {notice && (
          <div className="inline-flex items-center gap-2 rounded-xl border border-ok/30 bg-ok/10 px-3.5 py-2 text-sm font-medium text-ok">
            <CheckCircle2 className="h-4 w-4" />
            {notice}
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="mt-6 space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-[88px] animate-pulse rounded-2xl border border-line bg-surface" />
          ))}
        </div>
      ) : isError ? (
        <div className="mt-10 rounded-2xl border border-line bg-surface p-8 text-center shadow-card">
          <p className="font-display text-lg font-bold text-ink">No pudimos cargar tus credenciales</p>
          <p className="mt-2 text-sm text-muted">Revisa tu conexión e intenta de nuevo.</p>
          <button
            type="button"
            onClick={() => void refetch()}
            className="mt-5 inline-flex items-center gap-2 rounded-xl border border-line bg-surface px-4 py-2 text-sm font-medium text-muted transition hover:border-ink-soft hover:text-ink"
          >
            <RefreshCw className="h-4 w-4" />
            Reintentar
          </button>
        </div>
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
            Agregar credencial
          </button>
        </div>
      )}

      {formOpen && (
        <CredentialFormDialog
          onClose={() => setFormOpen(false)}
          onCreated={() => setNotice('Credencial guardada.')}
        />
      )}

      <DeleteCredentialDialog
        open={toDelete !== null}
        label={toDelete?.label ?? ''}
        busy={deleteCredential.isPending}
        error={
          deleteCredential.isError
            ? 'No pudimos eliminar la credencial. Intenta de nuevo.'
            : undefined
        }
        onConfirm={confirmDelete}
        onCancel={() => setToDelete(null)}
      />
    </div>
  );
}
