import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';

/** Boton que copia `text` al portapapeles y confirma con un Check durante 2 segundos. */
export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<number | null>(null);

  // Si el usuario navega fuera con el Check activo, limpiamos el timer pendiente.
  useEffect(
    () => () => {
      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    },
    [],
  );

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Sin permiso de portapapeles: no mostramos una confirmacion falsa.
      return;
    }
    setCopied(true);
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    timeoutRef.current = window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      type="button"
      onClick={() => void copy()}
      aria-label="Copiar"
      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-grafito-border px-3 py-1.5 text-xs font-medium text-hueso-muted transition hover:border-hueso-muted hover:text-hueso"
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? 'Copiado' : 'Copiar'}
    </button>
  );
}
