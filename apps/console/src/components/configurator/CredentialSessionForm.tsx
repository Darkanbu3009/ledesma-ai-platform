import { type FormEvent, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { Eye, EyeOff, KeyRound, ShieldCheck } from 'lucide-react';
import { providerLabel, type ProviderId } from '../../lib/agents';
import { modelPlaceholder, modelSuggestions } from '../../lib/model-catalog';
import {
  ConfiguratorPasteSchema,
  providerNeedsBaseUrl,
  type CredentialSession,
} from '../../lib/configurator';
import { useCredentials } from '../../lib/queries';
import { Field, inputClass } from '../ui/Field';

const PROVIDER_IDS: ProviderId[] = ['anthropic', 'openai', 'openai-compatible'];

type Mode = 'saved' | 'paste';
type PasteErrors = Partial<Record<'apiKey' | 'baseUrl' | 'model', string>>;
type SavedErrors = Partial<Record<'credentialId' | 'model', string>>;

/**
 * Setup de la credencial para la sesion del Configurador. El usuario elige entre una credencial
 * GUARDADA de la boveda (se mandara x-credential-id) o una key pegada AL MOMENTO (x-provider-key +
 * providerId/model/baseUrl). Replica la regla openai-compatible -> baseUrl en cliente. Al confirmar,
 * entrega una CredentialSession; el historial del chat NO depende de esto (cambiar la credencial no
 * borra la conversacion). La apiKey vive solo en el estado de este componente / la sesion.
 */
export function CredentialSessionForm({
  initial,
  onReady,
  onCancel,
}: {
  initial: CredentialSession | null;
  onReady: (session: CredentialSession) => void;
  onCancel?: () => void;
}) {
  const { data: credentials, isLoading: loadingCreds } = useCredentials();

  const [mode, setMode] = useState<Mode>(initial?.mode ?? 'saved');

  // Estado del modo "guardada".
  const [credentialId, setCredentialId] = useState(
    initial?.mode === 'saved' ? initial.credentialId : '',
  );
  const [savedModel, setSavedModel] = useState(initial?.mode === 'saved' ? initial.model : '');
  const [savedErrors, setSavedErrors] = useState<SavedErrors>({});

  // Estado del modo "al momento".
  const [pasteProvider, setPasteProvider] = useState<ProviderId>(
    initial?.mode === 'paste' ? initial.providerId : 'anthropic',
  );
  const [apiKey, setApiKey] = useState(initial?.mode === 'paste' ? initial.apiKey : '');
  const [pasteBaseUrl, setPasteBaseUrl] = useState(
    initial?.mode === 'paste' ? (initial.baseUrl ?? '') : '',
  );
  const [pasteModel, setPasteModel] = useState(initial?.mode === 'paste' ? initial.model : '');
  const [showKey, setShowKey] = useState(false);
  const [pasteErrors, setPasteErrors] = useState<PasteErrors>({});

  const groupName = useId();
  const savedListId = useId();
  const pasteListId = useId();

  const selectedCredential = credentials?.find((cred) => cred.id === credentialId);
  const savedProvider = selectedCredential?.providerId;

  function submitSaved() {
    const errors: SavedErrors = {};
    if (!selectedCredential) errors.credentialId = 'Elegi una credencial guardada';
    if (savedModel.trim() === '') errors.model = 'El modelo es obligatorio';
    setSavedErrors(errors);
    if (!selectedCredential || Object.keys(errors).length > 0) return;
    onReady({
      mode: 'saved',
      credentialId: selectedCredential.id,
      label: selectedCredential.label,
      providerId: selectedCredential.providerId,
      model: savedModel.trim(),
      baseUrl: selectedCredential.baseUrl,
    });
  }

  function submitPaste() {
    const result = ConfiguratorPasteSchema.safeParse({
      providerId: pasteProvider,
      model: pasteModel,
      apiKey,
      baseUrl: pasteBaseUrl,
    });
    if (!result.success) {
      const errors: PasteErrors = {};
      for (const issue of result.error.issues) {
        const key = issue.path[0];
        if (key === 'apiKey' || key === 'baseUrl' || key === 'model') {
          errors[key] = errors[key] ?? issue.message;
        }
      }
      setPasteErrors(errors);
      return;
    }
    setPasteErrors({});
    onReady({
      mode: 'paste',
      providerId: result.data.providerId,
      model: result.data.model,
      apiKey: result.data.apiKey,
      baseUrl: providerNeedsBaseUrl(result.data.providerId) ? (result.data.baseUrl ?? null) : null,
    });
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (mode === 'saved') submitSaved();
    else submitPaste();
  }

  function handlePasteProviderChange(next: ProviderId) {
    setPasteProvider(next);
    if (!providerNeedsBaseUrl(next)) {
      setPasteBaseUrl('');
      setPasteErrors((prev) => ({ ...prev, baseUrl: undefined }));
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-2xl border border-line bg-surface p-6 shadow-card"
      noValidate
    >
      <div className="mb-5">
        <h2 className="font-display text-base font-bold text-ink">Credencial de la sesion</h2>
        <p className="mt-1 text-sm text-muted">
          Con que key conversa el Configurador. La usas solo para esta sesion; nunca se guarda en la
          plataforma.
        </p>
      </div>

      {/* Selector de modo (radiogroup accesible). */}
      <div
        role="radiogroup"
        aria-label="Origen de la credencial"
        className="mb-5 grid grid-cols-1 gap-2 sm:grid-cols-2"
      >
        <ModeOption
          name={groupName}
          checked={mode === 'saved'}
          onSelect={() => setMode('saved')}
          title="Credencial guardada"
          description="Reusa una de tu boveda"
        />
        <ModeOption
          name={groupName}
          checked={mode === 'paste'}
          onSelect={() => setMode('paste')}
          title="Pegar al momento"
          description="Una key solo para esta sesion"
        />
      </div>

      {mode === 'saved' ? (
        <div className="space-y-5">
          {loadingCreds ? (
            <div className="h-11 animate-pulse rounded-xl border border-line bg-field" />
          ) : !credentials || credentials.length === 0 ? (
            <div className="rounded-xl border border-line bg-field px-4 py-3 text-sm text-muted">
              No tenes credenciales guardadas todavia. Pega una al momento o{' '}
              <Link to="/credenciales" className="font-medium text-brasa hover:underline">
                agregala en Credenciales
              </Link>
              .
            </div>
          ) : (
            <>
              <Field label="Credencial" error={savedErrors.credentialId}>
                <select
                  value={credentialId}
                  onChange={(e) => {
                    setCredentialId(e.target.value);
                    setSavedErrors((prev) => ({ ...prev, credentialId: undefined }));
                  }}
                  className={inputClass}
                >
                  <option value="">Elegi una credencial...</option>
                  {credentials.map((cred) => (
                    <option key={cred.id} value={cred.id}>
                      {cred.label} ({providerLabel(cred.providerId)})
                    </option>
                  ))}
                </select>
              </Field>

              <Field
                label="Modelo"
                error={savedErrors.model}
                hint="El proveedor sale de la credencial; elegis el modelo a usar."
              >
                <input
                  value={savedModel}
                  onChange={(e) => {
                    setSavedModel(e.target.value);
                    setSavedErrors((prev) => ({ ...prev, model: undefined }));
                  }}
                  className={inputClass}
                  list={savedListId}
                  placeholder={modelPlaceholder(savedProvider ?? 'anthropic')}
                />
                <datalist id={savedListId}>
                  {modelSuggestions(savedProvider ?? 'anthropic').map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              </Field>

              {selectedCredential?.baseUrl && (
                <p className="text-xs text-muted">
                  Base URL: <span className="font-mono">{selectedCredential.baseUrl}</span>
                </p>
              )}
            </>
          )}
        </div>
      ) : (
        <div className="space-y-5">
          <Field label="Proveedor">
            <select
              value={pasteProvider}
              onChange={(e) => handlePasteProviderChange(e.target.value as ProviderId)}
              className={inputClass}
            >
              {PROVIDER_IDS.map((pid) => (
                <option key={pid} value={pid}>
                  {providerLabel(pid)}
                </option>
              ))}
            </select>
          </Field>

          <Field
            label="API key"
            error={pasteErrors.apiKey}
            hint="Viaja cifrada en cada turno y no se guarda en la plataforma."
          >
            <div className="relative">
              <input
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
                aria-label={showKey ? 'Ocultar API key' : 'Mostrar API key'}
                className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-muted transition hover:text-ink"
              >
                {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </Field>

          {providerNeedsBaseUrl(pasteProvider) && (
            <Field
              label="Base URL"
              error={pasteErrors.baseUrl}
              hint="URL base del endpoint compatible con OpenAI."
            >
              <input
                value={pasteBaseUrl}
                onChange={(e) => setPasteBaseUrl(e.target.value)}
                className={inputClass}
                placeholder="https://api.miproveedor.com/v1"
              />
            </Field>
          )}

          <Field label="Modelo" error={pasteErrors.model}>
            <input
              value={pasteModel}
              onChange={(e) => setPasteModel(e.target.value)}
              className={inputClass}
              list={pasteListId}
              placeholder={modelPlaceholder(pasteProvider)}
            />
            <datalist id={pasteListId}>
              {modelSuggestions(pasteProvider).map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </Field>
        </div>
      )}

      <div className="mt-5 flex items-start gap-2 rounded-xl border border-line bg-field px-3.5 py-3 text-xs text-muted">
        <ShieldCheck className="mt-px h-4 w-4 flex-none text-ok" />
        <span>
          La key viaja por una conexion segura y solo se usa para esta sesion del Configurador. La
          consola no la persiste.
        </span>
      </div>

      <div className="mt-6 flex justify-end gap-3">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-[10px] border border-line bg-surface px-4 py-2.5 text-sm font-medium text-muted transition hover:border-ink-soft hover:text-ink"
          >
            Cancelar
          </button>
        )}
        <button
          type="submit"
          className="inline-flex items-center gap-2 rounded-[10px] bg-brasa px-[22px] py-2.5 text-sm font-semibold text-white shadow-[0_1px_2px_rgba(31,30,28,0.10)] transition hover:bg-brasa-hover"
        >
          <KeyRound className="h-4 w-4" />
          {initial ? 'Actualizar credencial' : 'Empezar a configurar'}
        </button>
      </div>
    </form>
  );
}

/** Opcion del selector de modo: un radio real (accesible) estilado como tarjeta seleccionable. */
function ModeOption({
  name,
  checked,
  onSelect,
  title,
  description,
}: {
  name: string;
  checked: boolean;
  onSelect: () => void;
  title: string;
  description: string;
}) {
  return (
    <label
      className={[
        'flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3 transition',
        checked
          ? 'border-brasa-line bg-brasa-soft'
          : 'border-line bg-field hover:border-ink-soft/40',
      ].join(' ')}
    >
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={onSelect}
        className="mt-0.5 h-4 w-4 flex-none accent-brasa"
      />
      <span className="min-w-0">
        <span className={`block text-sm font-semibold ${checked ? 'text-brasa' : 'text-ink'}`}>
          {title}
        </span>
        <span className="mt-0.5 block text-xs text-muted">{description}</span>
      </span>
    </label>
  );
}
