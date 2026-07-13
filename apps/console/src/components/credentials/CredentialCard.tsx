import { useTranslation } from 'react-i18next';
import { Calendar, KeyRound, Link2, Trash2 } from 'lucide-react';
import type { ProviderId } from '../../lib/agents';
import { providerLabel } from '../../lib/agents';
import type { ProviderCredential } from '../../lib/credentials';
import { focusRing } from '../../lib/utils';

type Accent = { iconBox: string; badge: string };

/** Clases por proveedor (literales para que el JIT de Tailwind las detecte). */
const ACCENTS: Partial<Record<ProviderId, Accent>> = {
  anthropic: {
    iconBox: 'bg-anthropic-soft text-anthropic',
    badge: 'border-anthropic-line bg-anthropic-soft text-anthropic',
  },
  openai: {
    iconBox: 'bg-openai-soft text-openai',
    badge: 'border-openai-line bg-openai-soft text-openai',
  },
  'openai-compatible': {
    iconBox: 'bg-oss-soft text-oss',
    badge: 'border-oss-line bg-oss-soft text-oss',
  },
};

const FALLBACK_ACCENT: Accent = {
  iconBox: 'bg-brasa-soft text-brasa',
  badge: 'border-brasa-line bg-brasa-soft text-brasa',
};

/** Formatea la fecha ISO a algo legible en espanol; cae al string crudo si no parsea. */
function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('es', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function CredentialCard({
  credential,
  onDelete,
}: {
  credential: ProviderCredential;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const accent = ACCENTS[credential.providerId] ?? FALLBACK_ACCENT;

  return (
    <div className="flex items-start justify-between gap-4 rounded-2xl border border-line bg-surface p-5 shadow-card">
      <div className="flex min-w-0 items-start gap-3.5">
        <span
          className={`flex h-[42px] w-[42px] flex-none items-center justify-center rounded-xl ${accent.iconBox}`}
        >
          <KeyRound className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate font-display text-[16px] font-bold text-ink">
              {credential.label}
            </h3>
            <span
              className={`flex-none whitespace-nowrap rounded-full border px-2.5 py-0.5 font-mono text-[10px] tracking-wide ${accent.badge}`}
            >
              {providerLabel(credential.providerId)}
            </span>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[12.5px] text-muted">
            {credential.baseUrl && (
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <Link2 className="h-3.5 w-3.5 flex-none" />
                <span className="truncate font-mono">{credential.baseUrl}</span>
              </span>
            )}
            <span className="inline-flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5 flex-none" />
              {formatDate(credential.createdAt)}
            </span>
          </div>
        </div>
      </div>
      <button
        type="button"
        onClick={onDelete}
        aria-label={t('credenciales.tarjeta.eliminarAria', { etiqueta: credential.label })}
        className={`flex h-9 w-9 flex-none items-center justify-center rounded-lg border border-line bg-surface text-muted transition hover:border-[rgba(192,73,43,0.35)] hover:bg-[rgba(192,73,43,0.05)] hover:text-[#C0492B] ${focusRing}`}
      >
        <Trash2 className="h-[17px] w-[17px]" />
      </button>
    </div>
  );
}
