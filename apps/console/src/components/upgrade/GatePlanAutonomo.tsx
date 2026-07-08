import { Lock } from 'lucide-react';
import type { FeatureContext } from '../../lib/upgrade-requests';
import { RequestUpgradeCta } from './RequestUpgradeCta';

/** Paso de la demo del pipeline. El estado solo decide la piel (fila apagada vs destacada). */
export type GatePaso = {
  num: string;
  titulo: string;
  badge: string;
  estado: 'done' | 'running';
};

/**
 * Gate del plan Autonomo, estilo tech/startup: dos columnas con una demo ESTATICA de una receta
 * "ejecutandose" (pipeline/runtime, sin timers ni estado: los badges son texto fijo) y una tarjeta
 * de acceso minima. Reutilizable en Recetas / Tareas / Triggers via props (en este PR solo se monta
 * en Recetas). El CTA es el RequestUpgradeCta existente sin cambios: mismo flujo upgrade_requests,
 * mismo estado post-solicitud ("Solicitud enviada") y mismo disclaimer.
 *
 * Paleta: brasa solo en el CTA; verde (#1D9E75 / #0F6E56 sobre #E1F5EE) solo dentro de la demo como
 * color semantico de ejecucion. Resto neutros calidos. Sin box-shadow.
 */
export function GatePlanAutonomo({
  nombreReceta,
  demoMeta,
  pasos,
  footerItems,
  titular,
  bullets,
  featureContext,
}: {
  /** Nombre mono de la receta demo, p.ej. "cierre-semanal-facturas". */
  nombreReceta: string;
  /** Metadata derecha del header de la demo, p.ej. "3 pasos · auto". */
  demoMeta: string;
  pasos: GatePaso[];
  /** Datos mono del footer de la demo, p.ej. ["trigger: lunes 8:00", "retry: 2", "alertas: email"]. */
  footerItems: string[];
  /** Titular de la tarjeta de acceso en dos lineas. */
  titular: [string, string];
  bullets: string[];
  featureContext: FeatureContext;
}) {
  return (
    <div className="mt-6 grid gap-3 md:grid-cols-[1.5fr_1fr]">
      {/* Columna izquierda: demo del pipeline. Decorativa, sin interaccion. */}
      <div
        aria-hidden="true"
        className="overflow-hidden rounded-[14px] border-[0.5px] border-[#E9E7DF] bg-white"
      >
        <div className="flex items-center justify-between gap-3 border-b-[0.5px] border-[#F1EFE8] px-[18px] py-3">
          <span className="flex min-w-0 items-center gap-2">
            <span className="h-[7px] w-[7px] flex-none rounded-full bg-[#1D9E75]" />
            <span className="truncate font-mono text-[12.5px] text-ink">{nombreReceta}</span>
          </span>
          <span className="flex-none font-mono text-[11.5px] text-[#8A8880]">{demoMeta}</span>
        </div>

        <div className="px-[18px] py-4">
          <div className="flex flex-col gap-[7px]">
            {pasos.map((paso) => (
              <div
                key={paso.num}
                className={
                  paso.estado === 'running'
                    ? 'flex items-center gap-3 rounded-[9px] border border-[#D3D1C7] bg-white px-3 py-[9px]'
                    : 'flex items-center gap-3 rounded-[9px] border-[0.5px] border-[#E9E7DF] bg-[#FAF9F5] px-3 py-[9px]'
                }
              >
                <span className="flex-none font-mono text-[11.5px] text-[#B4B2A9]">{paso.num}</span>
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">
                  {paso.titulo}
                </span>
                <span
                  className={
                    paso.estado === 'running'
                      ? 'flex-none rounded-full bg-[#F1EFE8] px-2 py-0.5 font-mono text-[11px] text-[#5F5E5A]'
                      : 'flex-none rounded-full bg-[#E1F5EE] px-2 py-0.5 font-mono text-[11px] text-[#0F6E56]'
                  }
                >
                  {paso.badge}
                </span>
              </div>
            ))}
          </div>

          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t-[0.5px] border-[#F1EFE8] pt-3">
            {footerItems.map((item) => (
              <span key={item} className="font-mono text-[11.5px] text-[#8A8880]">
                {item}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Columna derecha: tarjeta de acceso. El CTA y su estado post-solicitud viven en
          RequestUpgradeCta, que se reusa intacto. */}
      <div className="flex flex-col rounded-[14px] border border-[#D3D1C7] bg-white p-[22px]">
        <div className="flex items-center justify-between gap-3">
          <span className="font-mono text-[11.5px] lowercase tracking-[0.06em] text-[#5F5E5A]">
            plan autonomo
          </span>
          <Lock className="h-3.5 w-3.5 flex-none text-[#B4B2A9]" aria-hidden="true" />
        </div>

        <h2 className="mt-4 text-[19px] font-medium leading-[1.25] tracking-[-0.015em] text-ink">
          {titular[0]}
          <br />
          {titular[1]}
        </h2>

        <ul className="mt-4 flex flex-col gap-[7px]">
          {bullets.map((bullet) => (
            <li key={bullet} className="flex items-center gap-2.5 text-[12.5px] text-[#444441]">
              <span className="h-1 w-1 flex-none rounded-full bg-[#5F5E5A]" aria-hidden="true" />
              {bullet}
            </li>
          ))}
        </ul>

        <RequestUpgradeCta
          featureContext={featureContext}
          className="mt-auto items-start pt-6 text-left"
        />
      </div>
    </div>
  );
}
