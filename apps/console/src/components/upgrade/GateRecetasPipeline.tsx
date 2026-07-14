import { useTranslation } from 'react-i18next';
import { Check, Clock } from 'lucide-react';

/**
 * Demo ESTATICA del pipeline de una receta para el gate de Recetas: tabla de ejecucion con dos
 * pasos completados y uno corriendo. Todo hardcodeado: sin timers, sin estado, sin animacion.
 *
 * Paleta: verde #1D9E75 solo en el dot del header y los checks; brasa #E5511E solo en el dot de la
 * fila "running". Resto neutros calidos. Sin box-shadow.
 */

// `titulo` y `descripcion` guardan CLAVES de traduccion; se resuelven con t(...) en el render.
const PASOS_COMPLETADOS = [
  {
    titulo: 'gates.recetas.paso1Titulo',
    descripcion: 'gates.recetas.paso1Descripcion',
    duracion: '3.2s',
  },
  {
    titulo: 'gates.recetas.paso2Titulo',
    descripcion: 'gates.recetas.paso2Descripcion',
    duracion: '6.8s',
  },
] as const;

const PASO_ACTIVO = {
  titulo: 'gates.recetas.paso3Titulo',
  descripcion: 'gates.recetas.paso3Descripcion',
} as const;

export function GateRecetasPipeline() {
  const { t } = useTranslation();
  return (
    <div
      aria-hidden="true"
      className="overflow-hidden rounded-[14px] border-[0.5px] border-[#E9E7DF] bg-white"
    >
      {/* Header: dot verde + nombre mono de la receta, badge delineado "Ejemplo". */}
      <div className="flex items-center justify-between gap-3 border-b-[0.5px] border-[#F1EFE8] px-[18px] py-[13px]">
        <span className="flex min-w-0 items-center gap-2">
          <span className="h-1.5 w-1.5 flex-none rounded-full bg-[#1D9E75]" />
          <span className="truncate font-mono text-[12.5px] text-ink">cierre-semanal-facturas</span>
        </span>
        <span className="flex-none rounded-full border-[0.5px] border-[#E9E7DF] px-[9px] py-[2px] text-[11px] uppercase tracking-[0.07em] text-[#B4B2A9]">
          {t('gates.ejemplo')}
        </span>
      </div>

      {/* Pasos completados: check verde + titulo y descripcion + duracion mono. */}
      {PASOS_COMPLETADOS.map((paso) => (
        <div
          key={paso.titulo}
          className="flex items-start gap-[14px] border-b-[0.5px] border-[#F1EFE8] px-[18px] py-3"
        >
          <Check className="mt-[2px] h-3.5 w-3.5 flex-none text-[#1D9E75]" />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] text-ink">{t(paso.titulo)}</p>
            <p className="text-[12px] text-[#8A8880]">{t(paso.descripcion)}</p>
          </div>
          <span className="flex-none font-mono text-[11px] text-[#B4B2A9]">{paso.duracion}</span>
        </div>
      ))}

      {/* Paso activo: fondo marfil, dot brasa alineado con los checks, "running" mono. */}
      <div className="flex items-start gap-[14px] border-b-[0.5px] border-[#F1EFE8] bg-[#FAF9F5] px-[18px] py-3">
        <span className="mt-[2px] flex h-3.5 w-3.5 flex-none items-center justify-center">
          <span className="h-1.5 w-1.5 rounded-full bg-[#E5511E]" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-ink">{t(PASO_ACTIVO.titulo)}</p>
          <p className="text-[12px] text-[#8A8880]">{t(PASO_ACTIVO.descripcion)}</p>
        </div>
        <span className="flex-none font-mono text-[11px] text-[#5F5E5A]">running</span>
      </div>

      {/* Pie: la frase humana + resumen mono. */}
      <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2 bg-[#FAF9F5] px-[18px] py-[11px]">
        <span className="flex items-center gap-2 text-[11.5px] text-[#5F5E5A]">
          <Clock className="h-[13px] w-[13px] flex-none text-[#B4B2A9]" />
          {t('gates.recetas.pie')}
        </span>
        <span className="font-mono text-[11.5px] text-[#8A8880]">{t('gates.recetas.resumen')}</span>
      </div>
    </div>
  );
}
