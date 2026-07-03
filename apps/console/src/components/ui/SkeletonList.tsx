/**
 * Skeleton de carga compartido: N tarjetas `animate-pulse` con la altura de la tarjeta real. Reemplaza
 * el bloque que cada pantalla de lista redefinia (solo cambiaba la altura y, en Agentes, el layout en
 * grid). No cambia la apariencia: `cardClassName` fija la altura y `className` el contenedor.
 */
export function SkeletonList({
  count = 3,
  cardClassName,
  className = 'mt-6 space-y-3',
}: {
  count?: number;
  /** Clase de la tarjeta (tipicamente la altura, p.ej. `h-[104px]`). Va primero para calzar el markup. */
  cardClassName: string;
  /** Contenedor. Por defecto la lista vertical; Agentes pasa su grid. */
  className?: string;
}) {
  return (
    <div className={className}>
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className={`${cardClassName} animate-pulse rounded-2xl border border-line bg-surface`}
        />
      ))}
    </div>
  );
}
