import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Menu } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { focusRing } from '../../lib/utils';
import { Sidebar } from './Sidebar';
import { AprobacionBanner } from '../aprobaciones/AprobacionBanner';

export function AppLayout() {
  const { t } = useTranslation();
  const [mobileOpen, setMobileOpen] = useState(false);
  // Colapso del sidebar de escritorio (estilo Claude): estado de sesion en React, sin persistencia
  // (el proyecto no guarda preferencias de UI en storage del navegador). El drawer movil no participa.
  // Arranca COLAPSADO por defecto (mini-rail); el usuario lo expande con el toggle y esa eleccion
  // vive solo en la sesion. Recordarla entre sesiones seria via backend, en otro PR.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);

  return (
    <div className="flex min-h-screen">
      <div
        className={[
          'hidden md:block md:flex-shrink-0 transition-[width] duration-200 ease-in-out',
          sidebarCollapsed ? 'md:w-16' : 'md:w-64',
        ].join(' ')}
      >
        <Sidebar
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed((value) => value === false)}
        />
      </div>

      {mobileOpen && (
        <div id="mobile-nav" className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setMobileOpen(false)} aria-hidden="true" />
          <div className="absolute left-0 top-0 h-full">
            <Sidebar onNavigate={() => setMobileOpen(false)} />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-line bg-sidebar px-4 py-3 md:hidden">
          <button
            onClick={() => setMobileOpen(true)}
            className={`rounded-md text-muted transition hover:text-ink ${focusRing}`}
            aria-label={t('ui.layout.abrirMenu')}
            aria-expanded={mobileOpen}
            aria-controls="mobile-nav"
          >
            <Menu className="h-5 w-5" />
          </button>
          <span className="font-display font-semibold text-ink">Ledesma AI Labs</span>
        </header>
        <main className="flex-1 px-6 py-8 sm:px-8 lg:px-10">
          {/* Aviso global de checkpoints de aprobacion pendientes (7.1e); el modal vive en /actividad. */}
          <AprobacionBanner />
          <Outlet />
        </main>
      </div>
    </div>
  );
}
