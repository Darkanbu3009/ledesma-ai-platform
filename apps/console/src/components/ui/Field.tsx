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
      <label className="mb-2 block text-sm font-medium text-ink">{label}</label>
      {children}
      {hint && !error && <p className="mt-1.5 text-xs text-muted">{hint}</p>}
      {error && <p className="mt-1.5 text-sm text-brasa">{error}</p>}
    </div>
  );
}

export const inputClass =
  'w-full rounded-xl border border-line bg-field px-3.5 py-2.5 text-sm text-ink outline-none transition placeholder:text-muted-soft focus:border-brasa focus:ring-2 focus:ring-brasa/20';
