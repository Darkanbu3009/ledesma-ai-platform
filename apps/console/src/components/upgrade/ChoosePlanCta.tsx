import { Link } from 'react-router-dom';
import { cn, focusRing } from '../../lib/utils';

const linkClass = cn(
  'inline-flex items-center gap-2 rounded-full bg-brasa px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-brasa-hover',
  focusRing,
);

/**
 * CTA "Elegir plan" para los gates de autonomia (tareas / triggers / recetas / configurador): lleva al
 * catalogo self-service (/configuracion/paquetes), donde el usuario ACTIVA el plan al instante.
 * Reemplaza al RequestUpgradeCta como via de desbloqueo: los gates ya no dependen de upgrade_requests
 * (que sigue existiendo solo como canal de contacto/leads); el acceso lo da el plan real elegido.
 */
export function ChoosePlanCta({ className }: { className?: string }) {
  return (
    <div className={cn('flex flex-col items-center gap-3 text-center', className)}>
      <Link to="/configuracion/paquetes" className={linkClass}>
        Elegir plan
      </Link>
      <p className="max-w-xs text-[12px] leading-[1.5] text-muted-soft">
        Activa un plan con autonomia desde el catalogo de paquetes. El cambio aplica al instante.
      </p>
    </div>
  );
}
