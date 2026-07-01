import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, CalendarClock, CheckCircle2, Plus, RefreshCw, Sparkles } from 'lucide-react';
import { useAgents, useCredentials, useMe, useScheduledTasks } from '../lib/queries';
import { useDeleteScheduledTask, useUpdateScheduledTask } from '../lib/mutations';
import type { ScheduledTask } from '../lib/scheduled-tasks';
import { describeCron } from '../lib/schedule';
import { ScheduledTaskCard } from '../components/scheduled-tasks/ScheduledTaskCard';
import { ScheduledTaskFormDialog } from '../components/scheduled-tasks/ScheduledTaskFormDialog';
import { DeleteScheduledTaskDialog } from '../components/scheduled-tasks/DeleteScheduledTaskDialog';

const addButtonClass =
  'inline-flex items-center gap-2 rounded-[10px] bg-brasa px-[22px] py-[11px] text-sm font-semibold text-white shadow-[0_1px_2px_rgba(31,30,28,0.10)] transition hover:-translate-y-px hover:bg-brasa-hover hover:shadow-[0_2px_6px_rgba(31,30,28,0.14)]';

type Notice = { kind: 'ok' | 'error'; text: string };

/** Aviso: las tareas programadas son del plan Autonomo. Sobrio, no un paywall agresivo. */
function SchedulingLocked() {
  return (
    <div className="mt-10 flex flex-1 flex-col items-center justify-center text-center">
      <span className="flex h-[52px] w-[52px] items-center justify-center rounded-2xl bg-brasa-soft text-brasa">
        <Sparkles className="h-6 w-6" />
      </span>
      <h2 className="mt-5 max-w-md font-display text-[22px] font-bold leading-[1.2] text-ink">
        Una funcion del plan Autonomo
      </h2>
      <p className="mt-3 max-w-md text-[13px] leading-[1.6] text-muted">
        Las tareas programadas ejecutan tus agentes solos, en el horario que elijas. Estan
        disponibles en el plan Autonomo. Cuando lo actives, vas a poder programarlas desde aqui.
      </p>
    </div>
  );
}

/** Estado vacio editorial, consistente con /credenciales. */
function TasksEmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center text-center">
      {/* Maqueta decorativa de "asi se vera tu tarea". No interactiva. */}
      <div className="mb-10 hidden md:block">
        <div
          aria-hidden="true"
          className="w-[250px] rounded-2xl border border-line-soft bg-surface p-[18px] shadow-card"
        >
          <div className="flex items-center gap-3">
            <span className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-[10px] bg-brasa-soft text-brasa">
              <CalendarClock className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1 space-y-2">
              <span className="block h-2.5 w-[110px] rounded-full bg-line" />
              <span className="block h-2 w-[70px] rounded-full bg-line-soft" />
            </div>
            <span className="block h-[22px] w-[52px] flex-none rounded-full bg-ok/15" />
          </div>
          <div className="mt-[18px] flex items-center gap-2">
            <span className="block h-2 w-[130px] rounded-full bg-line-soft" />
          </div>
        </div>
      </div>
      <span className="inline-flex items-center rounded-md bg-brasa-soft px-2.5 py-1 text-[11px] font-semibold tracking-wide text-[#993C1D]">
        EMPIEZA AQUI
      </span>
      <h2 className="mt-4 max-w-md font-display text-[22px] font-bold leading-[1.2] text-ink">
        Programa tu primer agente
      </h2>
      <p className="mt-3 max-w-md text-[13px] leading-[1.5] text-muted">
        Elige un agente, el mensaje que ejecutara y cada cuanto corre. La plataforma lo dispara sola
        en el horario que definas.
      </p>
      <div className="mt-7">
        <button
          type="button"
          onClick={onAdd}
          className="group inline-flex h-11 items-center gap-3 rounded-full bg-brasa pl-6 pr-[7px] text-sm font-medium text-white transition hover:bg-brasa-hover"
        >
          Programar tarea
          <span className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-white text-brasa transition group-hover:translate-x-0.5">
            <ArrowRight className="h-[18px] w-[18px]" />
          </span>
        </button>
      </div>
    </div>
  );
}

