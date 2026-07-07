import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Plus, Sparkles, Webhook } from 'lucide-react';
import { useAgents, useCredentials, useMe, useTriggers } from '../lib/queries';
import { useDeleteTrigger, useUpdateTrigger } from '../lib/mutations';
import {
  authModeLabel,
  revealFromCreate,
  revealFromUpdate,
  type CreateTriggerResponse,
  type Trigger,
  type TriggerReveal,
} from '../lib/triggers';
import { TriggerCard } from '../components/triggers/TriggerCard';
import { TriggerFormDialog } from '../components/triggers/TriggerFormDialog';
import { DeleteTriggerDialog } from '../components/triggers/DeleteTriggerDialog';
import { RotateTriggerDialog } from '../components/triggers/RotateTriggerDialog';
import { SecretRevealDialog } from '../components/triggers/SecretRevealDialog';
import { PageHeader } from '../components/ui/PageHeader';
import { SkeletonList } from '../components/ui/SkeletonList';
import { ErrorState } from '../components/ui/ErrorState';
import { EmptyState } from '../components/ui/EmptyState';
import { Notice, type NoticeData } from '../components/ui/Notice';
import { RequestUpgradeCta } from '../components/upgrade/RequestUpgradeCta';

const addButtonClass =
  'inline-flex items-center gap-2 rounded-[10px] bg-brasa px-[22px] py-[11px] text-sm font-semibold text-white shadow-[0_1px_2px_rgba(31,30,28,0.10)] transition hover:-translate-y-px hover:bg-brasa-hover hover:shadow-[0_2px_6px_rgba(31,30,28,0.14)]';

/** Material de auth a mostrar una vez, con el origen (crear o rotar) para el copy del modal. */
type Reveal = { data: TriggerReveal; context: 'created' | 'rotated' };

/** Aviso: los triggers son del plan Autonomo. Sobrio, no un paywall agresivo (espejo del gate server-side). */
function TriggersLocked() {
  return (
    <EmptyState
      variant="centered"
      media={
        <span className="flex h-[52px] w-[52px] items-center justify-center rounded-2xl bg-brasa-soft text-brasa">
          <Sparkles className="h-6 w-6" />
        </span>
      }
      title="Una funcion del plan Autonomo"
      description="Los triggers dejan que un evento externo dispare tus agentes a traves de una URL de webhook. Estan disponibles en el plan Autonomo."
      action={<RequestUpgradeCta featureContext="triggers" />}
    />
  );
}

/** Estado vacio editorial, consistente con /tareas y /credenciales. */
function TriggersEmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <EmptyState
      media={
        // Maqueta decorativa de "asi se vera tu trigger". No interactiva; ancla el bloque centrado.
        <div className="mb-10 hidden md:block">
          <div
            aria-hidden="true"
            className="w-[260px] rounded-2xl border border-line-soft bg-surface p-[18px] shadow-card"
          >
            <div className="flex items-center gap-3">
              <span className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-[10px] bg-brasa-soft text-brasa">
                <Webhook className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1 space-y-2">
                <span className="block h-2.5 w-[110px] rounded-full bg-line" />
                <span className="block h-2 w-[70px] rounded-full bg-line-soft" />
              </div>
              <span className="block h-[22px] w-[52px] flex-none rounded-full bg-ok/15" />
            </div>
            <div className="mt-[18px] h-[30px] rounded-lg bg-line-soft" />
          </div>
        </div>
      }
      eyebrow="EMPIEZA AQUI"
      title="Crea tu primer trigger"
      description="Elige un agente y un mensaje base, y obtendras una URL de webhook. Cuando un evento externo la llame, la plataforma ejecuta tu agente sola."
      action={
        <button
          type="button"
          onClick={onAdd}
          className="group inline-flex h-11 items-center gap-3 rounded-full bg-brasa pl-6 pr-[7px] text-sm font-medium text-white transition hover:bg-brasa-hover"
        >
          Crear trigger
          <span className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-white text-brasa transition group-hover:translate-x-0.5">
            <ArrowRight className="h-[18px] w-[18px]" />
          </span>
        </button>
      }
    />
  );
}

