import { Link } from 'react-router-dom';
import { Button } from '../ui/button';

/**
 * Estado vacio de /actividad (sin ejecuciones): la tabla del historial con su header de columnas,
 * 4 filas fantasma de ejemplo atenuadas y un velo con el mensaje y el CTA. Todo ESTATICO: filas
 * hardcodeadas, sin fetching, sin timers, sin estado. Hoy el estado con datos usa tarjetas
 * (JobActivityCard), asi que estas columnas definen la estructura que usara la tabla real.
 *
 * Paleta: brasa solo en el CTA; semanticos solo en los badges de estado de las filas fantasma
 * (exito #0F6E56 sobre #E1F5EE, fallida #A32D2D sobre #FCEBEB, en curso #5F5E5A sobre #F1EFE8).
 * Resto neutros ya establecidos. Sin box-shadow (el velo es un gradiente blanco, no una sombra).
 */

type EstadoFantasma = 'exito' | 'curso' | 'fallida';

/** Grid compartido por el header y las filas: Estado | Agente | Origen | Duracion | Cuando. */
const GRID = 'grid grid-cols-[90px_1.3fr_1fr_80px_90px] items-center gap-3 px-[18px]';

const BADGE: Record<EstadoFantasma, { label: string; clase: string }> = {
  exito: { label: 'Completada', clase: 'bg-[#E1F5EE] text-[#0F6E56]' },
  curso: { label: 'En curso', clase: 'bg-[#F1EFE8] text-[#5F5E5A]' },
  fallida: { label: 'Fallida', clase: 'bg-[#FCEBEB] text-[#A32D2D]' },
};

const COLUMNAS = ['Estado', 'Agente', 'Origen', 'Duracion', 'Cuando'] as const;

const FILAS = [
  {
    estado: 'exito',
    agente: 'Cuentas por pagar',
    origen: 'Trigger factura-recibida',
    duracion: '1.8s',
    cuando: 'hace 2 min',
  },
  {
    estado: 'curso',
    agente: 'Reporte de ventas',
    origen: 'Tarea diaria 7:30',
    duracion: '12s',
    cuando: 'ahora',
  },
  {
    estado: 'exito',
    agente: 'Cotizaciones',
    origen: 'Playground',
    duracion: '4.1s',
    cuando: 'hace 1 h',
  },
  {
    estado: 'fallida',
    agente: 'Cierre de facturas',
    origen: 'Receta semanal',
    duracion: '0.6s',
    cuando: 'ayer',
  },
] as const satisfies readonly {
  estado: EstadoFantasma;
  agente: string;
  origen: string;
  duracion: string;
  cuando: string;
}[];

/** `ctaTo`: destino del CTA (Playground de un agente existente o /agentes como fallback). */
export function ActivityGhostTable({ ctaTo }: { ctaTo: string }) {
  return (
    <div className="mt-6 overflow-hidden rounded-[14px] border-[0.5px] border-[#E9E7DF] bg-white">
      {/* Header de columnas: queda FUERA del bloque atenuado (opacidad plena). */}
      <div className={`${GRID} border-b-[0.5px] border-[#F1EFE8] py-[10px]`}>
        {COLUMNAS.map((columna, i) => (
          <span
            key={columna}
            className={`text-[11px] uppercase tracking-[0.07em] text-[#B4B2A9] ${
              i === COLUMNAS.length - 1 ? 'text-right' : ''
            }`}
          >
            {columna}
          </span>
        ))}
      </div>

      {/* El velo se ancla a este wrapper para cubrir solo las filas y respetar el header. */}
      <div className="relative">
        {/* Filas fantasma: decorativas (aria-hidden); el contenido informativo es el velo. */}
        <div aria-hidden="true" className="opacity-[0.45]">
          {FILAS.map((fila, i) => (
            <div
              key={fila.agente}
              className={`${GRID} py-[11px] ${
                i < FILAS.length - 1 ? 'border-b-[0.5px] border-[#F1EFE8]' : ''
              }`}
            >
              <span
                className={`inline-flex w-fit items-center whitespace-nowrap rounded-full px-2 py-[2px] font-mono text-[11px] ${BADGE[fila.estado].clase}`}
              >
                {BADGE[fila.estado].label}
              </span>
              <span className="truncate text-[12.5px] text-ink">{fila.agente}</span>
              <span className="truncate text-[12.5px] text-[#8A8880]">{fila.origen}</span>
              <span className="font-mono text-[11px] text-[#8A8880]">{fila.duracion}</span>
              <span className="text-right font-mono text-[11px] text-[#B4B2A9]">
                {fila.cuando}
              </span>
            </div>
          ))}
        </div>

        {/* Velo: gradiente blanco de transparente arriba a ~96% abajo, con el mensaje y el CTA. */}
        <div className="absolute inset-0 flex items-center justify-center bg-[linear-gradient(to_bottom,rgba(255,255,255,0),rgba(255,255,255,0.96))]">
          <div className="max-w-[400px] px-6 text-center">
            <h2 className="text-[17px] font-medium text-ink">Aun no hay ejecuciones</h2>
            <p className="mt-1.5 text-[13px] leading-relaxed text-[#5F5E5A]">
              Cada corrida de tus agentes aparecera aqui: quien la disparo, cuanto tardo y en que
              estado termino.
            </p>
            <div className="mt-4 flex justify-center">
              <Button asChild>
                <Link to={ctaTo}>Probar un agente en el Playground</Link>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
