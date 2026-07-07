import { type FormEvent, type ReactNode, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, LogOut } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/useAuth';
import { useMe } from '../lib/queries';
import { useUpdateProfileName } from '../lib/mutations';
import { updateProfileNameErrorMessage, validateName } from '../lib/registration';
import type { Profile, Subscription, UsageCounter } from '../lib/registration';
import { accountTypeLabel, formatUserDate } from '../lib/admin';
import { TierBadge } from '../components/admin/UserBadges';
import { PageHeader } from '../components/ui/PageHeader';
import { Field, inputClass } from '../components/ui/Field';
import { Notice, type NoticeData } from '../components/ui/Notice';
import { SkeletonList } from '../components/ui/SkeletonList';
import { ErrorState } from '../components/ui/ErrorState';
import { DangerZoneSection } from '../components/account/DangerZoneSection';
import { focusRing } from '../lib/utils';

/** Titulo de seccion consistente con la ficha de admin (h2 + descripcion). */
function SectionHeading({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mb-4">
      <h2 className="font-display text-lg font-bold text-ink">{title}</h2>
      {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
    </div>
  );
}

/** Fila etiqueta -> valor de una lista de definiciones (dl), igual que la ficha de admin. */
function DataRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-t border-line-soft py-3 first:border-t-0 first:pt-0 sm:flex-row sm:gap-4">
      <dt className="text-[13px] text-muted sm:w-44 sm:flex-none">{label}</dt>
      <dd className="text-sm text-ink">{value}</dd>
    </div>
  );
}

/**
 * SECCION DATOS DE CUENTA (solo lectura): email (del cliente Supabase, no de /v1/me), tipo de cuenta,
 * plan/tier (badge), estado de suscripcion (si aplica) y fecha de registro. El tier NO se edita aqui: lo
 * ajusta un administrador (la palanca de monetizacion vive en el panel de admin, no en el perfil).
 */
function AccountDataSection({
  profile,
  email,
  subscription,
}: {
  profile: Profile;
  email: string | undefined;
  subscription: Subscription | null;
}) {
  return (
    <section>
      <SectionHeading
        title="Datos de cuenta"
        description="Tu información de cuenta. Para cambiar de plan lo ajusta un administrador."
      />
      <div className="rounded-2xl border border-line bg-surface p-5 shadow-card">
        <dl>
          <DataRow label="Email" value={email ?? 'Sin email'} />
          <DataRow label="Tipo de cuenta" value={accountTypeLabel(profile.accountType)} />
          <DataRow label="Plan" value={<TierBadge tier={profile.tier} />} />
          {subscription && <DataRow label="Suscripción" value={subscription.status} />}
          <DataRow label="Miembro desde" value={formatUserDate(profile.createdAt)} />
        </dl>
      </div>
    </section>
  );
}

const saveButtonClass =
  'inline-flex items-center gap-2 rounded-[10px] bg-brasa px-[22px] py-[11px] text-sm font-semibold text-white shadow-[0_1px_2px_rgba(31,30,28,0.10)] transition hover:-translate-y-px hover:bg-brasa-hover hover:shadow-[0_2px_6px_rgba(31,30,28,0.14)] disabled:pointer-events-none disabled:opacity-50';

/**
 * SECCION EDITAR NOMBRE: lo UNICO editable del perfil. Form controlado precargado con el nombre actual
 * de ['me'], validado con la MISMA validateName del registro (una sola fuente de verdad) y que al enviar
 * llama al PATCH /v1/me/profile (useUpdateProfileName). Feedback con Notice (aria-live) al exito y al
 * error. El boton se deshabilita mientras corre el PATCH y cuando no hay cambios (evita un PATCH inutil).
 * Estado 100% en React/react-query (sin localStorage).
 */
function EditNameSection({ currentName }: { currentName: string }) {
  const [value, setValue] = useState(currentName);
  const [error, setError] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState<NoticeData | null>(null);
  const mutation = useUpdateProfileName();

  const trimmed = value.trim();
  const unchanged = trimmed === currentName.trim();

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const validationError = validateName(value);
    setError(validationError);
    if (validationError) return;
    setNotice(null);
    mutation.mutate(
      { fullName: trimmed },
      {
        onSuccess: () => setNotice({ kind: 'ok', text: 'Nombre actualizado.' }),
        onError: (err) => setNotice({ kind: 'error', text: updateProfileNameErrorMessage(err) }),
      },
    );
  }

  return (
    <section>
      <SectionHeading
        title="Nombre"
        description="Actualiza el nombre asociado a tu cuenta. Es lo único editable aquí."
      />
      <form
        onSubmit={handleSubmit}
        noValidate
        className="rounded-2xl border border-line bg-surface p-5 shadow-card"
      >
        <Field label="Nombre completo" error={error}>
          <input
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              if (error) setError(undefined);
            }}
            autoComplete="name"
            placeholder="Ada Lovelace"
            className={inputClass}
          />
        </Field>
        <div className="mt-4">
          <button type="submit" disabled={mutation.isPending || unchanged} className={saveButtonClass}>
            {mutation.isPending ? 'Guardando...' : 'Guardar nombre'}
          </button>
        </div>
        <Notice notice={notice} className="mt-4" />
      </form>
    </section>
  );
}

