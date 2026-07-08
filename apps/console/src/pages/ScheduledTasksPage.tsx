import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, CalendarClock, Lock, Plus } from 'lucide-react';
import { useAgents, useCredentials, useMe, useScheduledTasks } from '../lib/queries';
import { useDeleteScheduledTask, useUpdateScheduledTask } from '../lib/mutations';
import type { ScheduledTask } from '../lib/scheduled-tasks';
import { describeCron } from '../lib/schedule';
import { ScheduledTaskCard } from '../components/scheduled-tasks/ScheduledTaskCard';
import { ScheduledTaskFormDialog } from '../components/scheduled-tasks/ScheduledTaskFormDialog';
import { DeleteScheduledTaskDialog } from '../components/scheduled-tasks/DeleteScheduledTaskDialog';
import { PageHeader } from '../components/ui/PageHeader';
import { SkeletonList } from '../components/ui/SkeletonList';
import { ErrorState } from '../components/ui/ErrorState';
import { EmptyState } from '../components/ui/EmptyState';
import { Notice, type NoticeData } from '../components/ui/Notice';
import { RequestUpgradeCta } from '../components/upgrade/RequestUpgradeCta';
import { GateTareasTablero } from '../components/upgrade/GateTareasTablero';

const addButtonClass =
  'inline-flex items-center gap-2 rounded-[10px] bg-brasa px-[22px] py-[11px] text-sm font-semibold text-white shadow-[0_1px_2px_rgba(31,30,28,0.10)] transition hover:-translate-y-px hover:bg-brasa-hover hover:shadow-[0_2px_6px_rgba(31,30,28,0.14)]';

/**
 * Gate del plan Autonomo para Tareas: hero centrado con el copy original + tablero semanal estatico
 * como prueba visual (GateTareasTablero). Reemplaza al PageHeader y al empty state viejo en el estado
 * bloqueado. El CTA es el RequestUpgradeCta existente sin cambios: mismo flujo upgrade_requests,
 * mismo estado post-solicitud ("Solicitud enviada") y mismo disclaimer.
 */
function SchedulingLocked() {
  return (
    <div className="flex flex-col gap-4">
      <section className="mx-auto flex w-full max-w-[520px] flex-col items-center pb-12 pt-14 text-center">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[#F1EFE8] px-3 py-[5px]">
          <Lock className="h-3 w-3 flex-none text-[#5F5E5A]" aria-hidden="true" />
          <span className="text-[11px] uppercase tracking-[0.08em] text-[#5F5E5A]">
            Plan Autonomo
          </span>
        </span>
        <h1 className="mt-5 text-[26px] font-medium leading-[1.15] tracking-[-0.02em] text-ink">
          Una funcion del plan Autonomo
        </h1>
        <p className="mt-3 text-[14px] leading-[1.6] text-[#5F5E5A]">
          Las tareas programadas ejecutan tus agentes solos, en el horario que elijas. Estan
          disponibles en el plan Autonomo.
        </p>
        <RequestUpgradeCta featureContext="scheduled_tasks" className="mt-6" />
      </section>
      <GateTareasTablero />
    </div>
  );
}

/** Estado vacio editorial, consistente con /credenciales. */
function TasksEmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <EmptyState
      media={
        // Maqueta decorativa de "asi se vera tu tarea". No interactiva.
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
      }
      eyebrow="EMPIEZA AQUI"
      title="Programa tu primer agente"
      description="Elige un agente, el mensaje que ejecutara y cada cuanto corre. La plataforma lo dispara sola en el horario que definas."
      action={
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
      }
    />
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
  const [notice, setNotice] = useState<NoticeData | null>(null);

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
      {/* En el estado bloqueado el hero del gate reemplaza al titulo y subtitulo de la pagina. */}
      {(me.isLoading || isAutonomous) && (
        <PageHeader
          title="Tareas programadas"
          subtitle="Programa a tus agentes para que se ejecuten solos, en el horario que elijas."
          action={
            isAutonomous &&
            hasTasks && (
              <button type="button" onClick={() => setFormOpen(true)} className={addButtonClass}>
                <Plus className="h-[17px] w-[17px]" />
                Programar tarea
              </button>
            )
          }
        />
      )}

      <Notice notice={notice} />

      {me.isLoading ? (
        <SkeletonList cardClassName="h-[104px]" />
      ) : !isAutonomous ? (
        <SchedulingLocked />
      ) : listLoading ? (
        <SkeletonList cardClassName="h-[104px]" />
      ) : isError ? (
        <ErrorState title="No pudimos cargar tus tareas" onRetry={() => void refetch()} />
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
