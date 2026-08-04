import { Suspense, lazy } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { HomePage } from './pages/HomePage';
import { LoginPage } from './pages/LoginPage';
import { SignUpPage } from './pages/SignUpPage';
import { PasswordRecoveryPage } from './pages/PasswordRecoveryPage';
import { NewPasswordPage } from './pages/NewPasswordPage';
import { RegistrationPage } from './pages/RegistrationPage';
import { AgentsPage } from './pages/AgentsPage';
import { AgentFormPage } from './pages/AgentFormPage';
import { ConfiguratorPage } from './pages/ConfiguratorPage';
import { CredentialsPage } from './pages/CredentialsPage';
import { ScheduledTasksPage } from './pages/ScheduledTasksPage';
import { TriggersPage } from './pages/TriggersPage';
import { RecipesPage } from './pages/RecipesPage';
import { TareasEnsenadasPage } from './pages/TareasEnsenadasPage';
import { ActivityPage } from './pages/ActivityPage';
import { SitiosConectadosPage } from './pages/SitiosConectadosPage';
import { PlaygroundPage } from './pages/PlaygroundPage';
import { ConnectPage } from './pages/ConnectPage';
import { UsagePage } from './pages/UsagePage';
import { ProfilePage } from './pages/ProfilePage';
import { SettingsLayout } from './pages/SettingsLayout';
import { PlansPage } from './pages/PlansPage';
import { PrivacyNoticePage } from './pages/PrivacyNoticePage';
import { PrivacySimplifiedNoticePage } from './pages/PrivacySimplifiedNoticePage';
import { TermsPage } from './pages/TermsPage';
import { PrivacyRightsPage } from './pages/PrivacyRightsPage';
import { ProtectedRoute } from './components/ProtectedRoute';
import { RegistrationGate } from './components/RegistrationGate';
import { ConsentGate } from './components/ConsentGate';
import { AdminGate } from './components/AdminGate';
import { AppLayout } from './components/layout/AppLayout';
import { AdminUsersPage } from './pages/AdminUsersPage';
import { useScrollAlTopeEnNavegacion } from './lib/scroll-al-tope';

// El Panel carga Recharts (pesado). Se importa de forma diferida para que su codigo NO entre al bundle
// inicial: solo se descarga al entrar a /dashboard, dejando el resto de la consola sin ese peso.
const DashboardPage = lazy(() =>
  import('./pages/DashboardPage').then((m) => ({ default: m.DashboardPage })),
);

// La ficha de admin reusa las graficas del dashboard (Recharts), asi que tambien se difiere: su chunk
// solo se descarga al abrir /admin/users/:id. La LISTA (/admin) no usa Recharts y va eager.
const AdminUserDetailPage = lazy(() =>
  import('./pages/AdminUserDetailPage').then((m) => ({ default: m.AdminUserDetailPage })),
);

/** Fallback mientras se descarga el chunk del Panel: un bloque con la altura de las tarjetas (sin salto). */
function DashboardChunkFallback() {
  return (
    <div className="mx-auto mt-6 max-w-5xl">
      <div className="h-40 animate-pulse rounded-2xl border border-line bg-surface" />
    </div>
  );
}

