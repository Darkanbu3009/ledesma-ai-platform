import { type FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Globe, KeyRound, Languages, LogOut, Pencil } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { LANGUAGE_LABELS, SUPPORTED_LANGUAGES, currentLanguage } from '../i18n';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/useAuth';
import { useMe } from '../lib/queries';
import { useUpdateProfileName, useUpdateProfilePais } from '../lib/mutations';
import { opcionesDePais } from '../lib/paises';
import { updateProfileNameErrorMessage, validateName } from '../lib/registration';
import type { Profile, Subscription, UsageCounter } from '../lib/registration';
import { accountTypeLabel, formatUserDate } from '../lib/admin';
import { Field, inputClass } from '../components/ui/Field';
import { Notice, type NoticeData } from '../components/ui/Notice';
import { SkeletonList } from '../components/ui/SkeletonList';
import { ErrorState } from '../components/ui/ErrorState';
import { Button } from '../components/ui/button';
import { DangerZoneSection } from '../components/account/DangerZoneSection';
import { focusRing } from '../lib/utils';

/** Tarjeta base de los elementos del perfil: superficie blanca plana, hairline y radio comun. */
const cardClass = 'rounded-[14px] border-[0.5px] border-[#E9E7DF] bg-surface';

/**
 * Iniciales para el avatar: primera letra del primer y del ultimo termino del nombre (una sola
 * letra si el nombre tiene un unico termino). Pura; opera sobre el fullName que ya llega en ['me'].
 */
function nameInitials(fullName: string): string {
  const terms = fullName.trim().split(/\s+/).filter(Boolean);
  const first = terms.at(0)?.charAt(0) ?? '';
  const last = terms.length > 1 ? (terms.at(-1)?.charAt(0) ?? '') : '';
  return (first + last).toUpperCase();
}

/**
 * ENCABEZADO DE IDENTIDAD: absorbe las viejas cards "Datos de cuenta" y "Nombre". Avatar de
 * iniciales con dot de suscripcion, nombre con edicion INLINE (el mismo form del PATCH de nombre:
 * misma validacion validateName, mismo payload { fullName } via useUpdateProfileName, mismo
 * deshabilitado por isPending/sin-cambios) y a la derecha los pills de tipo de cuenta y plan mas
 * la fecha de alta. El unico estado nuevo es `editing` (mostrar texto vs mostrar el form).
 */