export function TriggersPage() {
  const me = useMe();
  const isAutonomous = me.data?.profile?.tier === 'autonomous';

  const { data: triggers, isLoading, isError, refetch } = useTriggers();
  const { data: agents, isLoading: agentsLoading } = useAgents();
  const { data: credentials } = useCredentials();
  // Dos instancias independientes: pausar/activar y rotar no comparten estado de carga/error.
  const toggleTrigger = useUpdateTrigger();
  const rotateTrigger = useUpdateTrigger();
  const deleteTrigger = useDeleteTrigger();

  const [formOpen, setFormOpen] = useState(false);
  const [toDelete, setToDelete] = useState<Trigger | null>(null);
  const [toRotate, setToRotate] = useState<Trigger | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [reveal, setReveal] = useState<Reveal | null>(null);
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

  const hasTriggers = Array.isArray(triggers) && triggers.length > 0;
  const listLoading = isLoading || agentsLoading;

  function toggleActive(trigger: Trigger) {
    setTogglingId(trigger.id);
    toggleTrigger.mutate(
      { id: trigger.id, update: { isActive: !trigger.isActive } },
      {
        onSuccess: () =>
          setNotice({ kind: 'ok', text: trigger.isActive ? 'Trigger pausado.' : 'Trigger activado.' }),
        onError: () =>
          setNotice({ kind: 'error', text: 'No pudimos actualizar el trigger. Intenta de nuevo.' }),
        // Solo limpiamos el spinner de ESTE trigger: dos toggles concurrentes no se pisan el estado.
        onSettled: () => setTogglingId((cur) => (cur === trigger.id ? null : cur)),
      },
    );
  }

  function handleCreated(result: CreateTriggerResponse) {
    const data = revealFromCreate(result);
    if (data) {
      setReveal({ data, context: 'created' });
    } else {
      setNotice({ kind: 'error', text: 'Creamos el trigger pero no pudimos mostrar el secreto. Rotalo para obtener uno nuevo.' });
    }
  }

  function openRotate(trigger: Trigger) {
    rotateTrigger.reset();
    setToRotate(trigger);
  }

  function confirmRotate() {
    if (!toRotate) return;
    rotateTrigger.mutate(
      { id: toRotate.id, update: { rotate: true } },
      {
        onSuccess: (result) => {
          const data = revealFromUpdate(result);
          setToRotate(null);
          if (data) {
            setReveal({ data, context: 'rotated' });
          } else {
            setNotice({ kind: 'error', text: 'Rotamos el secreto pero no pudimos mostrarlo. Intenta de nuevo.' });
          }
        },
      },
    );
  }

  function openDelete(trigger: Trigger) {
    deleteTrigger.reset();
    setToDelete(trigger);
  }

  function confirmDelete() {
    if (!toDelete) return;
    deleteTrigger.mutate(toDelete.id, {
      onSuccess: () => {
        setToDelete(null);
        setNotice({ kind: 'ok', text: 'Trigger eliminado.' });
      },
    });
  }

  function describeTrigger(trigger: Trigger | null): string {
    if (!trigger) return '';
    const agentName = agentsById.get(trigger.agentId)?.name ?? 'agente eliminado';
    return `${agentName} · ${authModeLabel(trigger.authMode)}`;
  }

  return (
    <div className="mx-auto flex min-h-full max-w-4xl flex-col">
      <PageHeader
        title="Triggers"
        subtitle="Crea URLs de webhook que ejecutan un agente cuando un evento externo las llama."
        action={
          isAutonomous &&
          hasTriggers && (
            <button type="button" onClick={() => setFormOpen(true)} className={addButtonClass}>
              <Plus className="h-[17px] w-[17px]" />
              Crear trigger
            </button>
          )
        }
      />

      <Notice notice={notice} />

      {me.isLoading ? (
        <SkeletonList cardClassName="h-[148px]" />
      ) : !isAutonomous ? (
        <TriggersLocked />
      ) : listLoading ? (
        <SkeletonList cardClassName="h-[148px]" />
      ) : isError ? (
        <ErrorState title="No pudimos cargar tus triggers" onRetry={() => void refetch()} />
      ) : !hasTriggers ? (
        <TriggersEmptyState onAdd={() => setFormOpen(true)} />
      ) : (
        <div className="mt-6 space-y-3">
          {triggers.map((trigger) => (
            <TriggerCard
              key={trigger.id}
              trigger={trigger}
              agentName={agentsById.get(trigger.agentId)?.name ?? null}
              credentialLabel={credentialsById.get(trigger.credentialId)?.label ?? null}
              toggling={togglingId === trigger.id}
              onToggle={() => toggleActive(trigger)}
              onRotate={() => openRotate(trigger)}
              onDelete={() => openDelete(trigger)}
            />
          ))}
          <button
            type="button"
            onClick={() => setFormOpen(true)}
            className="flex w-full items-center justify-center gap-2 rounded-2xl border-[1.5px] border-dashed border-line p-4 text-sm font-semibold text-muted transition hover:border-brasa-line hover:bg-brasa/[0.03] hover:text-brasa"
          >
            <Plus className="h-[18px] w-[18px]" />
            Crear trigger
          </button>
        </div>
      )}

      {formOpen && isAutonomous && (
        <TriggerFormDialog onClose={() => setFormOpen(false)} onCreated={handleCreated} />
      )}

      <RotateTriggerDialog
        open={toRotate !== null}
        authMode={toRotate?.authMode ?? 'hmac'}
        busy={rotateTrigger.isPending}
        error={rotateTrigger.isError ? 'No pudimos rotar el secreto. Intenta de nuevo.' : undefined}
        onConfirm={confirmRotate}
        onCancel={() => setToRotate(null)}
      />

      <DeleteTriggerDialog
        open={toDelete !== null}
        description={describeTrigger(toDelete)}
        busy={deleteTrigger.isPending}
        error={deleteTrigger.isError ? 'No pudimos eliminar el trigger. Intenta de nuevo.' : undefined}
        onConfirm={confirmDelete}
        onCancel={() => setToDelete(null)}
      />

      {reveal && (
        <SecretRevealDialog
          reveal={reveal.data}
          context={reveal.context}
          onClose={() => {
            setReveal(null);
            // El material rotado tambien queda en rotateTrigger.data: lo limpiamos para que el
            // secreto no sobreviva al cierre del modal (coherente con "se muestra una sola vez").
            rotateTrigger.reset();
          }}
        />
      )}
    </div>
  );
}
