import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldCheck } from 'lucide-react';
import { usePoliticaEjecucion } from '../../lib/queries';
import { useGuardarPoliticaEjecucion } from '../../lib/mutations';
import {
  formatearSitiosExcluidos,
  parsearSitiosExcluidos,
  type PoliticaEjecucion,
} from '../../lib/politicas';
import { Field, inputClass } from '../ui/Field';
import { Notice, type NoticeData } from '../ui/Notice';
import { Button } from '../ui/button';
import { focusRing } from '../../lib/utils';

/**
 * ACCIONES QUE NO SE PUEDEN DESHACER (/configuracion/cuenta): los tres limites que el usuario define
 * UNA sola vez y que su asistente respeta despues sin volver a preguntarle nada.
 *
 * Por que existe esta pantalla: el producto se opera en lenguaje natural y su usuario no es tecnico.
 * Pedirle permiso cada vez que hay que enviar, pagar o borrar algo convierte la automatizacion en
 * una fila de pendientes. Aqui decide una vez -- si deja que pasen, hasta cuanto dinero y en que
 * sitios nunca -- y a partir de ahi el sistema compara solo lo que el pidio con lo que hay en la
 * pantalla antes de actuar.
 *
 * El texto es deliberadamente llano: ni una palabra de mecanismo (tareas, verificaciones, campos).
 */
export function PoliticaEjecucionSection() {
  const { t } = useTranslation();
  const { data, isLoading, isError } = usePoliticaEjecucion();

  return (
    <section className="rounded-[14px] border-[0.5px] border-[#E9E7DF] bg-surface px-[22px] py-[18px]">
      <div className="flex flex-wrap items-start gap-3.5">
        <span
          aria-hidden="true"
          className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[9px] bg-[#F1EFE8] text-[#5F5E5A]"
        >
          <ShieldCheck className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[13.5px] font-medium text-ink">{t('politica.configuracion.titulo')}</h2>
          <p className="text-xs text-[#8A8880]">{t('politica.configuracion.descripcion')}</p>
        </div>
      </div>

      {isLoading ? (
        <div className="mt-4 h-24 animate-pulse rounded-[10px] bg-[#F1EFE8]" />
      ) : isError || !data ? (
        <p className="mt-4 text-[13px] text-brasa">{t('politica.configuracion.errorCarga')}</p>
      ) : (
        // El formulario se monta RECIEN con los datos cargados y toma su estado inicial de las props:
        // asi no hace falta ningun efecto que sincronice estado con la query.
        <PoliticaForm politica={data} />
      )}
    </section>
  );
}

function PoliticaForm({ politica }: { politica: PoliticaEjecucion }) {
  const { t } = useTranslation();
  const [permitir, setPermitir] = useState(politica.ejecutarAccionesIrreversibles);
  const [tope, setTope] = useState(String(politica.topeMontoSinConfirmacion));
  const [sitios, setSitios] = useState(formatearSitiosExcluidos(politica.sitiosExcluidos));
  const [notice, setNotice] = useState<NoticeData | null>(null);
  const [errorTope, setErrorTope] = useState<string | undefined>(undefined);
  const mutation = useGuardarPoliticaEjecucion();

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const monto = Number(tope.replace(/[^\d.]/g, ''));
    if (!Number.isFinite(monto) || monto < 0) {
      setErrorTope(t('politica.configuracion.error'));
      return;
    }
    setErrorTope(undefined);
    setNotice(null);
    mutation.mutate(
      {
        ejecutarAccionesIrreversibles: permitir,
        topeMontoSinConfirmacion: monto,
        sitiosExcluidos: parsearSitiosExcluidos(sitios),
      },
      {
        onSuccess: (guardada) => {
          setTope(String(guardada.topeMontoSinConfirmacion));
          setSitios(formatearSitiosExcluidos(guardada.sitiosExcluidos));
          setNotice({ kind: 'ok', text: t('politica.configuracion.guardado') });
        },
        onError: (error) => {
          const invalido = error instanceof Error && error.message.includes('400');
          setNotice({
            kind: 'error',
            text: invalido
              ? t('politica.configuracion.sitioInvalido')
              : t('politica.configuracion.error'),
          });
        },
      },
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="mt-4 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-ink">{t('politica.configuracion.permitirTitulo')}</p>
          <p className="text-xs text-[#8A8880]">{t('politica.configuracion.permitirDescripcion')}</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={permitir}
          aria-label={t('politica.configuracion.permitirTitulo')}
          onClick={() => setPermitir((activo) => !activo)}
          className={`relative h-6 w-11 flex-none rounded-full border-[0.5px] border-[#E9E7DF] transition ${focusRing} ${
            permitir ? 'bg-ink' : 'bg-[#F1EFE8]'
          }`}
        >
          <span
            aria-hidden="true"
            className={`absolute top-[2px] h-[18px] w-[18px] rounded-full bg-surface shadow-sm transition-all ${
              permitir ? 'left-[24px]' : 'left-[2px]'
            }`}
          />
        </button>
      </div>

      <Field
        label={t('politica.configuracion.topeLabel')}
        hint={t('politica.configuracion.topeDescripcion')}
        error={errorTope}
      >
        <input
          value={tope}
          onChange={(e) => setTope(e.target.value)}
          inputMode="decimal"
          autoComplete="off"
          className={inputClass}
        />
      </Field>

      <Field
        label={t('politica.configuracion.sitiosLabel')}
        hint={t('politica.configuracion.sitiosDescripcion')}
      >
        <input
          value={sitios}
          onChange={(e) => setSitios(e.target.value)}
          placeholder={t('politica.configuracion.sitiosPlaceholder')}
          autoComplete="off"
          className={inputClass}
        />
      </Field>

      <div className="flex items-center gap-3">
        <Button type="submit" variant="secondary-neutral" size="sm" disabled={mutation.isPending}>
          {mutation.isPending ? t('ui.acciones.guardando') : t('ui.acciones.guardar')}
        </Button>
        <Notice notice={notice} className="" />
      </div>
    </form>
  );
}
