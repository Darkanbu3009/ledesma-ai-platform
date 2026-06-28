import { useState, type FormEvent, type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { BrandMark } from '../components/BrandMark';
import { useMe } from '../lib/queries';
import { useRegisterIndividual, useRegisterOrganization } from '../lib/mutations';
import { classifyRegistration, validateName } from '../lib/registration';

const inputClass =
  'w-full rounded-lg border border-grafito-border bg-carbon px-3.5 py-2.5 text-sm text-hueso outline-none transition placeholder:text-hueso-muted/60 focus:border-brasa focus:ring-2 focus:ring-brasa/30';

type Mode = 'empresa' | 'individual';

/** Marco centrado con la marca, identico al de LoginPage, para todas las pantallas de registro. */
function Shell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10">
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <div className="absolute left-1/2 top-1/3 h-[40rem] w-[40rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-brasa/10 blur-[120px]" />
      </div>

      <div className="relative w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <BrandMark className="h-12 w-12" />
          <h1 className="mt-5 font-display text-2xl font-bold tracking-tight text-hueso">{title}</h1>
          <p className="mt-2 text-sm text-hueso-muted">{subtitle}</p>
        </div>

        <div className="rounded-2xl border border-grafito-border bg-grafito p-7 shadow-2xl shadow-black/40">
          {children}
        </div>
      </div>
    </div>
  );
}

/** Salir de la cuenta actual. AuthProvider detecta el cambio y ProtectedRoute redirige a /login. */
function SignOutLink() {
  return (
    <button
      type="button"
      onClick={() => void supabase.auth.signOut()}
      className="block w-full text-center text-xs text-hueso-muted transition hover:text-hueso"
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
      <div className="grid grid-cols-2 gap-1.5 rounded-lg border border-grafito-border bg-carbon p-1">
        {(['empresa', 'individual'] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => selectMode(value)}
            aria-pressed={mode === value}
            className={
              mode === value
                ? 'rounded-md bg-brasa px-3 py-2 text-sm font-semibold text-carbon'
                : 'rounded-md px-3 py-2 text-sm font-medium text-hueso-muted transition hover:text-hueso'
            }
          >
            {value === 'empresa' ? 'Empresa' : 'Persona'}
          </button>
        ))}
      </div>

      {mode === 'empresa' && (
        <div>
          <label htmlFor="org-name" className="mb-2 block text-sm font-medium text-hueso">
            Nombre de la empresa
          </label>
          <input
            id="org-name"
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
            placeholder="Acme S.A."
            className={inputClass}
          />
          {errors.orgName && <p className="mt-1.5 text-sm text-brasa">{errors.orgName}</p>}
        </div>
      )}

      <div>
        <label htmlFor="full-name" className="mb-2 block text-sm font-medium text-hueso">
          {mode === 'empresa' ? 'Tu nombre (administrador)' : 'Nombre completo'}
        </label>
        <input
          id="full-name"
          autoComplete="name"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder="Ada Lovelace"
          className={inputClass}
        />
        {errors.fullName && <p className="mt-1.5 text-sm text-brasa">{errors.fullName}</p>}
      </div>

      {failed && (
        <p className="text-sm text-brasa">No pudimos completar el registro. Intenta de nuevo.</p>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-lg bg-brasa px-4 py-2.5 text-sm font-semibold text-carbon transition hover:bg-brasa-hover disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitting ? 'Enviando...' : mode === 'empresa' ? 'Registrar empresa' : 'Crear mi cuenta'}
      </button>

      <p className="text-center text-xs text-hueso-muted">
        {mode === 'empresa'
          ? 'Tu empresa quedara en revision hasta ser aprobada.'
          : 'Tu cuenta queda activa de inmediato.'}
      </p>

      <SignOutLink />
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
      <div className="flex min-h-screen items-center justify-center">
        <span className="text-sm text-hueso-muted">Cargando...</span>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <Shell title="Completar registro" subtitle="Necesitamos algunos datos para activar tu cuenta.">
        <div className="text-center">
          <p className="font-display text-lg font-semibold text-hueso">No pudimos cargar tu cuenta</p>
          <p className="mt-2 text-sm text-hueso-muted">Revisa tu conexion e intenta de nuevo.</p>
          <button
            type="button"
            onClick={() => void refetch()}
            className="mt-5 inline-flex items-center gap-2 rounded-lg border border-grafito-border bg-carbon px-4 py-2 text-sm font-medium text-hueso transition hover:border-brasa"
          >
            <RefreshCw className="h-4 w-4" />
            Reintentar
          </button>
        </div>
      </Shell>
    );
  }

  const access = classifyRegistration(data);

  if (access === 'active') {
    return <Navigate to="/agentes" replace />;
  }

  if (access === 'pending') {
    const orgName = data.organization?.name;
    return (
      <Shell title="Registro en revision" subtitle="Estamos verificando tu empresa.">
        <div className="space-y-6 text-center">
          <div>
            <p className="font-display text-lg font-semibold text-hueso">
              Tu registro de empresa esta en revision
            </p>
            <p className="mt-2 text-sm text-hueso-muted">
              {orgName ? (
                <>
                  Estamos revisando <span className="text-hueso">{orgName}</span>. Te avisaremos en
                  cuanto sea aprobada para que puedas entrar.
                </>
              ) : (
                'Estamos revisando tu empresa. Te avisaremos en cuanto sea aprobada para que puedas entrar.'
              )}
            </p>
          </div>
          <SignOutLink />
        </div>
      </Shell>
    );
  }

  return (
    <Shell title="Completar registro" subtitle="Necesitamos algunos datos para activar tu cuenta.">
      <RegistrationForm />
    </Shell>
  );
}
