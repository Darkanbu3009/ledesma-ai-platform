// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { SkeletonList } from '../src/components/ui/SkeletonList';
import { EmptyState } from '../src/components/ui/EmptyState';
import { PageHeader } from '../src/components/ui/PageHeader';
import { Notice } from '../src/components/ui/Notice';
import { ErrorState } from '../src/components/ui/ErrorState';

afterEach(cleanup);

describe('SkeletonList', () => {
  it('renderiza N tarjetas con la altura y el contenedor pedidos', () => {
    const { container } = render(<SkeletonList count={4} cardClassName="h-[104px]" />);
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper).toHaveClass('mt-6', 'space-y-3');
    expect(wrapper.children).toHaveLength(4);
    expect(wrapper.firstElementChild).toHaveClass('h-[104px]', 'animate-pulse');
  });
});

describe('PageHeader', () => {
  it('renderiza el titulo como h1, el subtitulo y la accion', () => {
    render(<PageHeader title="Agentes" subtitle="Sub" action={<button>Crear</button>} />);
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1).toHaveTextContent('Agentes');
    expect(screen.getByText('Sub')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Crear' })).toBeInTheDocument();
  });

  it('omite la accion cuando es falsy (patron hasX &&)', () => {
    render(<PageHeader title="Agentes" subtitle="Sub" action={false} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('Notice', () => {
  it('mantiene la region viva y muestra el aviso cuando existe', () => {
    const { container, rerender } = render(<Notice notice={null} />);
    const region = container.firstElementChild as HTMLElement;
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toBeEmptyDOMElement();
    rerender(<Notice notice={{ kind: 'ok', text: 'Guardado.' }} />);
    expect(screen.getByText('Guardado.')).toBeInTheDocument();
  });
});

describe('ErrorState', () => {
  it('anuncia el error (role=alert) y Reintentar dispara onRetry', () => {
    const onRetry = vi.fn();
    render(<ErrorState title="No pudimos cargar" onRetry={onRetry} />);
    expect(screen.getByRole('alert')).toHaveTextContent('No pudimos cargar');
    fireEvent.click(screen.getByRole('button', { name: /Reintentar/ }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('EmptyState', () => {
  it('editorial: badge, titulo y accion', () => {
    render(
      <EmptyState eyebrow="EMPIEZA AQUI" title="Sin agentes" description="Crea el primero" action={<button>Crear</button>} />,
    );
    expect(screen.getByText('EMPIEZA AQUI')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Sin agentes');
    expect(screen.getByRole('button', { name: 'Crear' })).toBeInTheDocument();
  });

  it('centered: sin badge ni accion', () => {
    render(<EmptyState variant="centered" title="Bloqueado" description="Plan Autonomo" />);
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Bloqueado');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