function IdentityHeader({
  profile,
  email,
  subscription,
}: {
  profile: Profile;
  email: string | undefined;
  subscription: Subscription | null;
}) {
  const { t } = useTranslation();
  const currentName = profile.fullName;
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(currentName);
  const [error, setError] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState<NoticeData | null>(null);
  const mutation = useUpdateProfileName();

  const trimmed = value.trim();
  const unchanged = trimmed === currentName.trim();
  const subscriptionActive = subscription?.status === 'active';

  function startEditing() {
    setValue(currentName);
    setError(undefined);
    setNotice(null);
    setEditing(true);
  }

  function cancelEditing() {
    setValue(currentName);
    setError(undefined);
    setEditing(false);
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const validationError = validateName(value);
    setError(validationError);
    if (validationError) return;
    setNotice(null);
    mutation.mutate(
      { fullName: trimmed },
      {
        onSuccess: () => {
          setNotice({ kind: 'ok', text: t('cuenta.identidad.nombreActualizado') });
          setEditing(false);
        },
        onError: (err) => setNotice({ kind: 'error', text: updateProfileNameErrorMessage(err) }),
      },
    );
  }

  return (
    <section className={`${cardClass} flex flex-wrap items-center gap-[18px] p-[22px]`}>
      <div className="relative flex-none">
        <span
          aria-hidden="true"
          className="flex h-14 w-14 items-center justify-center rounded-full bg-ink text-[19px] font-medium tracking-[0.02em] text-cream"
        >
          {nameInitials(currentName)}
        </span>
        {/* Dot de suscripcion: verde solo cuando la suscripcion esta activa. El texto sr-only
            anuncia el estado a lectores de pantalla (el title solo cubre el hover). */}
        <span
          title={subscriptionActive ? t('cuenta.identidad.suscripcionActiva') : t('cuenta.identidad.sinSuscripcionActiva')}
          className={`absolute -bottom-px -right-px h-[13px] w-[13px] rounded-full border-[2.5px] border-white ${
            subscriptionActive ? 'bg-[#1D9E75]' : 'bg-[#B4B2A9]'
          }`}
        >
          <span className="sr-only">
            {subscriptionActive ? t('cuenta.identidad.suscripcionActiva') : t('cuenta.identidad.sinSuscripcionActiva')}
          </span>
        </span>
      </div>

      <div className="min-w-0 flex-1">
        {editing ? (
          <form onSubmit={handleSubmit} noValidate className="max-w-sm">
            <Field label={t('cuenta.identidad.nombreCompletoLabel')} error={error}>
              <input
                value={value}
                onChange={(e) => {
                  setValue(e.target.value);
                  if (error) setError(undefined);
                }}
                autoComplete="name"
                placeholder="Ada Lovelace"
                autoFocus
                className={inputClass}
              />
            </Field>
            <div className="mt-3 flex gap-2">
              <Button
                type="submit"
                variant="secondary-neutral"
                size="sm"
                disabled={mutation.isPending || unchanged}
              >
                {mutation.isPending ? t('ui.acciones.guardando') : t('ui.acciones.guardar')}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={cancelEditing}
                disabled={mutation.isPending}
              >
                {t('ui.acciones.cancelar')}
              </Button>
            </div>
          </form>
        ) : (
          <div className="flex items-center gap-1.5">
            <h2 className="truncate text-lg font-medium tracking-[-0.01em] text-ink">
              {currentName}
            </h2>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              title={t('cuenta.identidad.editarNombre')}
              aria-label={t('cuenta.identidad.editarNombre')}
              onClick={startEditing}
              className="h-7 w-7 flex-none rounded-lg text-[#8A8880]"
            >
              <Pencil className="h-[14px] w-[14px]" />
            </Button>
          </div>
        )}
        <p className="mt-0.5 truncate text-[13px] text-[#8A8880]">{email ?? t('cuenta.identidad.sinEmail')}</p>
        <Notice notice={notice} className="mt-3" />
      </div>

      <div className="flex flex-col items-end gap-1.5">
        <div className="flex items-center gap-1.5">
          <span className="rounded-full bg-[#F1EFE8] px-2.5 py-1 text-[11.5px] text-[#444441]">
            {accountTypeLabel(profile.accountType)}
          </span>
          <span className="rounded-full bg-[#F1EFE8] px-2.5 py-1 font-mono text-[11px] text-[#444441]">
            {profile.tier}
            {/* El link de upgrade lleva al catalogo self-service (el plan se activa al instante). */}
            {profile.tier !== 'autonomous' && (
              <>
                {' · '}
                <Link
                  to="/configuracion/paquetes"
                  className={`rounded-sm text-brasa-active underline-offset-2 hover:underline ${focusRing}`}
                >
                  upgrade
                </Link>
              </>
            )}
          </span>
        </div>
        <p className="font-mono text-[11px] text-[#B4B2A9]">
          {t('cuenta.identidad.miembroDesde', { fecha: formatUserDate(profile.createdAt) })}
        </p>
      </div>
    </section>
  );
}

/** Umbral del medidor segmentado: por encima, un bloque por ejecucion deja de leerse. */
const MAX_SEGMENTS = 30;

/**
 * USO DEL PERIODO: mismos datos de siempre (usageCounter.runsUsed / runsLimit de ['me'], cero
 * fetching nuevo) presentados como medidor segmentado (un bloque por ejecucion). Si el limite no
 * es segmentable (no entero, <= 0 o > MAX_SEGMENTS) cae a una barra continua proporcional. El
 * enlace de actividad conserva su destino actual (/dashboard).
 */
