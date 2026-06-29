import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { Clock, RefreshCw } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { AuthScreen, SubmitButton, authInputClass, authLabelClass } from '../components/AuthScreen';
import { useMe } from '../lib/queries';
import { useRegisterIndividual, useRegisterOrganization } from '../lib/mutations';
import { classifyRegistration, validateName } from '../lib/registration';

type Mode = 'empresa' | 'individual';

/** Salir de la cuenta actual. AuthProvider detecta el cambio y ProtectedRoute redirige a /login. */
function SignOutLink() {
  return (
    <button
      type="button"
      onClick={() => void supabase.auth.signOut()}
      className="text-xs text-muted-soft transition hover:text-ink"
    >
      Cerrar sesion
    </button>
  );
}

function RegistrationForm() {
  const [mode, setMode] = useState<Mode>('empresa');
  const [orgName, setOrgName] = useState('');
  const [fullName, setFullName] = useState('');
  const [errors, setErrors] = useState<{ orgName?: string; fullName?: string }>({});

  const registerIndividual = useRegisterIndividual();
  const registerOrganization = useRegisterOrganization();
  const submitting = registerIndividual.isPending || registerOrganization.isPending;
  const failed = registerIndividual.isError || registerOrganization.isError;

  function selectMode(next: Mode) {
    setMode(next);
    setErrors({});
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const nextErrors: { orgName?: string; fullName?: string } = {};
    const fullNameError = validateName(fullName);
    if (fullNameError) nextErrors.fullName = fullNameError;
    if (mode === 'empresa') {
      const orgError = validateName(orgName);
      if (orgError) nextErrors.orgName = orgError;
    }
    setErrors(nextErrors);
    if (nextErrors.fullName || nextErrors.orgName) return;

    // Idempotente y de cero configuracion posterior: todos los datos se piden una sola vez aqui.
    if (mode === 'empresa') {
      registerOrganization.mutate({ org_name: orgName.trim(), full_name: fullName.trim() });
    } else {
      registerIndividual.mutate({ full_name: fullName.trim() });
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
      <div>
        <h1 className="font-display text-lg font-semibold text-ink">Completar registro</h1>
        <p className="mt-1 text-sm text-muted">Necesitamos algunos datos para activar tu cuenta.</p>
      </div>

      {/* Toggle Empresa/Persona: segmento limpio, seleccionado en brasa, el otro neutro. */}
      <div className="grid grid-cols-2 gap-1 rounded-lg border border-line bg-field p-1">
        {(['empresa', 'individual'] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => selectMode(value)}
            aria-pressed={mode === value}
            className={
              mode === value
                ? 'rounded-md bg-brasa px-3 py-2 text-sm font-medium text-white shadow-sm'
                : 'rounded-md px-3 py-2 text-sm font-medium text-muted transition hover:text-ink'
            }
          >
            {value === 'empresa' ? 'Empresa' : 'Persona'}
          </button>
        ))}
      </div>

      {mode === 'empresa' && (
        <div>
          <label htmlFor="org-name" className={authLabelClass}>
            Nombre de la empresa
          </label>
          <input
            id="org-name"
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
            placeholder="Acme S.A."
            className={authInputClass}
          />
          {errors.orgName && (
            <p className="mt-1.5 text-sm text-brasa" role="alert">
              {errors.orgName}
            </p>
          )}
        </div>
      )}

      <div>
        <label htmlFor="full-name" className={authLabelClass}>
          {mode === 'empresa' ? 'Tu nombre (administrador)' : 'Nombre completo'}
        </label>
        <input
          id="full-name"
          autoComplete="name"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder="Ada Lovelace"
          className={authInputClass}
        />
        {errors.fullName && (
          <p className="mt-1.5 text-sm text-brasa" role="alert">
            {errors.fullName}
          </p>
        )}
      </div>

      {failed && (
        <p className="text-sm text-brasa" role="alert">
          No pudimos completar el registro. Intenta de nuevo.
        </p>
      )}

      <SubmitButton pending={submitting} pendingLabel="Enviando...">
        {mode === 'empresa' ? 'Registrar empresa' : 'Crear mi cuenta'}
      </SubmitButton>

      <p className="text-center text-xs text-muted-soft">
        {mode === 'empresa'
          ? 'Tu empresa quedara en revision hasta ser aprobada.'
          : 'Tu cuenta queda activa de inmediato.'}
      </p>
    </form>
  );
}

/**
 * Hub de onboarding tras el login OTP. Lee GET /v1/me y, segun el estado:
 * - activo (individuo o empresa aprobada) -> redirige al dashboard.
 * - empresa en revision -> pantalla "en revision" (no entra al dashboard).
 * - sin registro -> formulario de Completar registro (empresa o persona).
 */
export function RegistrationPage() {
  const { data, isLoading, isError, refetch } = useMe();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-cream">
        <span className="text-sm text-muted">Cargando...</span>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <AuthScreen>
        <div className="text-center">
          <p className="font-display text-lg font-semibold text-ink">No pudimos cargar tu cuenta</p>
          <p className="mt-2 text-sm text-muted">Revisa tu conexion e intenta de nuevo.</p>
          <button
            type="button"
            onClick={() => void refetch()}
            className="mt-5 inline-flex items-center gap-2 rounded-lg border border-line bg-field px-4 py-2 text-sm font-medium text-ink transition hover:border-brasa"
          >
            <RefreshCw className="h-4 w-4" />
            Reintentar
          </button>
        </div>
      </AuthScreen>
    );
  }

  const access = classifyRegistration(data);

  if (access === 'active') {
    return <Navigate to="/agentes" replace />;
  }

  if (access === 'pending') {
    const orgName = data.organization?.name;
    return (
      <AuthScreen footer={<SignOutLink />}>
        <div className="flex flex-col items-center text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-brasa-soft text-brasa">
            <Clock className="h-5 w-5" aria-hidden="true" />
          </span>
          <p className="mt-4 font-display text-lg font-semibold text-ink">
            Tu registro de empresa esta en revision
          </p>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            {orgName ? (
              <>
                Estamos revisando <span className="font-medium text-ink">{orgName}</span>. Te
                avisaremos en cuanto sea aprobada para que puedas entrar.
              </>
            ) : (
              'Estamos revisando tu empresa. Te avisaremos en cuanto sea aprobada para que puedas entrar.'
            )}
          </p>
        </div>
      </AuthScreen>
    );
  }

  return (
    <AuthScreen footer={<SignOutLink />}>
      <RegistrationForm />
    </AuthScreen>
  );
}
