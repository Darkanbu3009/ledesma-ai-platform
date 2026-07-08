import {
  cloneElement,
  isValidElement,
  type ButtonHTMLAttributes,
  type ReactElement,
} from 'react';
import { cn } from '../../lib/utils';

type ButtonVariant = 'default' | 'secondary' | 'ghost';
type ButtonSize = 'default' | 'sm' | 'lg' | 'icon';

// Sistema plano de 3 variantes: sin box-shadow en reposo/hover/active (el unico permitido es el
// ring de focus-visible). Los estados hover/active van tras :not(:disabled) para que un boton
// deshabilitado (opacity 0.5 + cursor not-allowed) no reaccione al mouse; el `!` de los actives
// resuelve el empate de especificidad con las reglas de hover mientras se mantiene presionado.
const BASE_CLASSES =
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[10px] text-sm font-medium transition-[background-color,color,border-color,transform] duration-[120ms] ease-[ease] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brasa focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 [&:active:not(:disabled)]:scale-[0.97]';

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  default:
    'bg-brasa text-white [&:hover:not(:disabled)]:bg-brasa-hover [&:active:not(:disabled)]:!bg-brasa-active',
  secondary:
    'border border-brasa bg-transparent text-brasa [&:hover:not(:disabled)]:border-brasa-hover [&:hover:not(:disabled)]:bg-[#FAECE7] [&:hover:not(:disabled)]:text-brasa-hover [&:active:not(:disabled)]:!border-brasa-active [&:active:not(:disabled)]:!bg-[#F5D9CE] [&:active:not(:disabled)]:!text-brasa-active',
  ghost:
    'text-ink [&:hover:not(:disabled)]:bg-ink/[0.06] [&:active:not(:disabled)]:!bg-ink/10',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  default: 'px-6 py-[11px]',
  sm: 'h-9 px-3',
  lg: 'h-11 px-8',
  icon: 'h-10 w-10',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /**
   * Si es true, no renderiza un <button>: clona su unico hijo (un <a> o un <Link>) y le
   * inyecta las clases del boton, fusionando className. Reemplaza al `asChild` de
   * @radix-ui/react-slot para no sumar esa dependencia; cubre el uso de la landing, donde
   * los botones siempre envuelven un enlace.
   */
  asChild?: boolean;
}

export function Button({
  className,
  variant = 'default',
  size = 'default',
  asChild = false,
  children,
  ...props
}: ButtonProps) {
  const classes = cn(BASE_CLASSES, VARIANT_CLASSES[variant], SIZE_CLASSES[size], className);

  if (asChild && isValidElement(children)) {
    const child = children as ReactElement<Record<string, unknown>>;
    return cloneElement(child, {
      ...props,
      className: cn(classes, child.props.className as string | undefined),
    });
  }

  return (
    <button className={classes} {...props}>
      {children}
    </button>
  );
}
