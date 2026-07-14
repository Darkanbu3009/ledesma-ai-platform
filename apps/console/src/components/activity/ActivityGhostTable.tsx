import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
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

const BADGE: Record<EstadoFantasma, { labelKey: string; clase: string }> = {
  exito: { labelKey: 'actividad.fantasma.estados.completada', clase: 'bg-[#E1F5EE] text-[#0F6E56]' },
  curso: { labelKey: 'actividad.fantasma.estados.enCurso', clase: 'bg-[#F1EFE8] text-[#5F5E5A]' },
  fallida: { labelKey: 'actividad.fantasma.estados.fallida', clase: 'bg-[#FCEBEB] text-[#A32D2D]' },
};

const COLUMNAS = [
  'actividad.fantasma.columnas.estado',
  'actividad.fantasma.columnas.agente',
  'actividad.fantasma.columnas.origen',
  'actividad.fantasma.columnas.duracion',
  'actividad.fantasma.columnas.cuando',
] as const;

// `origenKey: null` = la fila del Playground: nombre de producto identico en ambos idiomas, no se traduce.
const FILAS = [
  {
    estado: 'exito',
    agenteKey: 'actividad.fantasma.filas.agenteCuentas',
    origenKey: 'actividad.fantasma.filas.origenTrigger',
    duracion: '1.8s',
    cuandoKey: 'actividad.fantasma.filas.cuandoHace2Min',
  },
  {
    estado: 'curso',
    agenteKey: 'actividad.fantasma.filas.agenteVentas',
    origenKey: 'actividad.fantasma.filas.origenTareaDiaria',
    duracion: '12s',
    cuandoKey: 'actividad.fantasma.filas.cuandoAhora',
  },
  {
    estado: 'exito',
    agenteKey: 'actividad.fantasma.filas.agenteCotizaciones',
    origenKey: null,
    duracion: '4.1s',
    cuandoKey: 'actividad.fantasma.filas.cuandoHace1H',
  },
  {
    estado: 'fallida',
    agenteKey: 'actividad.fantasma.filas.agenteCierre',
    origenKey: 'actividad.fantasma.filas.origenReceta',
    duracion: '0.6s',
    cuandoKey: 'actividad.fantasma.filas.cuandoAyer',
  },
] as const satisfies readonly {
  estado: EstadoFantasma;
  agenteKey: string;
  origenKey: string | null;
  duracion: string;
  cuandoKey: string;
}[];

/** `ctaTo`: destino del CTA (Playground de un agente existente o /agentes como fallback). */
export function ActivityGhostTable({ ctaTo }: { ctaTo: string }) {
  const { t } = useTranslation();
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
            {t(columna)}
          </span>
        ))}
      </div>

      {/* El velo se ancla a este wrapper para cubrir solo las filas y respetar el header. */}
      <div className="relative">
        {/* Filas fantasma: decorativas (aria-hidden); el contenido informativo es el velo. */}
        <div aria-hidden="true" className="opacity-[0.45]">
          {FILAS.map((fila, i) => (
            <div
              key={fila.agenteKey}
              className={`${GRID} py-[11px] ${
                i < FILAS.length - 1 ? 'border-b-[0.5px] border-[#F1EFE8]' : ''
              }`}
            >
              <span
                className={`inline-flex w-fit items-center whitespace-nowrap rounded-full px-2 py-[2px] font-mono text-[11px] ${BADGE[fila.estado].clase}`}
              >
                {t(BADGE[fila.estado].labelKey)}
              </span>
              <span className="truncate text-[12.5px] text-ink">{t(fila.agenteKey)}</span>
              <span className="truncate text-[12.5px] text-[#8A8880]">
                {fila.origenKey ? t(fila.origenKey) : 'Playground'}
              </span>
              <span className="font-mono text-[11px] text-[#8A8880]">{fila.duracion}</span>
              <span className="text-right font-mono text-[11px] text-[#B4B2A9]">
                {t(fila.cuandoKey)}
              </span>
            </div>
          ))}
        </div>

        {/* Velo: gradiente blanco de transparente arriba a ~96% abajo, con el mensaje y el CTA. */}
        <div className="absolute inset-0 flex items-center justify-center bg-[linear-gradient(to_bottom,rgba(255,255,255,0),rgba(255,255,255,0.96))]">
          <div className="max-w-[400px] px-6 text-center">
            <h2 className="text-[17px] font-medium text-ink">{t('actividad.fantasma.vacio.titulo')}</h2>
            <p className="mt-1.5 text-[13px] leading-relaxed text-[#5F5E5A]">
              {t('actividad.fantasma.vacio.descripcion')}
            </p>
            <div className="mt-4 flex justify-center">
              <Button asChild>
                <Link to={ctaTo}>{t('actividad.fantasma.vacio.cta')}</Link>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
