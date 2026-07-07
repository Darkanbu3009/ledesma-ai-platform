import { useEffect, useRef, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { useMyUpgradeRequests } from '../../lib/queries';
import { useRequestUpgrade } from '../../lib/mutations';
import {
  hasActiveUpgradeRequest,
  requestUpgradeErrorMessage,
  type FeatureContext,
} from '../../lib/upgrade-requests';
import { cn, focusRing } from '../../lib/utils';
import { Notice, type NoticeData } from '../ui/Notice';

const buttonClass = cn(
  'inline-flex items-center gap-2 rounded-full bg-brasa px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-brasa-hover disabled:cursor-not-allowed disabled:opacity-60',
  focusRing,
);

/**
 * CTA "Solicitar acceso" para los gates de tier (scheduler / triggers / recetas / configurador). Registra
 * el interes del usuario en el plan Autonomo via POST /v1/upgrade-requests con el `featureContext` de la
 * pagina. NO sube el tier: solo captura el lead (el admin gestiona la conversion; el enforcement server-side
 * queda intacto). Se reusa igual en las 4 superficies para que se sienta consistente.
 *
 * Estados:
 *  - no solicitado -> boton "Solicitar acceso".
 *  - solicitando   -> boton deshabilitado ("Solicitando acceso...").
 *  - ya solicitado -> badge "Solicitud enviada" (no re-ofrece el boton, evita duplicados). Cubre tanto una
 *    solicitud viva previa (GET /me) como el exito recien logrado (idempotente en el backend).
 *  - error         -> Notice de error (region aria-live); el boton sigue visible para reintentar.
 *
 * Accesibilidad: al confirmar EN ESTA SESION el boton se desmonta, asi que movemos el foco al badge de
 * confirmacion (foco enfocable con `tabIndex=-1`) -> el lector de pantalla lee "Solicitud enviada" y el foco
 * no cae al <body>. Una solicitud PREVIA (ya viva al cargar) muestra el badge SIN mover el foco ni anunciarlo
 * en cada visita. Sin localStorage: el estado es react-query.
 */
export function RequestUpgradeCta({
  featureContext,
  className,
}: {
  featureContext: FeatureContext;
  className?: string;
}) {
  const myRequests = useMyUpgradeRequests();
  const requestUpgrade = useRequestUpgrade();
  const [errorText, setErrorText] = useState<string | null>(null);
  const confirmationRef = useRef<HTMLParagraphElement>(null);

  // "Ya solicito" = una solicitud viva previa (GET /me) O el exito de esta sesion (el refetch puede tardar;
  // isSuccess evita un parpadeo del boton entre el POST y la invalidacion).
  const requested = hasActiveUpgradeRequest(myRequests.data) || requestUpgrade.isSuccess;

  // Solo cuando el exito lo disparo el usuario en esta sesion: mover el foco al badge (el boton se fue).
  useEffect(() => {
    if (requestUpgrade.isSuccess) confirmationRef.current?.focus();
  }, [requestUpgrade.isSuccess]);

  function submit() {
    setErrorText(null);
    // requestedTier SIEMPRE 'autonomous' (el unico que hoy desbloquea estas features). El CTA nunca sube el
    // tier: solo registra el interes.
    requestUpgrade.mutate(
      { requestedTier: 'autonomous', featureContext },
      { onError: (err) => setErrorText(requestUpgradeErrorMessage(err)) },
    );
  }

  if (requested) {
    // Badge de confirmacion (mismo look que un Notice 'ok'). Enfocable para recibir el foco tras solicitar;
    // no es una region viva persistente, por eso una solicitud previa no se re-anuncia en cada carga.
    return (
      <div className={cn('flex flex-col items-center gap-3 text-center', className)}>
        <p
          ref={confirmationRef}
          tabIndex={-1}
          className="inline-flex items-center gap-2 rounded-xl border border-ok/30 bg-ok/10 px-3.5 py-2 text-sm font-medium text-ok focus-visible:outline-none"
        >
          <CheckCircle2 className="h-4 w-4" />
          Solicitud enviada · te contactaremos
        </p>
      </div>
    );
  }

  // El error SI va en la region aria-live de Notice: es una transicion iniciada por el usuario (nunca ocurre
  // al cargar), asi que se anuncia correctamente sin falsos positivos.
  const errorNotice: NoticeData | null = errorText ? { kind: 'error', text: errorText } : null;

  return (
    <div className={cn('flex flex-col items-center gap-3 text-center', className)}>
      <button
        type="button"
        onClick={submit}
        disabled={requestUpgrade.isPending || myRequests.isLoading}
        className={buttonClass}
      >
        {requestUpgrade.isPending ? 'Solicitando acceso...' : 'Solicitar acceso'}
      </button>
      <Notice notice={errorNotice} className="" />
      <p className="max-w-xs text-[12px] leading-[1.5] text-muted-soft">
        Registra tu interes en el plan Autonomo. El equipo te contacta para activarlo; no se activa al
        instante.
      </p>
    </div>
  );
}
