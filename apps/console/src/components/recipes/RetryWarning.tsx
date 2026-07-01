import { AlertTriangle } from 'lucide-react';

/**
 * ADVERTENCIA DE DISENO (requisito de producto): si una corrida de la receta FALLA, el reintento la
 * re-ejecuta DESDE EL PRIMER PASO (no hay checkpoint por paso). Por eso hay que evitar acciones
 * IRREVERSIBLES en los pasos tempranos (enviar correos, cobrar, publicar): un reintento las repetiria.
 *
 * Nota sobria pero VISIBLE (no un texto gris minusculo): recuadro ambar con icono, para que el usuario
 * la lea al armar la receta. Se muestra en el formulario de alta/edicion.
 */
export function RetryWarning() {
  return (
    <div
      role="note"
      className="flex items-start gap-3 rounded-xl border border-amber-300/70 bg-amber-50 px-4 py-3"
    >
      <AlertTriangle className="mt-0.5 h-[18px] w-[18px] flex-none text-amber-600" />
      <div className="text-[13px] leading-[1.55] text-amber-900">
        <p className="font-semibold">Si una corrida falla, se reintenta desde el primer paso.</p>
        <p className="mt-0.5 text-amber-900/85">
          No hay checkpoint por paso: un reintento vuelve a ejecutar toda la receta. Evita acciones
          irreversibles (enviar correos, cobros, publicar) en los primeros pasos, o hazlas de forma que
          repetirlas no cause dano.
        </p>
      </div>
    </div>
  );
}
