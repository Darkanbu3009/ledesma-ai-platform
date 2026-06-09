import { Routes, Route, Navigate } from 'react-router-dom';
import { LoginPage } from './pages/LoginPage';
import { AgentsPage } from './pages/AgentsPage';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AppLayout } from './components/layout/AppLayout';

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route path="/agentes" element={<AgentsPage />} />
        </Route>
      </Route>
      <Route path="/" element={<Navigate to="/agentes" replace />} />
      <Route path="*" element={<Navigate to="/agentes" replace />} />
    </Routes>
  );
}
