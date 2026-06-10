import { Routes, Route, Navigate } from 'react-router-dom';
import { LoginPage } from './pages/LoginPage';
import { AgentsPage } from './pages/AgentsPage';
import { AgentFormPage } from './pages/AgentFormPage';
import { PlaygroundPage } from './pages/PlaygroundPage';
import { ConnectPage } from './pages/ConnectPage';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AppLayout } from './components/layout/AppLayout';

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route path="/agentes" element={<AgentsPage />} />
          <Route path="/agentes/nuevo" element={<AgentFormPage />} />
          <Route path="/agentes/:id" element={<AgentFormPage />} />
          <Route path="/agentes/:id/playground" element={<PlaygroundPage />} />
          <Route path="/agentes/:id/conectar" element={<ConnectPage />} />
        </Route>
      </Route>
      <Route path="/" element={<Navigate to="/agentes" replace />} />
      <Route path="*" element={<Navigate to="/agentes" replace />} />
    </Routes>
  );
}