function UsageSection({ usageCounter, tier }: { usageCounter: UsageCounter | null; tier: string }) {
  const { t } = useTranslation();
  const limit = usageCounter?.runsLimit ?? 0;
  const used = usageCounter?.runsUsed ?? 0;
  const segmentable = Number.isInteger(limit) && limit > 0 && limit <= MAX_SEGMENTS;

  return (
    <section className={`${cardClass} px-[22px] py-[18px]`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div>
          <h2 className="text-[13.5px] font-medium text-ink">{t('cuenta.uso.titulo')}</h2>
          <p className="text-xs text-[#8A8880]">{t('cuenta.uso.descripcion', { plan: tier })}</p>
        </div>
        {usageCounter && (
          <p className="text-[22px] font-medium tabular-nums text-ink">
            {used.toLocaleString('es-MX')}
            <span className="text-[13px] font-normal text-[#B4B2A9]">
              {' '}
              {t('cuenta.uso.deLimite', { limite: limit.toLocaleString('es-MX') })}
            </span>
          </p>
        )}
      </div>

      {usageCounter ? (
        <div role="img" aria-label={t('cuenta.uso.medidorAria', { usadas: used, limite: limit })} className="mt-3.5">
          {segmentable ? (
            <div className="flex gap-[5px]">
              {Array.from({ length: limit }, (_, i) => (
                <span
                  key={i}
                  className={`h-2.5 flex-1 rounded-[3px] ${
                    i < used ? 'bg-ink' : 'border-[0.5px] border-[#E9E7DF] bg-[#F1EFE8]'
                  }`}
                />
              ))}
            </div>
          ) : (
            <div className="h-1.5 overflow-hidden rounded-full bg-[#F1EFE8]">
              <span
                className="block h-full rounded-full bg-ink"
                style={{ width: `${limit > 0 ? Math.min(100, (used / limit) * 100) : 0}%` }}
              />
            </div>
          )}
        </div>
      ) : (
        <p className="mt-3.5 text-sm text-[#8A8880]">{t('cuenta.uso.sinDatos')}</p>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        {segmentable && (
          <p className="text-[11.5px] text-[#B4B2A9]">{t('cuenta.uso.cadaBloque')}</p>
        )}
        <Link
          to="/dashboard"
          className={`ml-auto inline-flex items-center gap-1 rounded-md text-[12.5px] font-medium text-brasa-active transition hover:underline hover:underline-offset-2 ${focusRing}`}
        >
          {t('cuenta.uso.verActividad')}
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </section>
  );
}

/**
 * SESION: fila con icono. El acceso es por correo y contrasena (Supabase Auth); aqui solo se cierra
 * sesion, con el MISMO handler de siempre (supabase.auth.signOut()).
 */
function SessionSection() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  // Tras cerrar sesion se aterriza en la landing publica (/), no en /login.
  async function handleSignOut() {
    await supabase.auth.signOut();
    navigate('/', { replace: true });
  }
  return (
    <section className={`${cardClass} flex flex-wrap items-center gap-3.5 px-[22px] py-4`}>
      <span
        aria-hidden="true"
        className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[9px] bg-[#F1EFE8] text-[#5F5E5A]"
      >
        <KeyRound className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="text-[13.5px] font-medium text-ink">{t('cuenta.sesion.titulo')}</h2>
        <p className="text-xs text-[#8A8880]">
          {t('cuenta.sesion.descripcion')}
        </p>
      </div>
      <Button
        type="button"
        variant="secondary-neutral"
        size="sm"
        onClick={() => void handleSignOut()}
      >
        {t('cuenta.sesion.cerrarSesion')}
        <LogOut className="h-[15px] w-[15px]" />
      </Button>
    </section>
  );
}

/**
 * IDIOMA: fila con segmented control Español / English. Cambia el idioma de la app EN VIVO via
 * i18n.changeLanguage (fase 1 de i18n: solo estan migrados el sidebar y esta seccion; el resto de
 * la app sigue en espanol). La eleccion NO se persiste todavia: vive en la sesion de i18next
 * (estado en memoria de la SPA); cuando el perfil del backend guarde idioma, este es el punto a
 * conectar.
 */
function LanguageSection() {
  const { t, i18n } = useTranslation();
  // Se lee de la instancia del hook (la misma a la que useTranslation suscribe este render), no
  // del singleton del modulo: asi el resaltado no depende de un acople implicito entre ambos.
  const active = currentLanguage(i18n);

  return (
    <section className={`${cardClass} flex flex-wrap items-center gap-3.5 px-[22px] py-4`}>
      <span
        aria-hidden="true"
        className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[9px] bg-[#F1EFE8] text-[#5F5E5A]"
      >
        <Languages className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="text-[13.5px] font-medium text-ink">{t('language.sectionTitle')}</h2>
        <p className="text-xs text-[#8A8880]">{t('language.sectionDescription')}</p>
      </div>
      <div
        role="group"
        aria-label={t('language.sectionTitle')}
        className="flex flex-none rounded-[10px] border-[0.5px] border-[#E9E7DF] bg-[#F1EFE8] p-0.5"
      >
        {SUPPORTED_LANGUAGES.map((language) => (
          <button
            key={language}
            type="button"
            aria-pressed={language === active}
            onClick={() => void i18n.changeLanguage(language)}
            className={`rounded-lg px-3 py-1.5 text-[12.5px] transition ${focusRing} ${
              language === active
                ? 'bg-surface font-medium text-ink shadow-sm'
                : 'text-[#8A8880] hover:text-ink'
            }`}
          >
            {LANGUAGE_LABELS[language]}
          </button>
        ))}
      </div>
    </section>
  );
}

/**
 * PAIS: fila con selector (lista completa ISO 3166-1, nombres localizados via Intl.DisplayNames en
 * el idioma activo). Es el pais DECLARADO que pinea la geolocalizacion del proxy al conectar sitios
 * (profiles.pais): la pagina de Sitios lo pide una vez si falta, y AQUI se edita despues. Guarda al
 * cambiar la seleccion (PATCH /v1/me/profile via useUpdateProfilePais, mismo refresco de ['me'] que
 * el nombre) y muestra el resultado como Notice. Sin efectos: todo se deriva de props y del estado
 * de la mutacion.
 */
function PaisSection({ pais }: { pais: string | null }) {
  const { t, i18n } = useTranslation();
  const [notice, setNotice] = useState<NoticeData | null>(null);
  const mutation = useUpdateProfilePais();
  const opciones = opcionesDePais(i18n.language);

  function handleChange(codigo: string) {
    if (codigo === '' || codigo === pais) return;
    setNotice(null);
    mutation.mutate(
      { pais: codigo },
      {
        onSuccess: () => setNotice({ kind: 'ok', text: t('cuenta.pais.actualizado') }),
        onError: () => setNotice({ kind: 'error', text: t('cuenta.pais.errorActualizar') }),
      },
    );
  }

  return (
    <section className={`${cardClass} flex flex-wrap items-center gap-3.5 px-[22px] py-4`}>
      <span
        aria-hidden="true"
        className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[9px] bg-[#F1EFE8] text-[#5F5E5A]"
      >
        <Globe className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="text-[13.5px] font-medium text-ink">{t('cuenta.pais.titulo')}</h2>
        <p className="text-xs text-[#8A8880]">{t('cuenta.pais.descripcion')}</p>
        <Notice notice={notice} className="mt-2" />
      </div>
      <div className="w-full sm:w-auto">
        <label htmlFor="cuenta-pais" className="sr-only">
          {t('cuenta.pais.titulo')}
        </label>
        <select
          id="cuenta-pais"
          value={pais ?? ''}
          onChange={(e) => handleChange(e.target.value)}
          disabled={mutation.isPending}
          className="h-10 w-full rounded-[10px] border-[0.5px] border-[#E9E7DF] bg-surface px-3 text-[13px] text-ink focus:border-brasa-line focus:outline-none disabled:cursor-not-allowed disabled:opacity-60 sm:w-56"
        >
          <option value="" disabled>
            {t('cuenta.pais.sinPais')}
          </option>
          {opciones.map((opcion) => (
            <option key={opcion.codigo} value={opcion.codigo}>
              {opcion.nombre}
            </option>
          ))}
        </select>
      </div>
    </section>
  );
}

/**
 * PANTALLA DE PERFIL (/configuracion/cuenta, antes /perfil): el usuario ve sus datos de cuenta (email
 * de Supabase + campos de /v1/me), edita SOLO su nombre (PATCH /v1/me/profile via useUpdateProfileName),
 * ve su cuota con enlace al Panel y puede cerrar sesion. Vive como sub-vista del shell de Configuracion
 * (SettingsLayout pone el titulo de seccion y los tabs; por eso ya no trae PageHeader propio), dentro
 * del AppLayout (ProtectedRoute + RegistrationGate + ConsentGate), SIN AdminGate: es para cualquier
 * usuario logueado. Cuatro elementos apilados: encabezado de identidad, uso del periodo, sesion y zona
 * de peligro (que abre el modal de confirmacion fuerte de borrado).
 */
export function ProfilePage() {
  const { t } = useTranslation();
  const { data, isLoading, isError, refetch } = useMe();
  const { user } = useAuth();

  return (
    <div className="max-w-3xl">
      {isLoading ? (
        <SkeletonList count={3} cardClassName="h-40" className="mt-8 space-y-4" />
      ) : isError || !data || !data.profile ? (
        <ErrorState title={t('cuenta.errores.cargarCuenta')} onRetry={() => void refetch()} />
      ) : (
        <div className="mt-8 space-y-3">
          <IdentityHeader
            profile={data.profile}
            email={user?.email}
            subscription={data.subscription}
          />
          <UsageSection usageCounter={data.usageCounter} tier={data.profile.tier} />
          <SessionSection />
          <LanguageSection />
          <PaisSection pais={data.profile.pais} />
          {/* Zona de peligro: fila punteada al final del perfil. Abre el modal de confirmacion fuerte
              (escribir el email) y, tras el borrado, cierra sesion y redirige. El email esperado sale
              de useAuth().user?.email (mismo origen que el encabezado). */}
          <DangerZoneSection email={user?.email} />
        </div>
      )}
    </div>
  );
}