export function App() {
  // Toda navegacion del router arranca en el tope (salvo atras/adelante y anclas): la landing y la
  // consola son la misma SPA, asi que sin esto el scroll de una vista se hereda a la siguiente.
  useScrollAlTopeEnNavegacion();

  return (
    <Routes>
      {/* Landing publica de marketing: unica vista sin sesion requerida. Si hay sesion activa,
          HomePage redirige a /agentes. */}
      <Route path="/" element={<HomePage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/crear-cuenta" element={<SignUpPage />} />
      {/* Recuperacion de contrasena: solicitar el enlace (publica) y elegir la nueva
          contrasena (destino del redirectTo del correo de reset de Supabase). */}
      <Route path="/recuperar" element={<PasswordRecoveryPage />} />
      <Route path="/nueva-contrasena" element={<NewPasswordPage />} />
      {/* Documentos legales PUBLICOS (sin sesion): el aviso de privacidad, su version simplificada y los
          terminos de servicio. Publicos A PROPOSITO: el consentimiento solo es informado si el titular
          puede leer el texto ANTES de aceptarlo, y sin sesion (la pantalla de consentimiento enlaza aqui
          en pestana nueva, y el pie de la landing tambien). El texto vive en src/content/legal. */}
      <Route path="/privacidad" element={<PrivacyNoticePage />} />
      <Route path="/privacidad/simplificado" element={<PrivacySimplifiedNoticePage />} />
      <Route path="/terminos" element={<TermsPage />} />
      {/* Compat: las rutas historicas del aviso siguen resolviendo (correos y enlaces ya publicados). */}
      <Route path="/aviso-de-privacidad" element={<Navigate to="/privacidad" replace />} />
      <Route
        path="/aviso-de-privacidad/simplificado"
        element={<Navigate to="/privacidad/simplificado" replace />}
      />
      <Route element={<ProtectedRoute />}>
        {/* El ConsentGate va POR FUERA del registro a proposito: aceptar el aviso y los terminos es lo
            PRIMERO que ocurre tras crear la cuenta o iniciar sesion, antes incluso del formulario de
            registro. Asi ninguna pantalla de la aplicacion (ni el onboarding) se alcanza sin
            consentimiento vigente, y un cambio de version vuelve a bloquear a todos. */}
        <Route element={<ConsentGate />}>
          {/* Onboarding: requiere sesion y consentimiento, pero no un registro completo. */}
          <Route path="/registro" element={<RegistrationPage />} />
          {/* Dashboard: ademas exige registro activo (RegistrationGate). */}
          <Route element={<RegistrationGate />}>
            <Route element={<AppLayout />}>
              {/* Panel: resumen del owner (actividad, operaciones, gasto). Solo lectura, sin gate por
                  tier -- cada quien ve su propio dashboard. Es la primera vista del layout. Diferido
                  (Suspense) para que Recharts no pese en el bundle inicial de las demas vistas. */}
              <Route
                path="/dashboard"
                element={
                  <Suspense fallback={<DashboardChunkFallback />}>
                    <DashboardPage />
                  </Suspense>
                }
              />
              <Route path="/agentes" element={<AgentsPage />} />
              {/* Alta conversacional (Configurador). Aditiva: el alta manual sigue en /agentes/nuevo. */}
              <Route path="/configurador" element={<ConfiguratorPage />} />
              <Route path="/agentes/nuevo" element={<AgentFormPage />} />
              <Route path="/agentes/:id" element={<AgentFormPage />} />
              <Route path="/agentes/:id/playground" element={<PlaygroundPage />} />
              <Route path="/agentes/:id/conectar" element={<ConnectPage />} />
              <Route path="/agentes/:id/uso" element={<UsagePage />} />
              <Route path="/credenciales" element={<CredentialsPage />} />
              <Route path="/tareas" element={<ScheduledTasksPage />} />
              <Route path="/triggers" element={<TriggersPage />} />
              <Route path="/recetas" element={<RecipesPage />} />
              {/* Tareas que el sistema ya sabe hacer (lo que el usuario enseno haciendolo el mismo
                  una vez, mas lo que aprendio solo). Es OTRA cosa que /recetas, que son cadenas de
                  instrucciones para un agente conversacional: tabla distinta, ruta distinta y
                  pantalla distinta a proposito. */}
              <Route path="/ya-sabe-hacer" element={<TareasEnsenadasPage />} />
              {/* Sitios conectados (7.1c): conectar un sitio con login (el usuario se autentica EL
                  MISMO en la vista en vivo), listar y eliminar. Ejecutar tareas alli es 7.1d. */}
              <Route path="/sitios" element={<SitiosConectadosPage />} />
              {/* Observabilidad: historial de ejecuciones (jobs). Solo lectura, sin gate por tier. */}
              <Route path="/actividad" element={<ActivityPage />} />
              {/* Configuracion: shell con dos sub-vistas. "Mi cuenta" es la vista principal (la
                  ruta base redirige aqui) y el catalogo de planes vive en /configuracion/paquetes,
                  accesible desde el sub-item "Mejorar Plan" del sidebar (ya sin tab propio).
                  Para cualquier usuario logueado -- SIN AdminGate (no es area de admin). */}
              <Route path="/configuracion" element={<SettingsLayout />}>
                <Route index element={<Navigate to="/configuracion/cuenta" replace />} />
                <Route path="cuenta" element={<ProfilePage />} />
                <Route path="paquetes" element={<PlansPage />} />
              </Route>
              {/* Compat: /perfil era la URL historica de Mi cuenta; redirige para no romper enlaces. */}
              <Route path="/perfil" element={<Navigate to="/configuracion/cuenta" replace />} />
              {/* Ejercicio de derechos del titular (ARCO/GDPR). Vive en /mis-datos porque /privacidad
                  es ahora la ruta PUBLICA del aviso: la pagina de derechos exige sesion (es donde el
                  titular consulta y descarga LO SUYO) y el aviso no puede exigirla. */}
              <Route path="/mis-datos" element={<PrivacyRightsPage />} />
              {/* Area de ADMIN: vive en el mismo layout pero detras del AdminGate, que devuelve a la
                  home a quien no es super-admin. Guard COSMETICO (UX): la autoridad real es el gate
                  server-side (requireAdminRole) que ya protege los endpoints. La LISTA (/admin) va
                  eager; la FICHA (/admin/users/:id) reusa las graficas del dashboard y por eso se
                  difiere (Suspense) para no cargar Recharts en el bundle inicial. */}
              <Route element={<AdminGate />}>
                <Route path="/admin" element={<AdminUsersPage />} />
                <Route
                  path="/admin/users/:id"
                  element={
                    <Suspense fallback={<DashboardChunkFallback />}>
                      <AdminUserDetailPage />
                    </Suspense>
                  }
                />
              </Route>
            </Route>
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/agentes" replace />} />
    </Routes>
  );
}
