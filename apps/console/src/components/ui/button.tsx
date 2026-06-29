import {
  cloneElement,
  isValidElement,
  type ButtonHTMLAttributes,
  type ReactElement,
} from 'react';
import { cn } from '../../lib/utils';

type ButtonVariant = 'default' | 'secondary' | 'ghost' | 'outline' | 'link';
type ButtonSize = 'default' | 'sm' | 'lg' | 'icon';

const BASE_CLASSES =
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50';

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  default: 'bg-accent text-white hover:bg-accent-hover',
  secondary:
    'border border-border bg-background-secondary text-foreground hover:bg-background-tertiary',
  ghost: 'text-foreground hover:bg-background-secondary',
  outline: 'border border-border bg-transparent hover:bg-background-secondary',
  link: 'text-accent underline-offset-4 hover:underline',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  default: 'h-10 px-4 py-2',
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
