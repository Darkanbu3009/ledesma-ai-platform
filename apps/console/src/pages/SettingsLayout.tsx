import { NavLink, Outlet } from 'react-router-dom';
import { PageHeader } from '../components/ui/PageHeader';
import { focusRing } from '../lib/utils';

/** Sub-secciones de Configuracion. La ruta base (/configuracion) redirige a la primera (ver App.tsx). */
const TABS = [
  { to: '/configuracion/cuenta', label: 'Mi cuenta' },
  { to: '/configuracion/paquetes', label: 'Paquetes' },
] as const;

/**
 * SHELL DE CONFIGURACION (/configuracion): encabezado de seccion (titulo + subtitulo) y los dos tabs
 * pill ("Mi cuenta" y "Paquetes"); la sub-vista activa se monta en el Outlet. Los tabs son NavLink,
 * asi la sub-vista es una URL propia (deep-linkeable) y no estado local. Pill activa greige, pills
 * inactivas delineadas, el mismo lenguaje del filtro de estados de /actividad.
 */
export function SettingsLayout() {
  return (
    <div className="mx-auto flex min-h-full w-full max-w-5xl flex-col">
      <PageHeader
        title="Configuración"
        subtitle="Administra los datos de tu cuenta y el plan de tu espacio."
      />

      <nav aria-label="Secciones de configuración" className="mt-5 flex flex-wrap gap-2">
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            className={({ isActive }) =>
              [
                'rounded-full px-3.5 py-1.5 text-[13px] font-medium transition',
                focusRing,
                isActive
                  ? 'bg-[#F1EFE8] text-ink'
                  : 'border-[0.5px] border-[#E9E7DF] bg-surface text-[#8A8880] hover:text-ink',
              ].join(' ')
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>

      <div className="flex-1">
        <Outlet />
      </div>
    </div>
  );
}
