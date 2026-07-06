// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import type { AdminUserListItem } from '../src/lib/admin';

// El hook de datos se mockea para ejercer la maquina de estados de la lista (carga/error/vacio/datos) sin
// react-query ni red (mismo patron que dashboard.dom.test.tsx).
const { useAdminUsersMock } = vi.hoisted(() => ({ useAdminUsersMock: vi.fn() }));
vi.mock('../src/lib/queries', () => ({ useAdminUsers: useAdminUsersMock }));

import { AdminUsersPage } from '../src/pages/AdminUsersPage';

afterEach(() => {
  cleanup();
  useAdminUsersMock.mockReset();
});

function user(overrides: Partial<AdminUserListItem>): AdminUserListItem {
  return {
    id: 'u1',
    email: 'ada@example.com',
    fullName: 'Ada Lovelace',
    accountType: 'individual',
    role: 'individual',
    isAdmin: false,
    tier: 'pro',
    identityVerified: true,
    createdAt: '2026-06-10T12:00:00.000Z',
    ...overrides,
  };
}

function mockPage(users: AdminUserListItem[], extra?: { total?: number; hasMore?: boolean }) {
  useAdminUsersMock.mockReturnValue({
    data: {
      pages: [
        {
          users,
          pagination: {
            limit: 20,
            offset: 0,
            total: extra?.total ?? users.length,
            hasMore: extra?.hasMore ?? false,
          },
        },
      ],
      pageParams: [0],
    },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
    hasNextPage: extra?.hasMore ?? false,
    fetchNextPage: vi.fn(),
    isFetchingNextPage: false,
  });
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/admin']}>
      <AdminUsersPage />
    </MemoryRouter>,
  );
}

describe('AdminUsersPage', () => {
  it('muestra el skeleton mientras carga', () => {
    useAdminUsersMock.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      refetch: vi.fn(),
      hasNextPage: false,
      fetchNextPage: vi.fn(),
      isFetchingNextPage: false,
    });
    const { container } = renderPage();
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Usuarios' })).toBeInTheDocument();
  });

  it('muestra ErrorState con reintento cuando falla', () => {
    const refetch = vi.fn();
    useAdminUsersMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch,
      hasNextPage: false,
      fetchNextPage: vi.fn(),
      isFetchingNextPage: false,
    });
    renderPage();
    expect(screen.getByRole('alert')).toHaveTextContent('No pudimos cargar los usuarios');
    fireEvent.click(screen.getByRole('button', { name: /Reintentar/ }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('muestra el EmptyState cuando no hay usuarios (sin busqueda)', () => {
    mockPage([]);
    renderPage();
    expect(screen.getByRole('heading', { name: /Sin usuarios/ })).toBeInTheDocument();
  });

  it('renderiza la tabla con email (link a la ficha), tier y badge de admin', () => {
    mockPage([
      user({ id: 'u1', email: 'ada@example.com', tier: 'pro', isAdmin: false }),
      user({ id: 'u2', email: 'root@example.com', fullName: 'Root', tier: 'autonomous', isAdmin: true }),
    ]);
    renderPage();

    // Encabezados de columna (accesibilidad de la tabla).
    expect(screen.getByRole('columnheader', { name: 'Usuario' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Plan' })).toBeInTheDocument();

    // Cada fila lleva a la ficha por el email (link con href).
    expect(screen.getByRole('link', { name: 'ada@example.com' })).toHaveAttribute(
      'href',
      '/admin/users/u1',
    );
    expect(screen.getByRole('link', { name: 'root@example.com' })).toHaveAttribute(
      'href',
      '/admin/users/u2',
    );

    // Tier y badge de admin.
    expect(screen.getByText('Pro')).toBeInTheDocument();
    expect(screen.getByText('Autónomo')).toBeInTheDocument();
    expect(screen.getByText('Admin')).toBeInTheDocument();
  });

  it('muestra "Cargar mas" y pagina al pulsarlo cuando hay mas', () => {
    const fetchNextPage = vi.fn();
    useAdminUsersMock.mockReturnValue({
      data: {
        pages: [
          {
            users: [user({})],
            pagination: { limit: 20, offset: 0, total: 40, hasMore: true },
          },
        ],
        pageParams: [0],
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
      hasNextPage: true,
      fetchNextPage,
      isFetchingNextPage: false,
    });
    renderPage();
    const button = screen.getByRole('button', { name: /Cargar mas/ });
    fireEvent.click(button);
    expect(fetchNextPage).toHaveBeenCalledTimes(1);
  });
});
