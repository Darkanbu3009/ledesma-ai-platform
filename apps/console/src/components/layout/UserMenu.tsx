import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronsUpDown, LogOut, Settings, Sparkles } from 'lucide-react';
import { focusRing } from '../../lib/utils';
import { InitialsAvatar } from '../ui/InitialsAvatar';

/**
 * MENU DE USUARIO del footer del sidebar (patron tipo Claude): un boton de cuenta (avatar de
 * inicial + nombre o email + chevron) que despliega HACIA ARRIBA un menu popover con la cabecera
 * de identidad (avatar mas grande, nombre y email), Configuracion (/configuracion/cuenta),
 * Mejorar Plan (/configuracion/paquetes), un separador y Cerrar sesion (que dispara el MISMO
 * handler de signOut de siempre, recibido por prop). Este menu es el UNICO punto de entrada a
 * esas opciones (patron de Claude): no existen como items del sidebar principal.
 * Solo UI: cero fetching y cero logica de auth propia.
 *
 * Comportamiento: abre/cierra con el boton; se cierra al elegir una opcion, al hacer clic afuera
 * (listener de mousedown en document) y con Escape (que devuelve el foco al boton). Accesible:
 * aria-haspopup/aria-expanded en el boton, role="menu" con menuitems, foco al primer item al abrir
 * y navegacion con flechas dentro del menu.
 */
export function UserMenu({
  fullName,
  email,
  onSignOut,
  onNavigate,
  collapsed = false,
}: {
  fullName: string | undefined;
  email: string | undefined;
  onSignOut: () => void;
  onNavigate?: () => void;
  /** Sidebar en mini-rail: el boton muestra solo el avatar y el popover usa ancho fijo. */
  collapsed?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const menuId = useId();

  useEffect(() => {
    if (open === false) return;

    function handleMouseDown(event: MouseEvent) {
      const container = containerRef.current;
      if (container && container.contains(event.target as Node) === false) setOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }

    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  // Al abrir, el foco pasa al primer item (patron de menu WAI-ARIA).
  useEffect(() => {
    if (open) menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [open]);

  /** Flechas arriba/abajo ciclan el foco entre los items del menu. */
  function handleMenuKeyDown(event: ReactKeyboardEvent) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const items = Array.from(
        menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
      );
      if (items.length === 0) return;
      const current = items.indexOf(document.activeElement as HTMLElement);
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      items[(current + delta + items.length) % items.length]?.focus();
    }
  }

  function handleSettings() {
    setOpen(false);
    onNavigate?.();
    navigate('/configuracion/cuenta');
  }

  /** Catalogo de planes: misma URL de siempre, solo cambia el punto de entrada (este menu). */
  function handleUpgrade() {
    setOpen(false);
    onNavigate?.();
    navigate('/configuracion/paquetes');
  }

  function handleSignOut() {
    setOpen(false);
    onSignOut();
  }

  const displayName = fullName?.trim() ? fullName.trim() : email;
  const itemClass = `flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13.5px] text-ink-soft transition hover:bg-line-soft ${focusRing}`;

  return (
    <div ref={containerRef} className="relative">
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label="Menú de usuario"
          onKeyDown={handleMenuKeyDown}
          className={[
            'absolute bottom-full left-0 z-50 mb-2 rounded-[12px] border-[0.5px] border-[#E9E7DF] bg-surface p-1.5 shadow-card',
            // Colapsado, el contenedor mide ~48px: el popover toma ancho propio en vez de estirarse.
            collapsed ? 'w-56' : 'right-0',
          ].join(' ')}
        >
          {/* Cabecera de identidad del menu: avatar mas grande + nombre y email. */}
          <div className="flex items-center gap-3 border-b-[0.5px] border-[#E9E7DF] px-2.5 pb-3 pt-2">
            <InitialsAvatar fullName={fullName} email={email} className="h-9 w-9 text-[14px]" />
            <div className="min-w-0">
              <p className="truncate text-[13.5px] font-medium leading-tight text-ink">
                {displayName}
              </p>
              <p className="truncate text-xs text-[#8A8880]">{email}</p>
            </div>
          </div>

          <div className="mt-1.5 space-y-0.5">
            <button type="button" role="menuitem" onClick={handleSettings} className={itemClass}>
              <Settings className="h-4 w-4 flex-none text-muted" />
              Configuración
            </button>
            <button type="button" role="menuitem" onClick={handleUpgrade} className={itemClass}>
              <Sparkles className="h-4 w-4 flex-none text-muted" />
              Mejorar Plan
            </button>
          </div>
          <div role="separator" className="my-1.5 border-t-[0.5px] border-[#E9E7DF]" />
          <div className="space-y-0.5">
            <button type="button" role="menuitem" onClick={handleSignOut} className={itemClass}>
              <LogOut className="h-4 w-4 flex-none text-muted" />
              Cerrar sesión
            </button>
          </div>
        </div>
      )}

      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((value) => value === false)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={collapsed ? displayName : undefined}
        className={[
          'flex w-full items-center gap-2.5 rounded-xl py-2 text-sm transition hover:bg-line-soft',
          collapsed ? 'justify-center px-0' : 'px-2',
          focusRing,
        ].join(' ')}
      >
        <InitialsAvatar fullName={fullName} email={email} className="h-[30px] w-[30px] text-[12.5px]" />
        {collapsed === false && (
          <span className="min-w-0 flex-1 truncate text-left font-medium text-ink-soft">
            {displayName}
          </span>
        )}
        {collapsed === false && (
          <ChevronsUpDown className="h-3.5 w-3.5 flex-none text-muted-soft" aria-hidden="true" />
        )}
      </button>
    </div>
  );
}
