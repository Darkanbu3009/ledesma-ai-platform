import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { AuthScreen, SubmitButton, authInputClass, authLabelClass } from '../components/AuthScreen';
import { useMe } from '../lib/queries';
import { useRegisterIndividual, useRegisterOrganization } from '../lib/mutations';
import { classifyRegistration, validateName } from '../lib/registration';
import { SplashCarga } from '../components/SplashCarga';

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
  // Default 'individual' (Persona): el camino sin friccion que entra directo. El usuario puede
  // cambiar a Empresa si aplica -- ambos entran igual de directo, pero el default es el mas simple.
  const [mode, setMode] = useState<Mode>('individual');
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
          ? 'Tu empresa queda activa de inmediato.'
          : 'Tu cuenta queda activa de inmediato.'}
      </p>
    </form>
  );
}

/**
 * Hub de onboarding tras el login OTP. Lee GET /v1/me y, segun el estado:
 * - activo (individuo o empresa) -> redirige al dashboard. Ambos tipos entran directo (sin muro).
 * - sin registro -> formulario de Completar registro (empresa o persona).
 */
export function RegistrationPage() {
  const { data, isLoading, isError, refetch } = useMe();

  if (isLoading) {
    return <SplashCarga />;
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

  return (
    <AuthScreen footer={<SignOutLink />}>
      <RegistrationForm />
    </AuthScreen>
  );
}