export function ScheduledTasksPage() {
  const me = useMe();
  const isAutonomous = me.data?.profile?.tier === 'autonomous';

  const { data: tasks, isLoading, isError, refetch } = useScheduledTasks();
  const { data: agents, isLoading: agentsLoading } = useAgents();
  const { data: credentials } = useCredentials();
  const updateTask = useUpdateScheduledTask();
  const deleteTask = useDeleteScheduledTask();

  const [formOpen, setFormOpen] = useState(false);
  const [toDelete, setToDelete] = useState<ScheduledTask | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  // El aviso se descarta solo a los pocos segundos.
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  const agentsById = useMemo(
    () => new Map((agents ?? []).map((agent) => [agent.id, agent])),
    [agents],
  );
  const credentialsById = useMemo(
    () => new Map((credentials ?? []).map((cred) => [cred.id, cred])),
    [credentials],
  );

  const hasTasks = Array.isArray(tasks) && tasks.length > 0;
  const listLoading = isLoading || agentsLoading;

  function toggleActive(task: ScheduledTask) {
    setTogglingId(task.id);
    updateTask.mutate(
      { id: task.id, patch: { isActive: !task.isActive } },
      {
        onSuccess: () =>
          setNotice({ kind: 'ok', text: task.isActive ? 'Tarea pausada.' : 'Tarea activada.' }),
        onError: () =>
          setNotice({ kind: 'error', text: 'No pudimos actualizar la tarea. Intenta de nuevo.' }),
        onSettled: () => setTogglingId(null),
      },
    );
  }

  function openDelete(task: ScheduledTask) {
    deleteTask.reset();
    setToDelete(task);
  }

  function confirmDelete() {
    if (!toDelete) return;
    deleteTask.mutate(toDelete.id, {
      onSuccess: () => {
        setToDelete(null);
        setNotice({ kind: 'ok', text: 'Tarea eliminada.' });
      },
    });
  }

  function deleteDescription(task: ScheduledTask | null): string {
    if (!task) return '';
    const agentName = agentsById.get(task.agentId)?.name ?? 'agente eliminado';
    const schedule = describeCron(task.cronExpression) ?? task.cronExpression;
    return `${agentName} · ${schedule}`;
  }

  return (
    <div className="mx-auto flex min-h-full max-w-4xl flex-col">
      <div className="flex items-start justify-between gap-5">
        <div>
          <h1 className="font-display text-3xl font-extrabold tracking-tight text-ink">
            Tareas programadas
          </h1>
          <p className="mt-1.5 text-[15px] text-muted">
            Programa a tus agentes para que se ejecuten solos, en el horario que elijas.
          </p>
        </div>
        {isAutonomous && hasTasks && (
          <button type="button" onClick={() => setFormOpen(true)} className={addButtonClass}>
            <Plus className="h-[17px] w-[17px]" />
            Programar tarea
          </button>
        )}
      </div>

      <div className="mt-3" aria-live="polite">
        {notice && (
          <div
            className={[
              'inline-flex items-center gap-2 rounded-xl border px-3.5 py-2 text-sm font-medium',
              notice.kind === 'ok'
                ? 'border-ok/30 bg-ok/10 text-ok'
                : 'border-brasa-line bg-brasa-soft text-brasa',
            ].join(' ')}
          >
            {notice.kind === 'ok' && <CheckCircle2 className="h-4 w-4" />}
            {notice.text}
          </div>
        )}
      </div>

      {me.isLoading ? (
        <div className="mt-6 space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-[104px] animate-pulse rounded-2xl border border-line bg-surface" />
          ))}
        </div>
      ) : !isAutonomous ? (
        <SchedulingLocked />
      ) : listLoading ? (
        <div className="mt-6 space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-[104px] animate-pulse rounded-2xl border border-line bg-surface" />
          ))}
        </div>
      ) : isError ? (
        <div className="mt-10 rounded-2xl border border-line bg-surface p-8 text-center shadow-card">
          <p className="font-display text-lg font-bold text-ink">No pudimos cargar tus tareas</p>
          <p className="mt-2 text-sm text-muted">Revisa tu conexion e intenta de nuevo.</p>
          <button
            type="button"
            onClick={() => void refetch()}
            className="mt-5 inline-flex items-center gap-2 rounded-xl border border-line bg-surface px-4 py-2 text-sm font-medium text-muted transition hover:border-ink-soft hover:text-ink"
          >
            <RefreshCw className="h-4 w-4" />
            Reintentar
          </button>
        </div>
      ) : !hasTasks ? (
        <TasksEmptyState onAdd={() => setFormOpen(true)} />
      ) : (
        <div className="mt-6 space-y-3">
          {tasks.map((task) => (
            <ScheduledTaskCard
              key={task.id}
              task={task}
              agentName={agentsById.get(task.agentId)?.name ?? null}
              credentialLabel={credentialsById.get(task.credentialId)?.label ?? null}
              toggling={togglingId === task.id}
              onToggle={() => toggleActive(task)}
              onDelete={() => openDelete(task)}
            />
          ))}
          <button
            type="button"
            onClick={() => setFormOpen(true)}
            className="flex w-full items-center justify-center gap-2 rounded-2xl border-[1.5px] border-dashed border-line p-4 text-sm font-semibold text-muted transition hover:border-brasa-line hover:bg-brasa/[0.03] hover:text-brasa"
          >
            <Plus className="h-[18px] w-[18px]" />
            Programar tarea
          </button>
        </div>
      )}

      {formOpen && isAutonomous && (
        <ScheduledTaskFormDialog
          onClose={() => setFormOpen(false)}
          onCreated={() => setNotice({ kind: 'ok', text: 'Tarea programada.' })}
        />
      )}

      <DeleteScheduledTaskDialog
        open={toDelete !== null}
        description={deleteDescription(toDelete)}
        busy={deleteTask.isPending}
        error={deleteTask.isError ? 'No pudimos eliminar la tarea. Intenta de nuevo.' : undefined}
        onConfirm={confirmDelete}
        onCancel={() => setToDelete(null)}
      />
    </div>
  );
}
