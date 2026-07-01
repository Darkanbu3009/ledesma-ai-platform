import { useEffect, useRef, useState } from 'react';
import { Check, Copy, TriangleAlert } from 'lucide-react';
import { cn } from '../../lib/utils';

type CopyButtonVariant = 'default' | 'primary';

const VARIANT_CLASSES: Record<CopyButtonVariant, string> = {
  // Discreto: el estilo original, usado en /conectar y en cada fila de valor.
  default:
    'gap-1.5 rounded-lg border border-grafito-border px-3 py-1.5 text-xs font-medium text-hueso-muted hover:border-hueso-muted hover:text-hueso',
  // Prominente: para el secreto critico del modal "copia esto ahora". Boton lleno, imposible de ignorar.
  primary:
    'gap-2 rounded-xl bg-brasa px-4 py-2.5 text-sm font-semibold text-white shadow-[0_1px_2px_rgba(31,30,28,0.10)] hover:bg-brasa-hover',
};

/**
 * Boton que copia `text` al portapapeles y confirma con un Check durante 2 segundos. `variant='primary'`
 * lo hace prominente (secreto de una sola vez); `label`/`copiedLabel` personalizan el texto.
 */
export function CopyButton({
  text,
  label = 'Copiar',
  copiedLabel = 'Copiado',
  variant = 'default',
  className,
}: {
  text: string;
  label?: string;
  copiedLabel?: string;
  variant?: CopyButtonVariant;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const timeoutRef = useRef<number | null>(null);

  // Si el usuario navega fuera con el Check/aviso activo, limpiamos el timer pendiente.
  useEffect(
    () => () => {
      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    },
    [],
  );

  function armReset(next: () => void, ms: number) {
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    timeoutRef.current = window.setTimeout(next, ms);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Sin portapapeles (contexto inseguro o permiso denegado): avisamos para que el usuario copie a
      // mano. Critico en el modal "copia esto ahora": no debe creer que copio un secreto que no copio.
      setCopied(false);
      setFailed(true);
      armReset(() => setFailed(false), 3000);
      return;
    }
    setFailed(false);
    setCopied(true);
    armReset(() => setCopied(false), 2000);
  }

  const iconSize = variant === 'primary' ? 'h-4 w-4' : 'h-3.5 w-3.5';
  const currentLabel = failed ? 'Copia a mano' : copied ? copiedLabel : label;

  return (
    <button
      type="button"
      onClick={() => void copy()}
      aria-label={currentLabel}
      className={cn(
        'inline-flex shrink-0 items-center justify-center transition',
        VARIANT_CLASSES[variant],
        className,
      )}
    >
      {failed ? (
        <TriangleAlert className={iconSize} />
      ) : copied ? (
        <Check className={iconSize} />
      ) : (
        <Copy className={iconSize} />
      )}
      {currentLabel}
    </button>
  );
}
