import { Outlet } from 'react-router-dom';
import { PageHeader } from '../components/ui/PageHeader';

/**
 * SHELL DE CONFIGURACION (/configuracion): encabezado de seccion (titulo + subtitulo) y la sub-vista
 * activa montada en el Outlet. La ruta base redirige a /configuracion/cuenta (ver App.tsx). Ya no hay
 * barra de tabs: "Mi cuenta" es la vista principal y al catalogo de planes se llega por el sub-item
 * "Mejorar Plan" del sidebar (misma URL de siempre, /configuracion/paquetes).
 */
export function SettingsLayout() {
  return (
    <div className="mx-auto flex min-h-full w-full max-w-5xl flex-col">
      <PageHeader
        title="Configuración"
        subtitle="Administra los datos de tu cuenta y el plan de tu espacio."
      />

      <div className="flex-1">
        <Outlet />
      </div>
    </div>
  );
}
