import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
// Inicializa i18next (initReactI18next registra la instancia por defecto de useTranslation). Va
// ANTES del import de App para que la instancia este lista aunque algun modulo del arbol llegue a
// leer traducciones en tiempo de import; no requiere provider extra en el arbol.
import './i18n';
import { AuthProvider } from './auth/AuthProvider';
import { App } from './App';
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
