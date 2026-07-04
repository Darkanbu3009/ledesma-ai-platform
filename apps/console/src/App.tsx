import { Suspense, lazy } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { HomePage } from './pages/HomePage';
import { LoginPage } from './pages/LoginPage';
import { RegistrationPage } from './pages/RegistrationPage';
import { AgentsPage } from './pages/AgentsPage';
import { AgentFormPage } from './pages/AgentFormPage';
import { ConfiguratorPage } from './pages/ConfiguratorPage';
import { CredentialsPage } from './pages/CredentialsPage';
import { ScheduledTasksPage } from './pages/ScheduledTasksPage';
import { TriggersPage } from './pages/TriggersPage';
import { RecipesPage } from './pages/RecipesPage';
import { ActivityPage } from './pages/ActivityPage';
import { PlaygroundPage } from './pages/PlaygroundPage';
import { ConnectPage } from './pages/ConnectPage';
import { UsagePage } from './pages/UsagePage';
import { PrivacyNoticePage } from './pages/PrivacyNoticePage';
import { PrivacySimplifiedNoticePage } from './pages/PrivacySimplifiedNoticePage';
import { PrivacyRightsPage } from './pages/PrivacyRightsPage';
import { ProtectedRoute } from './components/ProtectedRoute';
import { RegistrationGate } from './components/RegistrationGate';
import { ConsentGate } from './components/ConsentGate';
import { AppLayout } from './components/layout/AppLayout';

// El Panel carga Recharts (pesado). Se importa de forma diferida para que su codigo NO entre al bundle
// inicial: solo se descarga al entrar a /dashboard, dejando el resto de la consola sin ese peso.
const DashboardPage = lazy(() =>
  import('./pages/DashboardPage').then((m) => ({ default: m.DashboardPage })),
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
  return (
    <Routes>
      {/* Landing publica de marketing: unica vista sin sesion requerida. Si hay sesion activa,
          HomePage redirige a /agentes (incluido el retorno del magic-link OTP al origen). */}
      <Route path="/" element={<HomePage />} />
      <Route path="/login" element={<LoginPage />} />
      {/* Avisos de privacidad PUBLICOS (sin sesion): enlazables desde la landing, el widget y el flujo
          de consentimiento. Estructura legal + placeholders [REVISION LEGAL PENDIENTE]. */}
      <Route path="/aviso-de-privacidad" element={<PrivacyNoticePage />} />
      <Route path="/aviso-de-privacidad/simplificado" element={<PrivacySimplifiedNoticePage />} />
      <Route element={<ProtectedRoute />}>
        {/* Onboarding: requiere sesion pero no un registro completo. */}
        <Route path="/registro" element={<RegistrationPage />} />
        {/* Dashboard: ademas de sesion, exige registro activo (RegistrationGate) y consentimiento
            vigente (ConsentGate). El ConsentGate cubre todo el dashboard, asi las features autonomas
            quedan gateadas por consentimiento por construccion. */}
        <Route element={<RegistrationGate />}>
          <Route element={<ConsentGate />}>
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
              {/* Observabilidad: historial de ejecuciones (jobs). Solo lectura, sin gate por tier. */}
              <Route path="/actividad" element={<ActivityPage />} />
              {/* Ejercicio de derechos del titular (ARCO/GDPR). */}
              <Route path="/privacidad" element={<PrivacyRightsPage />} />
            </Route>
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/agentes" replace />} />
    </Routes>
  );
}
