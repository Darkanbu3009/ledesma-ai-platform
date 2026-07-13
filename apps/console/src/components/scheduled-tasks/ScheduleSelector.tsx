import { useEffect, useMemo, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Clock } from 'lucide-react';
import { inputClass } from '../ui/Field';
import { isValidCronExpression, nextCronRun } from '../../lib/cron';
import {
  DEFAULT_SCHEDULE,
  describeCron,
  describeSchedule,
  formatRunAt,
  formatTimeOfDay,
  MAX_FRIENDLY_DAY_OF_MONTH,
  scheduleToCron,
  type FriendlySchedule,
  type ScheduleFrequency,
} from '../../lib/schedule';

/** Resultado que el selector reporta hacia arriba en cada cambio. */
export interface ScheduleSelection {
  cronExpression: string;
  valid: boolean;
}

const FREQUENCY_OPTIONS: { value: ScheduleFrequency; labelKey: string }[] = [
  { value: 'hourly', labelKey: 'tareas.horario.frecuencia.cadaHora' },
  { value: 'daily', labelKey: 'tareas.horario.frecuencia.cadaDia' },
  { value: 'weekly', labelKey: 'tareas.horario.frecuencia.cadaSemana' },
  { value: 'monthly', labelKey: 'tareas.horario.frecuencia.cadaMes' },
];

/** Claves de los nombres singulares (para el <select> de dia de la semana). Indice 0 = domingo. */
const WEEKDAY_LABEL_KEYS = [
  'tareas.horario.dias.domingo',
  'tareas.horario.dias.lunes',
  'tareas.horario.dias.martes',
  'tareas.horario.dias.miercoles',
  'tareas.horario.dias.jueves',
  'tareas.horario.dias.viernes',
  'tareas.horario.dias.sabado',
];

/** Minutos ofrecidos en "cada hora" (paso de 5). El modo avanzado cubre cualquier otro minuto. */
const HOURLY_MINUTES = Array.from({ length: 12 }, (_, i) => i * 5);

/**
 * SELECTOR DE HORARIO de una tarea programada. Por defecto en MODO AMIGABLE: el usuario elige una
 * frecuencia comun (cada hora / dia / semana / mes) y una hora, sin ver nunca la expresion cron; el
 * componente la genera. Un toggle abre el MODO AVANZADO para escribir el cron a mano (con validacion
 * y vista previa legible + proximo run estimado). Reporta { cronExpression, valid } al padre.
 *
 * Los horarios son UTC (el backend interpreta el cron en UTC): se rotula explicitamente para que no
 * haya sorpresas por zona horaria.
 */
export function ScheduleSelector({
  onChange,
}: {
  onChange: (selection: ScheduleSelection) => void;
}) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<'friendly' | 'advanced'>('friendly');
  const [schedule, setSchedule] = useState<FriendlySchedule>(DEFAULT_SCHEDULE);
  const [rawCron, setRawCron] = useState<string>(scheduleToCron(DEFAULT_SCHEDULE));

  // Cron y validez efectivos segun el modo.
  const friendlyCron = scheduleToCron(schedule);
  const cronExpression = mode === 'friendly' ? friendlyCron : rawCron;
  const valid = mode === 'friendly' ? true : isValidCronExpression(rawCron);

  // Reporta al padre en cada cambio sin re-suscribir el efecto a la identidad de onChange.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });
  useEffect(() => {
    onChangeRef.current({ cronExpression, valid });
  }, [cronExpression, valid]);

  function switchToAdvanced() {
    // Arranca el modo avanzado desde el cron amigable actual: el usuario ve de donde parte.
    setRawCron(friendlyCron);
    setMode('advanced');
  }

  return (
    <div className="rounded-xl border border-line bg-field p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-ink">{t('tareas.horario.titulo')}</span>
        <button
          type="button"
          onClick={() => (mode === 'friendly' ? switchToAdvanced() : setMode('friendly'))}
          className="text-xs font-medium text-muted underline-offset-2 transition hover:text-brasa hover:underline"
        >
          {mode === 'friendly' ? t('tareas.horario.modoAvanzado') : t('tareas.horario.modoSimple')}
        </button>
      </div>

      {mode === 'friendly' ? (
        <FriendlyMode schedule={schedule} onScheduleChange={setSchedule} />
      ) : (
        <AdvancedMode rawCron={rawCron} onRawCronChange={setRawCron} />
      )}
    </div>
  );
}

