import { type FormEvent, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff, Loader2, ShieldCheck, X } from 'lucide-react';
import { ApiError } from '../../lib/api';
import { providerLabel, type ProviderId } from '../../lib/agents';
import { CredentialFormSchema } from '../../lib/credential-schema';
import { useCreateCredential } from '../../lib/mutations';
import { Field, inputClass } from '../ui/Field';
import { useDialog } from '../ui/useDialog';

const PROVIDER_IDS: ProviderId[] = ['anthropic', 'openai', 'openai-compatible'];

type FieldErrors = Partial<Record<'label' | 'apiKey' | 'baseUrl', string>>;

/** Traduce el error del backend a la clave i18n de su mensaje. El backend manda 400 o 401. */
function backendMessageKey(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return 'credenciales.form.errorSesion';
    if (error.status === 400) return 'credenciales.form.errorRechazo';
  }
  return 'credenciales.form.errorGuardar';
}

/**
 * Modal de alta de credencial (POST /v1/credentials). Se monta solo cuando esta abierto, asi el
 * estado arranca limpio en cada apertura (la apiKey nunca queda residente). Valida en cliente con
 * el mismo esquema del backend antes de enviar y muestra el error del backend si responde mal.
 */
export function CredentialFormDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t } = useTranslation();
  const createCredential = useCreateCredential();

  const [label, setLabel] = useState('');
  const [providerId, setProviderId] = useState<ProviderId>('anthropic');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});

  // Foco inicial en el primer campo, trampa de foco, Escape y retorno del foco al cerrar, via el hook
  // compartido (antes tenia foco+Escape+retorno pero NO trampa de foco).
  const labelRef = useRef<HTMLInputElement>(null);
  const dialogRef = useDialog({ onClose, initialFocus: labelRef });

  const needsBaseUrl = providerId === 'openai-compatible';

  function handleProviderChange(next: ProviderId) {
    setProviderId(next);
    // Al salir de openai-compatible el baseUrl deja de aplicar: limpia valor y error para que un
    // campo oculto (p.ej. con una URL invalida tipeada antes) nunca bloquee el envio en silencio.
    if (next !== 'openai-compatible') {
      setBaseUrl('');
      setErrors((prev) => ({ ...prev, baseUrl: undefined }));
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const result = CredentialFormSchema.safeParse({ label, providerId, apiKey, baseUrl });
    if (!result.success) {
      const fieldErrors: FieldErrors = {};
      for (const issue of result.error.issues) {
        const key = issue.path[0];
        if (key === 'label' || key === 'apiKey' || key === 'baseUrl') {
          fieldErrors[key] = fieldErrors[key] ?? issue.message;
        }
      }
      setErrors(fieldErrors);
      return;
    }
    setErrors({});
    createCredential.mutate(result.data, {
      onSuccess: () => {
        onCreated();
        onClose();
      },
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-8">
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} aria-hidden="true" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="credential-form-title"
        className="relative w-full max-w-md overflow-hidden rounded-2xl border border-line bg-surface shadow-card-hover"
      >
        <div className="flex items-start justify-between gap-4 border-b border-line-soft px-6 py-5">
          <div>
            <h2 id="credential-form-title" className="font-display text-lg font-bold text-ink">
              {t('credenciales.agregar')}
            </h2>
            <p className="mt-1 text-sm text-muted">{t('credenciales.form.subtitulo')}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('credenciales.form.cerrarAria')}
            className="flex h-8 w-8 flex-none items-center justify-center rounded-lg text-muted transition hover:bg-line-soft hover:text-ink"
          >
            <X className="h-[18px] w-[18px]" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5 px-6 py-6" noValidate>
          {createCredential.isError && (
            <div
              role="alert"
              className="rounded-xl border border-brasa-line bg-brasa-soft px-4 py-3 text-sm font-medium text-brasa"
            >
              {t(backendMessageKey(createCredential.error))}
            </div>
          )}

          <Field label={t('credenciales.form.etiquetaLabel')} error={errors.label}>
            <input
              ref={labelRef}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className={inputClass}
              placeholder={t('credenciales.form.etiquetaPlaceholder')}
              maxLength={120}
            />
          </Field>

          <Field label={t('credenciales.form.proveedorLabel')}>
            <select
              value={providerId}
              onChange={(e) => handleProviderChange(e.target.value as ProviderId)}
              className={inputClass}
            >
              {PROVIDER_IDS.map((pid) => (
                <option key={pid} value={pid}>
                  {providerLabel(pid)}
                </option>
              ))}
            </select>
          </Field>

          <Field label="API key" error={errors.apiKey} hint={t('credenciales.form.apiKeyHint')}>
            {(field) => (
              <div className="relative">
                <input
                  {...field}
                  type={showKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  className={`${inputClass} pr-11`}
                  placeholder="sk-..."
                  autoComplete="off"
                  spellCheck={false}
                />
                <button
                  type="button"
                  onClick={() => setShowKey((v) => !v)}
                  aria-label={
                    showKey
                      ? t('credenciales.form.ocultarKeyAria')
                      : t('credenciales.form.mostrarKeyAria')
                  }
                  className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-muted transition hover:text-ink"
                >
                  {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            )}
          </Field>

          {needsBaseUrl && (
            <Field
              label="Base URL"
              error={errors.baseUrl}
              hint={t('credenciales.form.baseUrlHint')}
            >
              <input
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                className={inputClass}
                placeholder={t('credenciales.form.baseUrlPlaceholder')}
              />
            </Field>
          )}

          <div className="flex items-start gap-2 rounded-xl border border-line bg-field px-3.5 py-3 text-xs text-muted">
            <ShieldCheck className="mt-px h-4 w-4 flex-none text-ok" />
            <span>{t('credenciales.form.seguridadNota')}</span>
          </div>

          <div className="flex justify-end gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-[10px] border border-line bg-surface px-4 py-2.5 text-sm font-medium text-muted transition hover:border-ink-soft hover:text-ink"
            >
              {t('credenciales.cancelar')}
            </button>
            <button
              type="submit"
              disabled={createCredential.isPending}
              className="inline-flex items-center gap-2 rounded-[10px] bg-brasa px-[22px] py-2.5 text-sm font-semibold text-white shadow-[0_1px_2px_rgba(31,30,28,0.10)] transition hover:bg-brasa-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              {createCredential.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {createCredential.isPending
                ? t('credenciales.form.guardando')
                : t('credenciales.form.guardar')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
