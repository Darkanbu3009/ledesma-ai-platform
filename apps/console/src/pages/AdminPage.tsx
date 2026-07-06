import { PageHeader } from '../components/ui/PageHeader';

/**
 * Placeholder del PANEL DE ADMINISTRACION. En esta entrega (andamiaje) la ruta /admin existe solo para
 * que el guard funcione de punta a punta: vive dentro del AppLayout (misma sidebar/layout) y detras del
 * AdminGate, asi un no-admin nunca llega aca. Las pantallas reales (lista de usuarios, ficha, cambio de
 * tier) llegan en una entrega posterior; el backend ya expone esos endpoints, gateados por rol.
 */
export function AdminPage() {
  return (
    <div className="mx-auto flex min-h-full max-w-4xl flex-col">
      <PageHeader
        title="Panel de administración"
        subtitle="Área reservada para super-admins de plataforma."
      />

      <div className="mt-8 rounded-2xl border border-line bg-surface p-8 text-sm text-muted">
        <p>
          Las pantallas de administración (usuarios, ficha y cambio de plan) llegan en una entrega
          próxima. Por ahora esta sección solo confirma que el acceso está reservado a administradores.
        </p>
        <p className="mt-3">
          El acceso lo impone el backend: cada acción de administración se valida server-side por rol,
          así que aunque se fuerce la dirección, un usuario sin permiso no obtiene datos.
        </p>
      </div>
    </div>
  );
}
