import { Routes, Route, Navigate } from 'react-router-dom';
import { HomePage } from './pages/HomePage';
import { LoginPage } from './pages/LoginPage';
import { RegistrationPage } from './pages/RegistrationPage';
import { AgentsPage } from './pages/AgentsPage';
import { AgentFormPage } from './pages/AgentFormPage';
import { PlaygroundPage } from './pages/PlaygroundPage';
import { ConnectPage } from './pages/ConnectPage';
import { UsagePage } from './pages/UsagePage';
import { ProtectedRoute } from './components/ProtectedRoute';
import { RegistrationGate } from './components/RegistrationGate';
import { AppLayout } from './components/layout/AppLayout';

export function App() {
  return (
    <Routes>
      {/* Landing publica de marketing: unica vista sin sesion requerida. Si hay sesion activa,
          HomePage redirige a /agentes (incluido el retorno del magic-link OTP al origen). */}
      <Route path="/" element={<HomePage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedRoute />}>
        {/* Onboarding: requiere sesion pero no un registro completo. */}
        <Route path="/registro" element={<RegistrationPage />} />
        {/* Dashboard: ademas de sesion, exige registro activo (RegistrationGate). */}
        <Route element={<RegistrationGate />}>
          <Route element={<AppLayout />}>
            <Route path="/agentes" element={<AgentsPage />} />
            <Route path="/agentes/nuevo" element={<AgentFormPage />} />
            <Route path="/agentes/:id" element={<AgentFormPage />} />
            <Route path="/agentes/:id/playground" element={<PlaygroundPage />} />
            <Route path="/agentes/:id/conectar" element={<ConnectPage />} />
            <Route path="/agentes/:id/uso" element={<UsagePage />} />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/agentes" replace />} />
    </Routes>
  );
}
