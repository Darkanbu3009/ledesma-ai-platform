import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { RefreshCw } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { AuthScreen, SubmitButton, authInputClass, authLabelClass } from '../components/AuthScreen';
import { useMe } from '../lib/queries';
import { useRegisterIndividual, useRegisterOrganization } from '../lib/mutations';
import { classifyRegistration, validateName } from '../lib/registration';
import { SplashCarga } from '../components/SplashCarga';

type Mode = 'empresa' | 'individual';

/** Salir de la cuenta actual. Tras cerrar sesion se aterriza en la landing publica (/). */
function SignOutLink() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  async function handleSignOut() {
    await supabase.auth.signOut();
    navigate('/', { replace: true });
  }
  return (
    <button
      type="button"
      onClick={() => void handleSignOut()}
      className="text-xs text-muted-soft transition hover:text-ink"
    >
      {t('registro.cerrarSesion')}
    </button>
  );
}

function RegistrationForm() {
  const { t } = useTranslation();
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
        <h1 className="font-display text-lg font-semibold text-ink">{t('registro.form.titulo')}</h1>
        <p className="mt-1 text-sm text-muted">{t('registro.form.subtitulo')}</p>
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
            {value === 'empresa' ? t('registro.form.empresa') : t('registro.form.persona')}
          </button>
        ))}
      </div>

      {mode === 'empresa' && (
        <div>
          <label htmlFor="org-name" className={authLabelClass}>
            {t('registro.form.nombreEmpresaLabel')}
          </label>
          <input
            id="org-name"
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
            placeholder={t('registro.form.nombreEmpresaPlaceholder')}
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
          {mode === 'empresa' ? t('registro.form.tuNombreAdminLabel') : t('registro.form.nombreCompletoLabel')}
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
          {t('registro.form.errorGenerico')}
        </p>
      )}

      <SubmitButton pending={submitting} pendingLabel={t('auth.comun.enviando')}>
        {mode === 'empresa' ? t('registro.form.registrarEmpresa') : t('registro.form.crearMiCuenta')}
      </SubmitButton>

      <p className="text-center text-xs text-muted-soft">
        {mode === 'empresa'
          ? t('registro.form.empresaActiva')
          : t('registro.form.cuentaActiva')}
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
  const { t } = useTranslation();
  const { data, isLoading, isError, refetch } = useMe();

  if (isLoading) {
    return <SplashCarga />;
  }

  if (isError || !data) {
    return (
      <AuthScreen>
        <div className="text-center">
          <p className="font-display text-lg font-semibold text-ink">{t('registro.errorCarga.titulo')}</p>
          <p className="mt-2 text-sm text-muted">{t('auth.comun.revisaConexion')}</p>
          <button
            type="button"
            onClick={() => void refetch()}
            className="mt-5 inline-flex items-center gap-2 rounded-lg border border-line bg-field px-4 py-2 text-sm font-medium text-ink transition hover:border-brasa"
          >
            <RefreshCw className="h-4 w-4" />
            {t('auth.comun.reintentar')}
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
