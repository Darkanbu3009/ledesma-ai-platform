import { type HTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

type BadgeVariant = 'default' | 'outline' | 'success';

const BASE_CLASSES =
  'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-medium leading-none whitespace-nowrap';

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  default: 'border-transparent bg-background-tertiary text-foreground',
  outline: 'border-border bg-transparent text-foreground-secondary',
  success: 'border-success/30 bg-success/10 text-success',
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

export function Badge({ className, variant = 'default', ...props }: BadgeProps) {
  return <span className={cn(BASE_CLASSES, VARIANT_CLASSES[variant], className)} {...props} />;
}
