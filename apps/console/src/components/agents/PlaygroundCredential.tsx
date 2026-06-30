import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import { providerLabel, type ProviderId } from '../../lib/agents';
import type { ProviderCredential } from '../../lib/credentials';
import { Field, inputClass } from '../ui/Field';

/**
 * Setup de la credencial para una sesion del Playground. A diferencia del Configurador, aqui el
 * agente YA existe: su proveedor/modelo/baseUrl son fijos, asi que el usuario solo elige la FUENTE
 * de la key. Dos modos mutuamente excluyentes:
 *  - 'saved': una credencial GUARDADA de la boveda. El selector solo muestra las del MISMO proveedor
 *    que el agente (las otras serian rechazadas por el backend). Al ejecutar se manda x-credential-id.
 *  - 'paste': una key pegada AL MOMENTO (el flujo de siempre). Se manda x-provider-key.
 * Es presentacional y controlado: el estado vive en PlaygroundPage para que la ejecucion y los
 * deshabilitados lean la misma fuente. La key al momento nunca se persiste ni se loguea.
 */
export function PlaygroundCredential({
  providerId,
  compatible,
  loading,
  mode,
  onModeChange,
  credentialId,
  onCredentialIdChange,
  apiKey,
  onApiKeyChange,
}: {
  providerId: ProviderId;
  compatible: ProviderCredential[];
  loading: boolean;
  mode: 'saved' | 'paste';
  onModeChange: (mode: 'saved' | 'paste') => void;
  credentialId: string;
  onCredentialIdChange: (id: string) => void;
  apiKey: string;
  onApiKeyChange: (key: string) => void;
}) {
  const [showKey, setShowKey] = useState(false);
  const groupName = useId();
  const selected = compatible.find((cred) => cred.id === credentialId);

  return (
    <div className="rounded-xl border border-grafito-border bg-grafito p-5">
      <div className="mb-4">
        <h2 className="text-sm font-medium text-hueso">Credencial de la sesion</h2>
        <p className="mt-1 text-xs text-hueso-muted">
          Con que key conversa el agente. Reusa una de tu boveda o pega una al momento; nunca se
          guarda en la plataforma.
        </p>
      </div>

      {/* Selector de modo (radiogroup accesible). */}
      <div
        role="radiogroup"
        aria-label="Origen de la credencial"
        className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2"
      >
        <ModeOption
          name={groupName}
          checked={mode === 'saved'}
          onSelect={() => onModeChange('saved')}
          title="Credencial guardada"
          description="Reusa una de tu boveda"
        />
        <ModeOption
          name={groupName}
          checked={mode === 'paste'}
          onSelect={() => onModeChange('paste')}
          title="Pegar al momento"
          description="Una key solo para esta sesion"
        />
      </div>

      {mode === 'saved' ? (
        loading ? (
          <div className="h-11 animate-pulse rounded-xl border border-line bg-field" />
        ) : compatible.length === 0 ? (
          <div className="rounded-xl border border-line bg-field px-4 py-3 text-sm text-hueso-muted">
            No tenes credenciales de {providerLabel(providerId)}. Pega una key al momento o{' '}
            <Link to="/credenciales" className="font-medium text-brasa hover:underline">
              agregala en Credenciales
            </Link>
            .
          </div>
        ) : (
          <div className="space-y-2">
            <Field
              label="Credencial guardada"
              hint={`Solo se muestran las de ${providerLabel(providerId)}, el proveedor del agente.`}
            >
              <select
                value={credentialId}
                onChange={(event) => onCredentialIdChange(event.target.value)}
                className={inputClass}
              >
                <option value="">Elegi una credencial...</option>
                {compatible.map((cred) => (
                  <option key={cred.id} value={cred.id}>
                    {cred.label}
                  </option>
                ))}
              </select>
            </Field>
            {selected?.baseUrl && (
              <p className="text-xs text-hueso-muted">
                Base URL: <span className="font-mono">{selected.baseUrl}</span>
              </p>
            )}
          </div>
        )
      ) : (
        <Field
          label="API key del proveedor"
          hint="Tu llave se usa solo para esta sesion de prueba, viaja cifrada en cada peticion y NUNCA se guarda en la plataforma."
        >
          <div className="relative">
            <input
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={(event) => onApiKeyChange(event.target.value)}
              className={`${inputClass} pr-11`}
              placeholder="Pega tu API key"
              autoComplete="off"
              spellCheck={false}
            />
            <button
              type="button"
              onClick={() => setShowKey((value) => !value)}
              aria-label={showKey ? 'Ocultar API key' : 'Mostrar API key'}
              className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-hueso-muted transition hover:text-hueso"
            >
              {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </Field>
      )}
    </div>
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
          : 'border-grafito-border bg-field hover:border-hueso-muted/40',
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
        <span className={`block text-sm font-semibold ${checked ? 'text-brasa' : 'text-hueso'}`}>
          {title}
        </span>
        <span className="mt-0.5 block text-xs text-hueso-muted">{description}</span>
      </span>
    </label>
  );
}
