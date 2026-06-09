import type { ReactNode } from 'react';

export function Field({
  label,
  error,
  children,
  hint,
}: {
  label: string;
  error?: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <div>
      <label className="mb-2 block text-sm font-medium text-hueso">{label}</label>
      {children}
      {hint && !error && <p className="mt-1.5 text-xs text-hueso-muted">{hint}</p>}
      {error && <p className="mt-1.5 text-sm text-brasa">{error}</p>}
    </div>
  );
}

export const inputClass =
  'w-full rounded-lg border border-grafito-border bg-carbon px-3.5 py-2.5 text-sm text-hueso outline-none transition placeholder:text-hueso-muted/60 focus:border-brasa focus:ring-2 focus:ring-brasa/30';
