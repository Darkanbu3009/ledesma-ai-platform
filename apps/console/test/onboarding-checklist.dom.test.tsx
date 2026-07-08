// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import type { OnboardingProgressResult } from '../src/lib/queries';

// El hook de datos se mockea para ejercer la logica de presentacion del checklist (que se muestra, que se
// marca hecho, a donde llevan los CTA) sin red ni react-query.
const { useOnboardingProgressMock } = vi.hoisted(() => ({ useOnboardingProgressMock: vi.fn() }));
vi.mock('../src/lib/queries', () => ({ useOnboardingProgress: useOnboardingProgressMock }));

import { OnboardingChecklist } from '../src/components/onboarding/OnboardingChecklist';

afterEach(() => {
  cleanup();
  useOnboardingProgressMock.mockReset();
});

/** Arma un resultado del hook a partir de las tres senales (deriva completedCount/isComplete como el real). */
function progress(over: Partial<OnboardingProgressResult> = {}): OnboardingProgressResult {
  const hasCredential = over.hasCredential ?? false;
  const hasAgent = over.hasAgent ?? false;
  const hasRun = over.hasRun ?? false;
  const completedCount = (hasCredential ? 1 : 0) + (hasAgent ? 1 : 0) + (hasRun ? 1 : 0);
  return {
    hasCredential,
    hasAgent,
    hasRun,
    completedCount,
    isComplete: completedCount === 3,
    firstAgentId: over.firstAgentId ?? null,
    isLoading: over.isLoading ?? false,
    isError: over.isError ?? false,
    ...over,
  };
}

function renderChecklist(value: OnboardingProgressResult) {
  useOnboardingProgressMock.mockReturnValue(value);
  return render(
    <MemoryRouter>
      <OnboardingChecklist />
    </MemoryRouter>,
  );
}

describe('OnboardingChecklist', () => {
  it('no renderiza nada mientras carga (evita parpadeo)', () => {
    const { container } = renderChecklist(progress({ isLoading: true }));
    expect(container).toBeEmptyDOMElement();
  });

  it('no renderiza nada cuando el onboarding esta completo (no molesta a establecidos)', () => {
    const { container } = renderChecklist(
      progress({ hasCredential: true, hasAgent: true, hasRun: true, firstAgentId: 'a1' }),
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('no renderiza nada ante error (no afirma un estado sin confirmar por el dato real)', () => {
    const { container } = renderChecklist(progress({ isError: true }));
    expect(container).toBeEmptyDOMElement();
  });

  it('usuario nuevo (0/3): muestra bienvenida, 3 pasos pendientes y CTAs a las pantallas correctas', () => {
    renderChecklist(progress());
    // Bienvenida presente.
    expect(screen.getByRole('heading', { name: /Bienvenido a Ledesma AI Labs/ })).toBeInTheDocument();
    expect(screen.getByText('0 de 3')).toBeInTheDocument();
    // Paso 1 (el activo) con CTA a su pantalla; paso 2 bloqueado SIN boton, con la nota del orden.
    expect(screen.getByRole('link', { name: 'Poner credencial' })).toHaveAttribute('href', '/credenciales');
    expect(screen.queryByRole('link', { name: 'Crear agente' })).not.toBeInTheDocument();
    expect(screen.getByText('Despues del paso 1')).toBeInTheDocument();
    // Paso 3 sin agente aun: no hay CTA a un Playground inexistente; se explica el motivo con texto visible.
    expect(screen.queryByRole('link', { name: 'Ejecutar' })).not.toBeInTheDocument();
    expect(screen.getByText('Crea un agente primero')).toBeInTheDocument();
    // La bienvenida lleva al primer paso pendiente (la credencial).
    expect(screen.getByRole('link', { name: /Empezar/ })).toHaveAttribute('href', '/credenciales');
    // Nada marcado como hecho.
    expect(screen.queryByText('Hecho')).not.toBeInTheDocument();
  });

  it('con avance (1/3): oculta la bienvenida y marca hecho el paso cumplido', () => {
    renderChecklist(progress({ hasCredential: true }));
    expect(screen.queryByText(/Bienvenido a Ledesma AI Labs/)).not.toBeInTheDocument();
    expect(screen.getByText('1 de 3')).toBeInTheDocument();
    expect(screen.getByText('Hecho')).toBeInTheDocument();
    // El paso de credencial ya no ofrece su CTA (esta hecho).
    expect(screen.queryByRole('link', { name: 'Poner credencial' })).not.toBeInTheDocument();
  });

  it('con agente creado (2/3): el CTA "Ejecutar" apunta al Playground del primer agente', () => {
    renderChecklist(progress({ hasCredential: true, hasAgent: true, firstAgentId: 'a1' }));
    expect(screen.getByText('2 de 3')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ejecutar' })).toHaveAttribute('href', '/agentes/a1/playground');
  });
});
