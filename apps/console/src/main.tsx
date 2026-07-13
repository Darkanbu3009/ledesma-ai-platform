import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './auth/AuthProvider';
import { App } from './App';
// Inicializa i18next (initReactI18next registra la instancia por defecto de useTranslation):
// basta importarlo ANTES de renderizar App, sin provider extra en el arbol.
import './i18n';
import './index.css';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('No se encontro el elemento root');

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </QueryClientProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
