import { useTranslation } from 'react-i18next';
import { ArrowRight } from 'lucide-react';

/**
 * Inspector de webhook ESTATICO para el gate de Triggers: prueba visual de una URL de webhook
 * con su log de eventos disparando agentes. Todo hardcodeado: sin timers, sin estado, sin
 * animacion. La fila "corriendo" es una marca fija de la maqueta.
 *
 * Paleta: verde solo en la demo (dot del header #1D9E75 y estados "200 ok" #0F6E56); brasa
 * #E5511E solo en el dot "corriendo" y la flecha de la fila activa. Resto neutros calidos.
 * Sin box-shadow.
 */

type EventoDemo = {
  /** Timestamp literal; en la fila activa es una CLAVE de traduccion ("ahora"). */
  hora: string;
  /** CLAVE de traduccion del nombre del evento. */
  evento: string;
  /** CLAVE de traduccion del nombre del agente. */
  agente: string;
  /**
   * Texto del estado; en la fila activa se pinta con el dot brasa y es una CLAVE de traduccion
   * ("corriendo"); en las demas es el literal tecnico ("200 ok 1.8s").
   */
  resultado: string;
  activo: boolean;
};

const EVENTOS: EventoDemo[] = [
  {
    hora: '10:42:07',
    evento: 'gates.triggers.eventoFactura',
    agente: 'gates.triggers.agenteCuentas',
    resultado: '200 ok 1.8s',
    activo: false,
  },
  {
    hora: '11:15:33',
    evento: 'gates.triggers.eventoCotizacion',
    agente: 'gates.triggers.agenteCotizaciones',
    resultado: '200 ok 2.4s',
    activo: false,
  },
  {
    hora: 'gates.triggers.ahora',
    evento: 'gates.triggers.eventoFactura',
    agente: 'gates.triggers.agenteCuentas',
    resultado: 'gates.triggers.corriendo',
    activo: true,
  },
];

export function GateTriggersInspector() {
  const { t } = useTranslation();
  return (
    <div
      aria-hidden="true"
      className="overflow-hidden rounded-[14px] border-[0.5px] border-[#E9E7DF] bg-white"
    >
      {/* Header: dot verde + URL mono del webhook + badge delineado "Ejemplo". */}
      <div className="flex items-center justify-between gap-3 border-b-[0.5px] border-[#F1EFE8] px-[18px] py-[13px]">
        <span className="flex min-w-0 items-center gap-2">
          <span className="h-1.5 w-1.5 flex-none rounded-full bg-[#1D9E75]" />
          <span className="truncate font-mono text-[12px] text-ink">
            POST api.ledesma.ai/t/factura-recibida
          </span>
        </span>
        <span className="flex-none rounded-full border-[0.5px] border-[#E9E7DF] px-[9px] py-[2px] text-[11px] uppercase tracking-[0.07em] text-[#B4B2A9]">
          {t('gates.ejemplo')}
        </span>
      </div>

      {/* Log de eventos. En angosto se oculta la columna de timestamp y, si aun no cabe,
          las filas scrollean en horizontal dentro de la tarjeta. */}
      <div className="overflow-x-auto">
        {EVENTOS.map((item, fila) => {
          const ultima = fila === EVENTOS.length - 1;
          return (
            <div
              key={item.hora}
              className={`grid min-w-[360px] grid-cols-[1.2fr_1fr_96px] items-center gap-3 px-[18px] py-[10px] sm:grid-cols-[74px_1.2fr_1fr_96px] ${
                item.activo ? 'bg-[#FAF9F5]' : ''
              } ${ultima ? '' : 'border-b-[0.5px] border-[#F1EFE8]'}`}
            >
              <span
                className={`hidden font-mono text-[11px] sm:block ${
                  item.activo ? 'text-[#5F5E5A]' : 'text-[#B4B2A9]'
                }`}
              >
                {item.activo ? t(item.hora) : item.hora}
              </span>
              <span
                className={`truncate text-[12.5px] ${
                  item.activo ? 'font-medium text-ink' : 'text-[#5F5E5A]'
                }`}
              >
                {t(item.evento)}
              </span>
              <span className="flex min-w-0 items-center gap-1.5">
                <ArrowRight
                  className={`h-3 w-3 flex-none ${item.activo ? 'text-[#E5511E]' : 'text-[#D3D1C7]'}`}
                />
                <span
                  className={`truncate text-[12.5px] ${
                    item.activo ? 'text-[#5F5E5A]' : 'text-[#8A8880]'
                  }`}
                >
                  {t(item.agente)}
                </span>
              </span>
              {item.activo ? (
                <span className="flex items-center justify-end gap-1.5">
                  <span className="h-1.5 w-1.5 flex-none rounded-full bg-[#E5511E]" />
                  <span className="font-mono text-[11px] text-[#5F5E5A]">{t(item.resultado)}</span>
                </span>
              ) : (
                <span className="text-right font-mono text-[11px] text-[#0F6E56]">
                  {item.resultado}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Pie: la frase de valor + resumen mono. */}
      <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2 border-t-[0.5px] border-[#F1EFE8] bg-[#FAF9F5] px-[18px] py-[11px]">
        <span className="text-[12.5px] text-[#5F5E5A]">{t('gates.triggers.pie')}</span>
        <span className="font-mono text-[11.5px] text-[#8A8880]">{t('gates.triggers.resumen')}</span>
      </div>
    </div>
  );
}
