import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Loader2, Search, Users } from 'lucide-react';
import { useAdminUsers } from '../lib/queries';
import { accountTypeLabel, formatUserDate, type AdminUserListItem } from '../lib/admin';
import { PageHeader } from '../components/ui/PageHeader';
import { SkeletonList } from '../components/ui/SkeletonList';
import { ErrorState } from '../components/ui/ErrorState';
import { EmptyState } from '../components/ui/EmptyState';
import { inputClass } from '../components/ui/Field';
import { cn, focusRing } from '../lib/utils';
import { AdminBadge, TierBadge } from '../components/admin/UserBadges';

/** Delay del debounce del buscador: evita disparar una consulta por cada tecla. */
const SEARCH_DEBOUNCE_MS = 300;

/** Una fila de la tabla. El email es un Link (foco de teclado); toda la fila navega a la ficha (mouse). */
function UserRow({ user }: { user: AdminUserListItem }) {
  const navigate = useNavigate();
  const to = `/admin/users/${user.id}`;
  return (
    <tr
      onClick={() => navigate(to)}
      className="cursor-pointer border-t border-line-soft transition hover:bg-line-soft/60"
    >
      <td className="px-4 py-3">
        <Link
          to={to}
          onClick={(e) => e.stopPropagation()}
          className={`font-medium text-ink hover:text-brasa ${focusRing} rounded`}
        >
          {user.email ?? 'Sin email'}
        </Link>
        <p className="mt-0.5 text-[13px] text-muted">{user.fullName || 'Sin nombre'}</p>
      </td>
      <td className="px-4 py-3 text-sm text-muted">{accountTypeLabel(user.accountType)}</td>
      <td className="px-4 py-3">
        <TierBadge tier={user.tier} />
      </td>
      <td className="px-4 py-3">
        {user.isAdmin ? <AdminBadge /> : <span className="text-sm text-muted-soft">Usuario</span>}
      </td>
      <td className="px-4 py-3 text-sm text-muted whitespace-nowrap">
        {formatUserDate(user.createdAt)}
      </td>
    </tr>
  );
}

/** Tabla de usuarios (accesible: thead con headers de columna). Envuelta en un scroll horizontal en movil. */
function UsersTable({ users }: { users: AdminUserListItem[] }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-line bg-surface shadow-card">
      <table className="w-full min-w-[640px] border-collapse text-left">
        <thead>
          <tr className="text-xs font-semibold uppercase tracking-wide text-muted-soft">
            <th scope="col" className="px-4 py-3">
              Usuario
            </th>
            <th scope="col" className="px-4 py-3">
              Tipo
            </th>
            <th scope="col" className="px-4 py-3">
              Plan
            </th>
            <th scope="col" className="px-4 py-3">
              Rol
            </th>
            <th scope="col" className="px-4 py-3">
              Registro
            </th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <UserRow key={user.id} user={user} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Pantalla LISTA DE USUARIOS del panel de admin (/admin). Tabla paginada (email, nombre, tier, rol, tipo,
 * registro) con buscador por email/nombre; cada fila lleva a la ficha del usuario. Reusa el patron de
 * pagina-lista de la consola (PageHeader + SkeletonList/ErrorState/EmptyState) y la paginacion "cargar mas"
 * de useJobs. Vive detras del AdminGate; el backend igual gatea por rol.
 */
export function AdminUsersPage() {
  // `input` es lo que se tipea; `search` es el termino ya "asentado" (debounced) que alimenta la query.
  const [input, setInput] = useState('');
  const [search, setSearch] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setSearch(input), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [input]);

  const { data, isLoading, isError, refetch, hasNextPage, fetchNextPage, isFetchingNextPage } =
    useAdminUsers(search);

  const users = useMemo(() => data?.pages.flatMap((page) => page.users) ?? [], [data]);
  const total = data?.pages[0]?.pagination.total ?? 0;
  const searching = search.trim() !== '';

  return (
    <div className="mx-auto flex min-h-full max-w-5xl flex-col">
      <PageHeader
        title="Usuarios"
        subtitle="Administra los planes y consulta la actividad de los usuarios de la plataforma."
      />

      <div className="mt-6 max-w-sm">
        <label htmlFor="admin-user-search" className="sr-only">
          Buscar por email o nombre
        </label>
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-soft"
            aria-hidden="true"
          />
          <input
            id="admin-user-search"
            type="search"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Buscar por email o nombre"
            className={cn(inputClass, 'pl-10')}
          />
        </div>
      </div>

      {isLoading ? (
        <SkeletonList count={1} cardClassName="h-64" className="mt-6" />
      ) : isError ? (
        <ErrorState title="No pudimos cargar los usuarios" onRetry={() => void refetch()} />
      ) : users.length === 0 ? (
        searching ? (
          <div className="mt-6 rounded-2xl border border-line bg-surface p-8 text-center text-sm text-muted shadow-card">
            No encontramos usuarios que coincidan con{' '}
            <span className="font-medium text-ink">«{search.trim()}»</span>.
          </div>
        ) : (
          <EmptyState
            variant="centered"
            media={
              <span className="flex h-[52px] w-[52px] items-center justify-center rounded-2xl bg-brasa-soft text-brasa">
                <Users className="h-6 w-6" />
              </span>
            }
            title="Sin usuarios"
            description="Todavia no hay usuarios registrados en la plataforma."
          />
        )
      ) : (
        <div className="mt-6">
          <p className="mb-3 text-[13px] text-muted">
            {searching ? `${total} resultado${total === 1 ? '' : 's'}` : `${total} usuario${total === 1 ? '' : 's'}`}
          </p>
          <UsersTable users={users} />

          {hasNextPage && (
            <div className="mt-5 flex justify-center">
              <button
                type="button"
                onClick={() => void fetchNextPage()}
                disabled={isFetchingNextPage}
                className={`inline-flex items-center gap-2 rounded-xl border border-line bg-surface px-4 py-2 text-sm font-medium text-muted transition hover:border-ink-soft hover:text-ink disabled:cursor-not-allowed disabled:opacity-60 ${focusRing}`}
              >
                {isFetchingNextPage && <Loader2 className="h-4 w-4 animate-spin" />}
                {isFetchingNextPage ? 'Cargando...' : 'Cargar mas'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
