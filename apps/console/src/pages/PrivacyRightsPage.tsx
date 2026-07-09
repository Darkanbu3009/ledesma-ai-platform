import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Download, RefreshCw } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { useDataRequests } from '../lib/queries';
import { useCreateDataRequest } from '../lib/mutations';
import { Field, inputClass } from '../components/ui/Field';
import { focusRing } from '../lib/utils';
import {
  DATA_REQUEST_OPTIONS,
  requestStatusLabel,
  requestTypeLabel,
  type DataRequest,
  type DataRequestStatus,
  type DataRequestType,
} from '../lib/privacy';

const MAX_DETAILS = 5_000;

/** Los tres pasos de la tarjeta "QUE SIGUE AL ENVIAR". Sin folio: la solicitud no muestra un
 * identificador al titular (el historial identifica por tipo + fecha), asi que el paso 01 no lo promete. */
const PASOS_ENVIO = [
  'Tu solicitud queda registrada con fecha.',
  'La atendemos conforme a los plazos de ley.',
  'Ves la resolucion aqui, en tu historial.',
] as const;

const statusClass: Record<DataRequestStatus, string> = {
  pending: 'border-line bg-field text-muted',
  in_progress: 'border-brasa-line bg-brasa-soft text-brasa',
  completed: 'border-ok/30 bg-ok/10 text-ok',
  rejected: 'border-line bg-field text-muted-soft',
};

function StatusBadge({ status }: { status: DataRequestStatus }) {
  return (
    <span
      className={[
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold',
        statusClass[status],
      ].join(' ')}
    >
      {requestStatusLabel(status)}
    </span>
  );
}

function RequestRow({ request }: { request: DataRequest }) {
  return (
    <li className="rounded-2xl border border-line bg-surface p-4 shadow-card">
      <div className="flex items-center justify-between gap-3">
        <span className="font-display text-sm font-bold text-ink">
          {requestTypeLabel(request.requestType)}
        </span>
        <StatusBadge status={request.status} />
      </div>
      {request.details && <p className="mt-2 text-sm text-muted">{request.details}</p>}
      <p className="mt-2 text-xs text-muted-soft">
        Enviada el {new Date(request.createdAt).toLocaleDateString()}
        {request.resolutionNote ? ` - ${request.resolutionNote}` : ''}
      </p>
    </li>
  );
}

/**
 * Pagina de EJERCICIO DE DERECHOS DEL TITULAR (ARCO / GDPR, Fase 5.6). El titular envia una solicitud
 * (radio group de derechos + detalle) y ve el estado de las suyas. Ademas puede DESCARGAR sus datos
 * (derecho de acceso, self-service). Vive bajo el dashboard (AppLayout).
 *
 * Layout: grid 1.6fr/1fr — a la izquierda la tarjeta "Ejercer un derecho"; a la derecha la descarga
 * self-service y los pasos de que sigue al enviar. En angosto se apila con el formulario primero.
 * El badge "LFPDPPP · GDPR" del encabezado es valido porque el aviso integral declara ambos marcos
 * (ver INTEGRAL_NOTICE en lib/privacy.ts).
 */