/**
 * SECCION USO / CUOTA: resumen minimo desde usageCounter (runsUsed / runsLimit; maneja null) mas un enlace
 * al Panel. NO reconstruye el dashboard: solo el numero y el enlace a "ver mas".
 */
function UsageSection({ usageCounter }: { usageCounter: UsageCounter | null }) {
  return (
    <section>
      <SectionHeading title="Uso" description="Un resumen de tus ejecuciones." />
      <div className="rounded-2xl border border-line bg-surface p-5 shadow-card">
        {usageCounter ? (
          <>
            <p className="font-display text-2xl font-bold tabular-nums text-ink">
              {usageCounter.runsUsed.toLocaleString('es-MX')}
              <span className="text-muted"> / {usageCounter.runsLimit.toLocaleString('es-MX')}</span>
            </p>
            <p className="mt-0.5 text-xs text-muted">Ejecuciones usadas</p>
          </>
        ) : (
          <p className="text-sm text-muted">Aún no hay datos de uso.</p>
        )}
        <Link
          to="/dashboard"
          className={`mt-4 inline-flex items-center gap-1.5 rounded-md text-sm font-medium text-brasa transition hover:text-brasa-hover ${focusRing}`}
        >
          Ver mi actividad completa
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </section>
  );
}

/**
 * SECCION SESION (minima y honesta): como el login es passwordless (enlace magico), NO hay cambio de
 * contrasena. Se ofrece cerrar sesion reusando el patron del Sidebar (supabase.auth.signOut()); el
 * AuthProvider detecta el cambio y ProtectedRoute redirige a /login. NO incluye eliminar-cuenta (pieza
 * aparte). NO incluye cambiar email (dispararia el flujo de verificacion de Supabase; fuera del minimo).
 */
function SessionSection() {
  return (
    <section>
      <SectionHeading
        title="Sesión"
        description="Tu acceso es por enlace mágico (sin contraseña): no hay contraseña que cambiar."
      />
      <div className="rounded-2xl border border-line bg-surface p-5 shadow-card">
        <button
          type="button"
          onClick={() => void supabase.auth.signOut()}
          className={`inline-flex items-center gap-2 rounded-xl border border-line bg-surface px-4 py-2.5 text-sm font-medium text-muted transition hover:border-brasa-line hover:text-brasa ${focusRing}`}
        >
          <LogOut className="h-[17px] w-[17px]" />
          Cerrar sesión
        </button>
      </div>
    </section>
  );
}

/**
 * PANTALLA DE PERFIL (/perfil): el usuario ve sus datos de cuenta (email de Supabase + campos de /v1/me),
 * edita SOLO su nombre (PATCH /v1/me/profile via useUpdateProfileName), ve un resumen de su cuota con
 * enlace al Panel y puede cerrar sesion. Vive dentro del AppLayout (ProtectedRoute + RegistrationGate +
 * ConsentGate), SIN AdminGate: es para cualquier usuario logueado. Mayormente MUESTRA datos existentes;
 * lo unico que muta es el nombre. Reusa las primitivas y patrones de la consola.
 */
export function ProfilePage() {
  const { data, isLoading, isError, refetch } = useMe();
  const { user } = useAuth();

  return (
    <div className="mx-auto flex min-h-full max-w-3xl flex-col">
      <PageHeader
        title="Mi cuenta"
        subtitle="Consulta los datos de tu cuenta, edita tu nombre y administra tu sesión."
      />

      {isLoading ? (
        <SkeletonList count={3} cardClassName="h-40" className="mt-8 space-y-4" />
      ) : isError || !data || !data.profile ? (
        <ErrorState title="No pudimos cargar tu cuenta" onRetry={() => void refetch()} />
      ) : (
        <div className="mt-8 space-y-10">
          <AccountDataSection
            profile={data.profile}
            email={user?.email}
            subscription={data.subscription}
          />
          <EditNameSection currentName={data.profile.fullName} />
          <UsageSection usageCounter={data.usageCounter} />
          <SessionSection />
          {/* Zona de peligro: separada visualmente (acento de advertencia) al final del perfil. Abre el
              modal de confirmacion fuerte (escribir el email) y, tras el borrado, cierra sesion y redirige.
              El email esperado sale de useAuth().user?.email (mismo origen que la seccion de datos). */}
          <DangerZoneSection email={user?.email} />
        </div>
      )}
    </div>
  );
}