/** Modo amigable: frecuencia + los controles de hora/dia que apliquen. */
function FriendlyMode({
  schedule,
  onScheduleChange,
}: {
  schedule: FriendlySchedule;
  onScheduleChange: (next: FriendlySchedule) => void;
}) {
  const { t } = useTranslation();
  const timeValue = formatTimeOfDay(schedule.hour, schedule.minute);

  // El minuto actual siempre debe estar entre las opciones (p.ej. si venia de un HH:MM con minuto
  // no multiplo de 5 elegido en otra frecuencia), para que el <select> no quede sin seleccion.
  const minuteOptions = HOURLY_MINUTES.includes(schedule.minute)
    ? HOURLY_MINUTES
    : [...HOURLY_MINUTES, schedule.minute].sort((a, b) => a - b);

  function handleTimeChange(value: string) {
    // El <input type="time"> puede quedar vacio al borrar: solo aplicamos un HH:MM completo.
    const match = /^(\d{2}):(\d{2})$/.exec(value);
    if (!match) return;
    onScheduleChange({ ...schedule, hour: Number(match[1]), minute: Number(match[2]) });
  }

  return (
    <div className="space-y-4">
      {/* Frecuencia: radiogroup accesible estilado como control segmentado. */}
      <div
        role="radiogroup"
        aria-label={t('tareas.horario.frecuenciaAria')}
        className="grid grid-cols-2 gap-2 sm:grid-cols-4"
      >
        {FREQUENCY_OPTIONS.map((option) => {
          const active = schedule.frequency === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onScheduleChange({ ...schedule, frequency: option.value })}
              className={[
                'rounded-lg border px-3 py-2 text-sm font-medium transition',
                active
                  ? 'border-brasa-line bg-brasa-soft text-brasa'
                  : 'border-line bg-surface text-ink-soft hover:border-brasa-line hover:text-brasa',
              ].join(' ')}
            >
              {t(option.labelKey)}
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {schedule.frequency === 'hourly' && (
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-muted">
              {t('tareas.horario.minutoLabel')}
            </span>
            <select
              value={schedule.minute}
              onChange={(e) => onScheduleChange({ ...schedule, minute: Number(e.target.value) })}
              className={inputClass}
            >
              {minuteOptions.map((m) => (
                <option key={m} value={m}>
                  :{String(m).padStart(2, '0')}
                </option>
              ))}
            </select>
          </label>
        )}

        {schedule.frequency === 'weekly' && (
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-muted">
              {t('tareas.horario.diaSemanaLabel')}
            </span>
            <select
              value={schedule.weekday}
              onChange={(e) => onScheduleChange({ ...schedule, weekday: Number(e.target.value) })}
              className={inputClass}
            >
              {WEEKDAY_LABEL_KEYS.map((labelKey, value) => (
                <option key={value} value={value}>
                  {t(labelKey)}
                </option>
              ))}
            </select>
          </label>
        )}

        {schedule.frequency === 'monthly' && (
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-muted">
              {t('tareas.horario.diaMesLabel')}
            </span>
            <select
              value={schedule.dayOfMonth}
              onChange={(e) => onScheduleChange({ ...schedule, dayOfMonth: Number(e.target.value) })}
              className={inputClass}
            >
              {Array.from({ length: MAX_FRIENDLY_DAY_OF_MONTH }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>
                  {t('tareas.horario.diaN', { dia: d })}
                </option>
              ))}
            </select>
          </label>
        )}

        {schedule.frequency !== 'hourly' && (
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-muted">
              {t('tareas.horario.horaUtcLabel')}
            </span>
            <input
              type="time"
              value={timeValue}
              onChange={(e) => handleTimeChange(e.target.value)}
              className={inputClass}
            />
          </label>
        )}
      </div>

      <SchedulePreview text={describeSchedule(schedule)} />
    </div>
  );
}

/** Modo avanzado: cron a mano, con validacion, traduccion legible y proximo run estimado. */
function AdvancedMode({
  rawCron,
  onRawCronChange,
}: {
  rawCron: string;
  onRawCronChange: (next: string) => void;
}) {
  const { t } = useTranslation();
  const trimmed = rawCron.trim();
  const isEmpty = trimmed === '';
  const valid = !isEmpty && isValidCronExpression(rawCron);

  // Vista previa: descripcion legible (si es una forma conocida) y proximo run estimado (UTC).
  const preview = useMemo(() => {
    if (!valid) return null;
    const description = describeCron(rawCron);
    const next = nextCronRun(rawCron, new Date());
    return { description, nextRun: formatRunAt(next ? next.toISOString() : null) };
  }, [rawCron, valid]);

  return (
    <div className="space-y-2">
      <label className="block">
        <span className="mb-1.5 block text-xs font-medium text-muted">Expresion cron (5 campos)</span>
        <input
          value={rawCron}
          onChange={(e) => onRawCronChange(e.target.value)}
          aria-invalid={!isEmpty && !valid}
          spellCheck={false}
          autoComplete="off"
          className={`${inputClass} font-mono`}
          placeholder="0 8 * * 1"
        />
      </label>
      <p className="text-xs text-muted">
        Orden: minuto hora dia-del-mes mes dia-de-semana. Ejemplo:{' '}
        <span className="font-mono text-ink-soft">0 8 * * 1</span> = todos los lunes 08:00 UTC.
      </p>

      {!isEmpty && !valid && (
        <p role="alert" className="text-sm text-brasa">
          Formato de cron invalido (deben ser 5 campos).
        </p>
      )}

      {valid && preview && (
        <div className="space-y-1 rounded-lg border border-line bg-surface px-3.5 py-2.5">
          <p className="flex items-center gap-2 text-sm text-ink">
            <Clock className="h-4 w-4 flex-none text-brasa" />
            {preview.description ? `Se ejecutara: ${preview.description}` : 'Expresion valida.'}
            <span className="text-xs text-muted-soft">· UTC</span>
          </p>
          {preview.nextRun && (
            <p className="pl-6 text-xs text-muted">Proximo run estimado: {preview.nextRun}</p>
          )}
        </div>
      )}
    </div>
  );
}

/** Linea de vista previa del modo amigable. */
function SchedulePreview({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3.5 py-2.5 text-sm text-ink">
      <Clock className="h-4 w-4 flex-none text-brasa" />
      Se ejecutara: {text}
      <span className="text-xs text-muted-soft">· UTC</span>
    </div>
  );
}