export function PrivacyRightsPage() {
  const { data: requests, isLoading, isError, refetch } = useDataRequests();
  const createRequest = useCreateDataRequest();

  const [type, setType] = useState<DataRequestType>('access');
  const [details, setDetails] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState(false);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    createRequest.mutate(
      { request_type: type, details: details.trim() === '' ? undefined : details.trim() },
      {
        onSuccess: () => {
          setDetails('');
          setNotice('Solicitud enviada. Le daremos seguimiento.');
        },
      },
    );
  }

  async function downloadMyData() {
    setDownloading(true);
    setDownloadError(false);
    try {
      const data = await apiFetch<{ export: unknown }>('/v1/data-requests/export');
      const blob = new Blob([JSON.stringify(data.export, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'mis-datos.json';
      anchor.click();
      URL.revokeObjectURL(url);
    } catch {
      setDownloadError(true);
    } finally {
      setDownloading(false);
    }
  }

  const hasRequests = Array.isArray(requests) && requests.length > 0;

  return (
    <div className="mx-auto flex min-h-full max-w-4xl flex-col">
      {/* Encabezado: titulo + subtitulo a la izquierda, badge de marcos legales a la derecha. */}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="max-w-[520px]">
          <h1 className="font-display text-3xl font-extrabold tracking-tight text-ink">
            Privacidad y tus datos
          </h1>
          <p className="mt-1.5 text-[13.5px] leading-[1.55] text-[#8A8880]">
            Tus datos son tuyos. Aqui los consultas, los corriges o los eliminas.
          </p>
        </div>
        <span className="flex-none rounded-full border-[0.5px] border-[#E9E7DF] px-3 py-1 font-mono text-[11px] tracking-[0.06em] text-[#5F5E5A]">
          LFPDPPP · GDPR
        </span>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-3 lg:grid-cols-[1.6fr_1fr]">
        {/* Formulario de solicitud: radio group de derechos + detalle + nota y CTA. */}
        <form
          onSubmit={handleSubmit}
          className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-5 shadow-card"
        >
          <p className="font-display text-sm font-bold text-ink">Ejercer un derecho</p>
          <fieldset>
            <legend className="sr-only">Tipo de solicitud</legend>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {DATA_REQUEST_OPTIONS.map((option) => (
                <label
                  key={option.type}
                  className={`cursor-pointer rounded-[12px] border-[0.5px] p-3 transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brasa/40 ${
                    type === option.type
                      ? 'border-brasa-line bg-brasa-soft'
                      : 'border-[#E9E7DF] bg-field hover:border-line'
                  }`}
                >
                  <input
                    type="radio"
                    name="request-type"
                    value={option.type}
                    checked={type === option.type}
                    onChange={() => setType(option.type)}
                    className="sr-only"
                  />
                  <span className="block text-[13.5px] font-medium text-ink">{option.label}</span>
                  <span className="mt-0.5 block text-[12px] leading-[1.5] text-[#8A8880]">
                    {option.description}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <Field label="Detalle (opcional)" hint="Cuentanos que necesitas para atender tu solicitud.">
            <textarea
              value={details}
              onChange={(e) => setDetails(e.target.value.slice(0, MAX_DETAILS))}
              rows={3}
              placeholder="Describe tu solicitud..."
              className={inputClass}
            />
          </Field>
          {createRequest.isError && (
            <p className="text-sm text-brasa" role="alert">
              No pudimos enviar tu solicitud. Intenta de nuevo.
            </p>
          )}
          <div className="mt-auto flex flex-wrap items-center justify-between gap-3">
            {/* Sin "folio": el registro no muestra un identificador al titular. */}
            <p className="text-[12px] text-[#8A8880]">Queda registrada y puedes seguirla abajo.</p>
            <button
              type="submit"
              disabled={createRequest.isPending}
              className={`inline-flex flex-none items-center gap-2 rounded-[10px] bg-brasa px-[22px] py-[11px] text-sm font-semibold text-white transition hover:bg-brasa-hover disabled:opacity-60 ${focusRing}`}
            >
              {createRequest.isPending ? 'Enviando...' : 'Enviar solicitud'}
            </button>
          </div>
        </form>

        {/* Columna derecha: descarga self-service + que sigue al enviar. */}
        <div className="flex flex-col gap-3">
          <div className="rounded-2xl border border-line bg-surface p-5 shadow-card">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[13.5px] font-medium text-ink">Tu copia, al instante</p>
              <Download className="h-[15px] w-[15px] flex-none text-[#8A8880]" aria-hidden />
            </div>
            <p className="mt-1.5 text-[12px] leading-[1.5] text-[#8A8880]">
              Perfil, consentimientos, solicitudes y registros de tratamiento en un JSON. Sin
              esperas ni solicitudes.
            </p>
            {downloadError && (
              <p className="mt-1.5 text-[12px] text-brasa" role="alert">
                No pudimos generar la exportacion. Intenta de nuevo.
              </p>
            )}
            <button
              type="button"
              onClick={() => void downloadMyData()}
              disabled={downloading}
              className={`mt-3 inline-flex w-full items-center justify-center gap-2 rounded-[10px] border border-line bg-field px-4 py-2.5 text-sm font-semibold text-ink transition hover:border-brasa disabled:opacity-60 ${focusRing}`}
            >
              {downloading ? 'Preparando...' : 'Descargar mis datos'}
            </button>
          </div>

          <div className="flex-1 rounded-2xl border border-line bg-[#FAF9F5] p-5">
            <p className="text-[11px] uppercase tracking-[0.06em] text-[#B4B2A9]">
              Que sigue al enviar
            </p>
            <ol className="mt-3 space-y-2.5">
              {PASOS_ENVIO.map((paso, index) => (
                <li key={paso} className="flex items-baseline gap-2.5">
                  <span className="flex-none font-mono text-[11px] text-[#B4B2A9]">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <span className="text-[12px] leading-[1.5] text-[#5F5E5A]">{paso}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>

      {notice && (
        <div className="mt-3 inline-flex items-center gap-2 rounded-xl border border-ok/30 bg-ok/10 px-3.5 py-2 text-sm font-medium text-ok">
          <CheckCircle2 className="h-4 w-4" />
          {notice}
        </div>
      )}

      {/* Lista de solicitudes del titular. */}
      <div className="mt-8">
        <h2 className="font-display text-lg font-bold text-ink">Tus solicitudes</h2>
        {isLoading ? (
          <div className="mt-4 space-y-3">
            {[0, 1].map((i) => (
              <div key={i} className="h-20 animate-pulse rounded-2xl border border-line bg-surface" />
            ))}
          </div>
        ) : isError ? (
          <div className="mt-4 rounded-2xl border border-line bg-surface p-6 text-center shadow-card">
            <p className="text-sm text-muted">No pudimos cargar tus solicitudes.</p>
            <button
              type="button"
              onClick={() => void refetch()}
              className="mt-3 inline-flex items-center gap-2 rounded-xl border border-line bg-field px-4 py-2 text-sm font-medium text-ink transition hover:border-brasa"
            >
              <RefreshCw className="h-4 w-4" />
              Reintentar
            </button>
          </div>
        ) : !hasRequests ? (
          <p className="mt-4 rounded-2xl border border-dashed border-line bg-surface p-6 text-center text-sm text-muted">
            Aun no has enviado solicitudes.
          </p>
        ) : (
          <ul className="mt-4 space-y-3">
            {requests.map((request) => (
              <RequestRow key={request.id} request={request} />
            ))}
          </ul>
        )}
      </div>

      <p className="mt-8 text-sm text-muted">
        Consulta el{' '}
        <Link to="/aviso-de-privacidad" className="font-medium text-brasa hover:underline">
          aviso de privacidad
        </Link>{' '}
        para conocer como tratamos tus datos.
      </p>
    </div>
  );
}
