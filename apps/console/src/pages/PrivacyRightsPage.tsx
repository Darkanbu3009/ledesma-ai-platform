import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Download, RefreshCw } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { useDataRequests } from '../lib/queries';
import { useCreateDataRequest } from '../lib/mutations';
import { Field, inputClass } from '../components/ui/Field';
import {
  DATA_REQUEST_OPTIONS,
  requestStatusLabel,
  requestTypeLabel,
  type DataRequest,
  type DataRequestStatus,
  type DataRequestType,
} from '../lib/privacy';

const MAX_DETAILS = 5_000;

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
 * (elige tipo + detalle) y ve el estado de las suyas. Ademas puede DESCARGAR sus datos (derecho de
 * acceso, self-service). Vive bajo el dashboard (AppLayout), consistente con /recetas y /tareas.
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
    <div className="mx-auto flex min-h-full max-w-3xl flex-col">
      <div>
        <h1 className="font-display text-3xl font-extrabold tracking-tight text-ink">
          Privacidad y tus datos
        </h1>
        <p className="mt-1.5 text-[15px] text-muted">
          Ejerce tus derechos sobre tus datos personales y descarga una copia de la informacion que
          tenemos.
        </p>
      </div>

      {/* Acceso self-service: descarga de datos. */}
      <div className="mt-6 flex flex-col gap-3 rounded-2xl border border-line bg-surface p-5 shadow-card sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-display text-sm font-bold text-ink">Descargar mis datos</p>
          <p className="mt-1 text-sm text-muted">
            Derecho de acceso: exporta en JSON tu perfil, consentimientos, solicitudes y registros de
            tratamiento.
          </p>
          {downloadError && (
            <p className="mt-1.5 text-sm text-brasa" role="alert">
              No pudimos generar la exportacion. Intenta de nuevo.
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => void downloadMyData()}
          disabled={downloading}
          className="inline-flex flex-none items-center gap-2 rounded-[10px] border border-line bg-field px-4 py-2.5 text-sm font-semibold text-ink transition hover:border-brasa disabled:opacity-60"
        >
          <Download className="h-[17px] w-[17px]" />
          {downloading ? 'Preparando...' : 'Descargar'}
        </button>
      </div>

      {/* Formulario de solicitud. */}
      <form
        onSubmit={handleSubmit}
        className="mt-4 space-y-4 rounded-2xl border border-line bg-surface p-5 shadow-card"
      >
        <p className="font-display text-sm font-bold text-ink">Ejercer un derecho</p>
        <Field label="Tipo de solicitud">
          <select
            value={type}
            onChange={(e) => setType(e.target.value as DataRequestType)}
            className={inputClass}
          >
            {DATA_REQUEST_OPTIONS.map((option) => (
              <option key={option.type} value={option.type}>
                {option.label} - {option.description}
              </option>
            ))}
          </select>
        </Field>
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
        <button
          type="submit"
          disabled={createRequest.isPending}
          className="inline-flex items-center gap-2 rounded-[10px] bg-brasa px-[22px] py-[11px] text-sm font-semibold text-white transition hover:bg-brasa-hover disabled:opacity-60"
        >
          {createRequest.isPending ? 'Enviando...' : 'Enviar solicitud'}
        </button>
      </form>

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
