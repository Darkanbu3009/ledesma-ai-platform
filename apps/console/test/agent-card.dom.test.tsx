// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';

import i18n from '../src/i18n';
import { AgentCard } from '../src/components/agents/AgentCard';
import type { AgentConfig } from '../src/lib/agents';

const AGENTE: AgentConfig = {
  id: 'ag-1',
  name: 'Cotizador',
  description: 'Cotiza pedidos',
  providerId: 'anthropic',
  model: 'claude-sonnet-5',
  systemPrompt: '',
  maxTokens: 1024,
  temperature: null,
  baseUrl: null,
  tools: [],
  ownerId: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

function renderCard() {
  return render(
    <MemoryRouter>
      <AgentCard agent={AGENTE} />
    </MemoryRouter>,
  );
}

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage('es');
});

describe('AgentCard: acciones', () => {
  it('expone las cuatro acciones con sus destinos, con "Usar agente" apuntando al Playground', () => {
    renderCard();
    expect(screen.getByRole('link', { name: 'Usar Cotizador' })).toHaveAttribute(
      'href',
      '/agentes/ag-1/playground',
    );
    expect(screen.getByRole('link', { name: 'Editar Cotizador' })).toHaveAttribute(
      'href',
      '/agentes/ag-1',
    );
    expect(screen.getByRole('link', { name: 'Conectar Cotizador' })).toHaveAttribute(
      'href',
      '/agentes/ag-1/conectar',
    );
    expect(screen.getByRole('link', { name: 'Uso de Cotizador' })).toHaveAttribute(
      'href',
      '/agentes/ag-1/uso',
    );
  });

  it('usa el nombre unificado en espanol e ingles, sin las variantes viejas', async () => {
    renderCard();
    expect(screen.getByText('Usar agente')).toBeInTheDocument();
    expect(screen.queryByText('Conversar')).not.toBeInTheDocument();
    expect(screen.queryByText('Probar agente')).not.toBeInTheDocument();

    await act(() => i18n.changeLanguage('en'));
    expect(screen.getByText('Use agent')).toBeInTheDocument();
    expect(screen.queryByText('Chat')).not.toBeInTheDocument();
    expect(screen.queryByText('Test agent')).not.toBeInTheDocument();
  });
});
