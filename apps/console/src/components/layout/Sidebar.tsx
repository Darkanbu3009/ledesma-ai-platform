import { NavLink, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Activity,
  Bot,
  CalendarClock,
  ChefHat,
  Globe,
  KeyRound,
  LayoutDashboard,
  PanelLeft,
  ShieldCheck,
  Users,
  Webhook,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../auth/useAuth';
import { useIsAdmin, useMe } from '../../lib/queries';
import { focusRing } from '../../lib/utils';
import { Logo } from '../brand/logo';
import { UserMenu } from './UserMenu';

// Solo las secciones de la app (patron de Claude): Configuracion y Mejorar Plan NO van aqui,
// viven unicamente en el popover del perfil del footer (UserMenu). Por eso, estando en
// /configuracion*, ningun item de esta lista queda activo: es lo esperado.
// Las etiquetas viven en los locales de i18n (claves "nav.*"): este sidebar es la migracion de
// MUESTRA de la fase 1 de internacionalizacion y valida el flujo es-en de punta a punta.
const navItems = [
  { to: '/dashboard', labelKey: 'nav.panel', icon: LayoutDashboard },
  { to: '/agentes', labelKey: 'nav.agentes', icon: Bot },
  { to: '/recetas', labelKey: 'nav.recetas', icon: ChefHat },
  { to: '/tareas', labelKey: 'nav.tareas', icon: CalendarClock },
  { to: '/triggers', labelKey: 'nav.triggers', icon: Webhook },
  { to: '/sitios', labelKey: 'nav.sitios', icon: Globe },
  { to: '/actividad', labelKey: 'nav.actividad', icon: Activity },
  { to: '/credenciales', labelKey: 'nav.credenciales', icon: KeyRound },
  { to: '/privacidad', labelKey: 'nav.privacidad', icon: ShieldCheck },
];

/** Item de nav del area de admin. Solo se agrega cuando useIsAdmin() resuelve true (ver abajo). */
const adminNavItem = { to: '/admin', labelKey: 'nav.admin', icon: Users };

export function Sidebar({
  onNavigate,
  collapsed = false,
  onToggleCollapse,
}: {
  onNavigate?: () => void;
  /** true = modo mini-rail (solo iconos). Lo controla AppLayout; el drawer movil no lo usa. */
  collapsed?: boolean;
  /** Si no llega (drawer movil), el boton de colapso no se renderiza. */
  onToggleCollapse?: () => void;
}) {
  const { user } = useAuth();
  const navigate = useNavigate();
  // t re-renderiza el sidebar cuando cambia el idioma (selector de Configuracion o modal de la landing).
  const { t } = useTranslation();
  // full_name para el menu de usuario: misma fuente que el encabezado de identidad de Mi cuenta
  // (la query ['me'], ya en cache por los gates). Mientras resuelve, el menu cae al email.
  const { data: me } = useMe();
  // Item de admin CONDICIONAL: solo visible para super-admins. No parpadea porque el Sidebar se monta por
  // dentro de RegistrationGate, que ya resolvio /v1/me antes de renderizar el layout: al montar, isAdmin ya
  // es su valor final (un admin lo ve desde el primer paint; un usuario normal nunca). Es UX cosmetica -- el
  // acceso real lo impone el backend (requireAdminRole), no la presencia de este item.
  const { isAdmin } = useIsAdmin();
  const items = isAdmin ? [...navItems, adminNavItem] : navItems;

  async function handleLogout() {
    await supabase.auth.signOut();
    // Tras cerrar sesion se aterriza en la landing publica (/), no en /login: es la puerta de
    // entrada donde el usuario decide volver a entrar o crear cuenta.
    navigate('/', { replace: true });
  }

  function itemClass(isActive: boolean) {
    return [
      'flex items-center gap-3 rounded-xl py-2.5 text-sm transition',
      collapsed ? 'justify-center px-0' : 'px-3',
      focusRing,
      isActive ? 'bg-brasa-soft font-semibold text-brasa' : 'font-medium text-ink-soft hover:bg-line-soft',
    ].join(' ');
  }

  return (
    <aside
      className={[
        'flex h-full flex-col border-r border-line bg-sidebar py-5 transition-[width] duration-200 ease-in-out',
        collapsed ? 'w-16 px-2' : 'w-64 px-4',
      ].join(' ')}
    >
      <div
        className={
          collapsed
            ? 'flex flex-col items-center gap-1 px-0 py-1'
            : 'flex items-center justify-between px-2 py-1'
        }
      >
        {collapsed === false && <Logo tight className="h-10 w-auto" />}
        {onToggleCollapse && (
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label={collapsed ? t('ui.sidebar.expandirPanel') : t('ui.sidebar.colapsarPanel')}
            aria-expanded={collapsed === false}
            title={collapsed ? t('ui.sidebar.expandirPanel') : t('ui.sidebar.colapsarPanel')}
            className={`rounded-lg p-1.5 text-muted transition hover:bg-line-soft hover:text-ink ${focusRing}`}
          >
            {/* Mismo glifo en ambos estados (identico al de Claude): el panel simple sin flechas.
                El estado lo comunican aria-expanded y el aria-label/title, no el icono. */}
            <PanelLeft className="h-[18px] w-[18px]" />
          </button>
        )}
      </div>

      {/* overflow-hidden + nowrap: durante la transicion de ancho las etiquetas no se envuelven
          ni se derraman fuera del rail (el popover del UserMenu vive fuera de este nav). */}
      <nav className="mt-7 flex-1 space-y-1 overflow-hidden whitespace-nowrap">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            onClick={onNavigate}
            title={collapsed ? t(item.labelKey) : undefined}
            className={({ isActive }) => itemClass(isActive)}
          >
            <item.icon className="h-[18px] w-[18px] flex-none" />
            {collapsed === false && t(item.labelKey)}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-line pt-4">
        {/* Boton de cuenta (patron tipo Claude): avatar de inicial + nombre + chevron. Al click
            despliega el menu popover hacia arriba con Configuracion, Mejorar Plan y Cerrar sesion
            (el signOut es el MISMO handleLogout de siempre, pasado por prop). */}
        <UserMenu
          fullName={me?.profile?.fullName}
          email={user?.email}
          onSignOut={() => void handleLogout()}
          onNavigate={onNavigate}
          collapsed={collapsed}
        />
      </div>
    </aside>
  );
}
