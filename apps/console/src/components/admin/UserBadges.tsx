import { ShieldCheck } from 'lucide-react';
import { cn } from '../../lib/utils';
import { tierMeta } from '../../lib/admin';
import type { ProfileTier } from '../../lib/registration';

// Badges de presentacion del panel de admin (pills con la paleta light de la consola). Sin logica: el
// tono y la etiqueta del tier salen de tierMeta (puro, testeable en lib/admin.ts).

const PILL_BASE =
  'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium leading-none whitespace-nowrap';

/** Badge del TIER (Free / Pro / Autonomo) con su tono. */
export function TierBadge({ tier, className }: { tier: ProfileTier; className?: string }) {
  const { label, tone } = tierMeta(tier);
  return <span className={cn(PILL_BASE, tone, className)}>{label}</span>;
}

/**
 * Badge de SUPER-ADMIN de plataforma (profiles.is_admin). Verde (tono ok) con escudo para distinguirlo del
 * badge de tier. Es indicador de un privilegio, no del plan. Se renderiza solo cuando el usuario es admin.
 */
export function AdminBadge({ className }: { className?: string }) {
  return (
    <span className={cn(PILL_BASE, 'border-ok/30 bg-ok/10 text-ok', className)}>
      <ShieldCheck className="h-3 w-3" />
      Admin
    </span>
  );
}
