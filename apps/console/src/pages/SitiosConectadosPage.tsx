import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Globe, Loader2, Lock, Trash2, Unplug } from 'lucide-react';
import { ApiError } from '../lib/api';
import i18n from '../i18n';
import { useJobSeguimiento, useJobsSeguimiento, useMe, useSitios } from '../lib/queries';
import {
  useConectarSitio,
  useConfirmarSitio,
  useDesconectarSitio,
  useEliminarSitio,
} from '../lib/mutations';
import {
  estadoSitioLabel,
  inicialDeDominio,
  normalizarUrlDeSitio,
  sitioEnLoginParaDominio,
  type EstadoSitio,
  type SitioConectado,
} from '../lib/sitios';
import { isJobInFlight } from '../lib/jobs';
import { formatRunAt } from '../lib/schedule';
import { LoginEnVivoDialog } from '../components/sitios/LoginEnVivoDialog';
import { DesconectarSitioDialog } from '../components/sitios/DesconectarSitioDialog';
import { EliminarSitioDialog } from '../components/sitios/EliminarSitioDialog';
import { PageHeader } from '../components/ui/PageHeader';
import { SkeletonList } from '../components/ui/SkeletonList';
import { ErrorState } from '../components/ui/ErrorState';
import { ChoosePlanCta } from '../components/upgrade/ChoosePlanCta';
import { tierAllowsAutonomy } from '../lib/plans';

/** Traduce el error del backend al conectar/confirmar/desconectar a un mensaje legible. */
function backendMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return i18n.t('sitios.errores.sesion');
    if (error.status === 403) return i18n.t('sitios.errores.plan');
    if (error.status === 404) return i18n.t('sitios.errores.noExiste');
    if (error.status === 400) return i18n.t('sitios.errores.rechazo');
  }
  return i18n.t('sitios.errores.generico');
}

/** Pill de estado de una conexion. 'esperando login' lleva spinner (hay un login en curso). */
function EstadoBadge({ estado }: { estado: EstadoSitio }) {
  const tone: Record<EstadoSitio, string> = {
    activo: 'border-ok/30 bg-ok/10 text-ok',
    esperando_login: 'border-line bg-line-soft text-muted',
    caducado: 'border-[#EAD9A0] bg-[#FBF3D9] text-[#7A5600]',
    error: 'border-[rgba(192,73,43,0.3)] bg-[rgba(192,73,43,0.08)] text-[#C0492B]',
  };
  return (
    <span
      className={[
        'inline-flex flex-none items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
        tone[estado],
      ].join(' ')}
    >
      {estado === 'esperando_login' && <Loader2 className="h-3 w-3 animate-spin" />}
      {estadoSitioLabel(estado)}
    </span>
  );
}

/**
 * Fila de UN sitio conectado: inicial del dominio, dominio, estado, ultimo uso y las dos salidas:
 * "Desconectar" (el flujo limpio) y el icono de ELIMINAR (bote de basura), el borrado FORZADO
 * garantizado para conexiones atascadas que el flujo limpio no puede desconectar.
 */
function SitioCard({
  sitio,
  desconectando,
  onDesconectar,
  onEliminar,
}: {
  sitio: SitioConectado;
  /** true mientras la desconexion de ESTE sitio esta encolada/corriendo (deshabilita los botones). */
  desconectando: boolean;
  onDesconectar: () => void;
  onEliminar: () => void;
}) {
  const { t } = useTranslation();
  const ultimoUso = formatRunAt(sitio.ultimoUsoEn);

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-5 shadow-card sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-3.5">
        <span
          aria-hidden="true"
          className="flex h-[42px] w-[42px] flex-none items-center justify-center rounded-xl bg-ink font-display text-lg font-bold text-cream"
        >
          {inicialDeDominio(sitio.dominio)}
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="min-w-0 truncate font-display text-[15px] font-bold text-ink">
              {sitio.dominio}
            </h3>
            <EstadoBadge estado={sitio.estado} />
          </div>
          <p className="mt-1 text-[12.5px] text-muted">
            {ultimoUso
              ? t('sitios.lista.ultimoUso', { fecha: ultimoUso })
              : t('sitios.lista.sinUso')}
          </p>
        </div>
      </div>
      <div className="flex flex-none items-center gap-2 self-start sm:self-center">
        <button
          type="button"
          onClick={onDesconectar}
          disabled={desconectando}
          className="inline-flex flex-none items-center justify-center gap-1.5 rounded-[10px] border border-line bg-surface px-3.5 py-2 text-[13px] font-medium text-muted transition hover:border-[rgba(192,73,43,0.4)] hover:text-[#C0492B] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {desconectando ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Unplug className="h-4 w-4" />
          )}
          {desconectando ? t('sitios.lista.desconectando') : t('sitios.lista.desconectar')}
        </button>
        <button
          type="button"
          onClick={onEliminar}
          disabled={desconectando}
          aria-label={t('sitios.lista.eliminarAria', { dominio: sitio.dominio })}
          title={t('sitios.lista.eliminar')}
          className="inline-flex h-9 w-9 flex-none items-center justify-center rounded-[10px] border border-line bg-surface text-muted transition hover:border-[rgba(192,73,43,0.4)] hover:text-[#C0492B] disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

/** Gate de autonomia: mismo hero que Recetas/Tareas/Triggers, con el CTA al catalogo de planes. */
function SitiosLocked() {
  const { t } = useTranslation();
  return (
    <section className="mx-auto flex w-full max-w-[520px] flex-col items-center pb-12 pt-14 text-center">
      <span className="inline-flex items-center gap-1.5 rounded-full bg-[#F1EFE8] px-3 py-[5px]">
        <Lock className="h-3 w-3 flex-none text-[#5F5E5A]" aria-hidden="true" />
        <span className="text-[11px] uppercase tracking-[0.08em] text-[#5F5E5A]">
          {t('sitios.gate.badge')}
        </span>
      </span>
      <h1 className="mt-5 text-[26px] font-medium leading-[1.15] tracking-[-0.02em] text-ink">
        {t('sitios.gate.titulo')}
      </h1>
      <p className="mt-3 text-[14px] leading-[1.6] text-[#5F5E5A]">{t('sitios.gate.descripcion')}</p>
      <ChoosePlanCta className="mt-6" />
    </section>
  );
}

/**
 * Pagina SITIOS CONECTADOS (/sitios, Fase 7.1c): el usuario pega la URL de un sitio con login, se
 * abre un navegador remoto seguro, EL MISMO inicia sesion en la vista en vivo embebida y confirma;
 * la conexion queda 'activo' y lista para que un agente opere dentro de su cuenta (eso es 7.1d, no
 * este PR). Tambien lista las conexiones y permite desconectarlas (borrado ARCO, con confirmacion).
 *
 * PRINCIPIO NO NEGOCIABLE: el login lo hace el usuario, no la plataforma. La unica entrada de esta
 * pagina es la URL; la contrasena se teclea dentro del iframe de la vista en vivo (directo contra el
 * proveedor del navegador remoto) y JAMAS pasa por el backend ni por el dominio de Ledesma.
 *
 * TODO el asincronismo va con react-query (sin setState en useEffect): las mutaciones solo guardan
 * el jobId encolado; el avance se DERIVA de useJobSeguimiento (polling del job, patron V017) y de
 * useSitios (auto-refresh de la lista mientras hay transiciones). El modal se abre cuando la fila
 * 'esperando_login' con vista en vivo aparece en la lista: estado derivado de datos, no efectos.
 */
export function SitiosConectadosPage() {
  const { t } = useTranslation();
  const me = useMe();
  const isAutonomous = tierAllowsAutonomy(me.data?.profile?.tier);

  const [url, setUrl] = useState('');
  const [urlError, setUrlError] = useState<string | null>(null);
  /** Conexion EN CURSO iniciada por esta pagina: el job encolado + el dominio a vigilar en la lista. */
  const [conexion, setConexion] = useState<{ jobId: string; dominio: string } | null>(null);
  /** Desconexion EN CURSO: el job encolado + el sitio para marcar su fila mientras desaparece. */
  const [desconexion, setDesconexion] = useState<{ jobId: string; sitioId: string } | null>(null);
  const [aDesconectar, setADesconectar] = useState<SitioConectado | null>(null);
  /**
   * Borrados FORZADOS EN CURSO: UNA entrada por sitio (job encolado + fila que se oculta de
   * inmediato). Es una LISTA a proposito: el usuario puede encadenar el eliminar de varios sitios
   * y ninguno pierde su seguimiento (un slot unico sobreescribiria el anterior y su fallo seria
   * invisible).
   */
  const [eliminaciones, setEliminaciones] = useState<Array<{ jobId: string; sitioId: string }>>([]);
  const [aEliminar, setAEliminar] = useState<SitioConectado | null>(null);

  const conectar = useConectarSitio();
  const confirmar = useConfirmarSitio();
  const desconectar = useDesconectarSitio();
  const eliminar = useEliminarSitio();

  const conexionJob = useJobSeguimiento(conexion?.jobId ?? null);
  const desconexionJob = useJobSeguimiento(desconexion?.jobId ?? null);
  const eliminacionJobs = useJobsSeguimiento(eliminaciones.map((e) => e.jobId));

  // DERIVACION de la desconexion: error si el job fallo (la fila sigue existiendo).
  const desconexionFallo = desconexion !== null && desconexionJob.data?.status === 'failed';
  // DERIVACION del borrado forzado (apareado por indice con eliminacionJobs): una eliminacion esta
  // FALLIDA si su job termino en failed (solo posible por la propia plataforma, jamas por el
  // proveedor) o si su consulta quedo en error (react-query agoto los reintentos de GET /v1/jobs).
  // En ambos casos la fila oculta REAPARECE junto al aviso, y el polling de esa entrada se apaga.
  const idsFallidos = new Set(
    eliminaciones
      .filter((_e, i) => eliminacionJobs[i]?.data?.status === 'failed' || eliminacionJobs[i]?.isError === true)
      .map((e) => e.sitioId),
  );
  const hayEliminacionFallida = idsFallidos.size > 0;

  // La lista se refresca sola mientras hay filas en transicion (dentro de useSitios); ademas se le
  // pide polling extra mientras un job de conectar sigue en vuelo (la fila aun no existe) o una
  // desconexion/eliminacion espera que su fila desaparezca (job en vuelo, o completado con la fila
  // aun visible).
  const sitiosQuery = useSitios(
    (lista) =>
      conexion !== null ||
      (desconexion !== null &&
        !desconexionFallo &&
        (desconexionJob.data === undefined ||
          isJobInFlight(desconexionJob.data.status) ||
          lista.some((sitio) => sitio.id === desconexion.sitioId))) ||
      eliminaciones.some((e, i) => {
        const job = eliminacionJobs[i];
        if (job === undefined || job.isError || job.data?.status === 'failed') return false;
        return (
          job.data === undefined ||
          isJobInFlight(job.data.status) ||
          lista.some((sitio) => sitio.id === e.sitioId)
        );
      }),
  );
  const sitios = sitiosQuery.data ?? [];
  // La fila de un borrado forzado en curso desaparece DE INMEDIATO (derivado, sin efectos): si el
  // job llegara a fallar por la plataforma, el filtro se apaga y la fila reaparece junto al aviso.
  const sitiosVisibles = sitios.filter(
    (sitio) => !eliminaciones.some((e) => e.sitioId === sitio.id && !idsFallidos.has(e.sitioId)),
  );

  // DERIVACIONES del flujo de conexion (sin efectos): el modal abre cuando la fila del login existe.
  const sitioEnLogin = conexion ? sitioEnLoginParaDominio(sitios, conexion.dominio) : null;
  const conexionFallo = conexion !== null && conexionJob.data?.status === 'failed';
  const abriendoNavegador = conexion !== null && !sitioEnLogin && !conexionFallo;

  function handleConectar(e: FormEvent) {
    e.preventDefault();
    const normalizada = normalizarUrlDeSitio(url);
    if (!normalizada) {
      setUrlError(t('sitios.conectar.urlInvalida'));
      return;
    }
    setUrlError(null);
    conectar.mutate(normalizada, {
      onSuccess: (aceptada) => {
        setConexion({ jobId: aceptada.jobId, dominio: aceptada.dominio });
        setUrl('');
      },
    });
  }

  function handleConfirmar() {
    if (!sitioEnLogin) return;
    confirmar.mutate(sitioEnLogin.id, {
      // Cerrar el modal: la lista sigue refrescandose sola (fila en 'esperando_login') hasta que el
      // worker confirme y la deje en 'activo' (o 'error' si fallo).
      onSuccess: () => setConexion(null),
    });
  }

  function handleCancelarLogin() {
    // Cierra el modal (o el spinner) sin confirmar. La sesion remota expira sola del lado del
    // proveedor y el barrido del worker marca la fila; aqui no hay nada mas que limpiar.
    setConexion(null);
  }

  function handleDesconectar() {
    if (!aDesconectar) return;
    const sitio = aDesconectar;
    desconectar.mutate(sitio.id, {
      onSuccess: (aceptada) => {
        setDesconexion({ jobId: aceptada.jobId, sitioId: sitio.id });
        setADesconectar(null);
      },
    });
  }

  function handleEliminar() {
    if (!aEliminar) return;
    const sitio = aEliminar;
    eliminar.mutate(sitio.id, {
      onSuccess: (aceptada) => {
        // Un reintento sobre el mismo sitio reemplaza su entrada previa (fallida); las demas siguen.
        setEliminaciones((prev) => [
          ...prev.filter((e) => e.sitioId !== sitio.id),
          { jobId: aceptada.jobId, sitioId: sitio.id },
        ]);
        setAEliminar(null);
      },
    });
  }

  const hasSitios = sitiosVisibles.length > 0;

  return (
    <div className="mx-auto flex min-h-full max-w-4xl flex-col">
      {(me.isLoading || isAutonomous) && (
        <PageHeader title={t('sitios.titulo')} subtitle={t('sitios.subtitulo')} />
      )}

      {me.isLoading ? (
        <SkeletonList cardClassName="h-[92px]" />
      ) : !isAutonomous ? (
        <SitiosLocked />
      ) : (
        <>
          {/* Conectar: la unica entrada humana es la URL. Sin formulario de configuracion por sitio. */}
          <form onSubmit={handleConectar} className="mt-6" noValidate>
            <div className="flex flex-col gap-3 sm:flex-row">
              <label htmlFor="sitio-url" className="sr-only">
                {t('sitios.conectar.label')}
              </label>
              <input
                id="sitio-url"
                type="url"
                inputMode="url"
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  setUrlError(null);
                }}
                placeholder={t('sitios.conectar.placeholder')}
                className="h-11 w-full flex-1 rounded-xl border border-line bg-field px-4 text-sm text-ink placeholder:text-muted-soft focus:border-brasa-line focus:outline-none"
              />
              <button
                type="submit"
                disabled={conectar.isPending || abriendoNavegador}
                className="inline-flex h-11 flex-none items-center justify-center gap-2 rounded-[10px] bg-brasa px-[22px] text-sm font-semibold text-white shadow-[0_1px_2px_rgba(31,30,28,0.10)] transition hover:bg-brasa-hover disabled:cursor-not-allowed disabled:opacity-60"
              >
                {conectar.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Globe className="h-4 w-4" />
                )}
                {t('sitios.conectar.boton')}
              </button>
            </div>
            {urlError && (
              <p role="alert" className="mt-2 text-sm text-brasa">
                {urlError}
              </p>
            )}
            {conectar.isError && !urlError && (
              <p role="alert" className="mt-2 text-sm text-brasa">
                {backendMessage(conectar.error)}
              </p>
            )}
          </form>

          {/* Mientras llega la vista en vivo: spinner con el texto acordado. */}
          {abriendoNavegador && (
            <div
              role="status"
              className="mt-4 flex items-center gap-2.5 rounded-xl border border-line bg-surface px-4 py-3 text-sm text-muted"
            >
              <Loader2 className="h-4 w-4 flex-none animate-spin text-brasa" />
              {t('sitios.conectar.abriendo', { dominio: conexion?.dominio ?? '' })}
            </div>
          )}

          {/* El job de conectar fallo: mensaje accionable (el error ya viene truncado del backend). */}
          {conexionFallo && (
            <div
              role="alert"
              className="mt-4 flex flex-col gap-2 rounded-xl border border-brasa-line bg-brasa-soft px-4 py-3 text-sm font-medium text-brasa"
            >
              <span>{t('sitios.conectar.fallo', { dominio: conexion?.dominio ?? '' })}</span>
              <button
                type="button"
                onClick={handleCancelarLogin}
                className="self-start rounded-lg border border-brasa-line px-3 py-1.5 text-[13px] font-semibold transition hover:bg-brasa/10"
              >
                {t('sitios.comunes.entendido')}
              </button>
            </div>
          )}

          {/* Algun borrado forzado fallo (solo posible por la propia plataforma, jamas por el
              proveedor): sus filas reaparecen; aviso con cierre explicito que descarta SOLO las
              entradas fallidas (las eliminaciones aun en vuelo siguen su curso). */}
          {hayEliminacionFallida && (
            <div
              role="alert"
              className="mt-4 flex flex-col gap-2 rounded-xl border border-brasa-line bg-brasa-soft px-4 py-3 text-sm font-medium text-brasa"
            >
              <span>{t('sitios.errores.eliminarFallo')}</span>
              <button
                type="button"
                onClick={() =>
                  setEliminaciones((prev) => prev.filter((e) => !idsFallidos.has(e.sitioId)))
                }
                className="self-start rounded-lg border border-brasa-line px-3 py-1.5 text-[13px] font-semibold transition hover:bg-brasa/10"
              >
                {t('sitios.comunes.entendido')}
              </button>
            </div>
          )}

          {/* La desconexion fallo: la fila sigue existiendo; aviso con cierre explicito. */}
          {desconexionFallo && (
            <div
              role="alert"
              className="mt-4 flex flex-col gap-2 rounded-xl border border-brasa-line bg-brasa-soft px-4 py-3 text-sm font-medium text-brasa"
            >
              <span>{t('sitios.errores.desconectarFallo')}</span>
              <button
                type="button"
                onClick={() => setDesconexion(null)}
                className="self-start rounded-lg border border-brasa-line px-3 py-1.5 text-[13px] font-semibold transition hover:bg-brasa/10"
              >
                {t('sitios.comunes.entendido')}
              </button>
            </div>
          )}

          {/* Lista de sitios. En el estado vacio no se muestra nada mas: el input de arriba ES el CTA. */}
          {sitiosQuery.isLoading ? (
            <SkeletonList cardClassName="h-[92px]" />
          ) : sitiosQuery.isError ? (
            <ErrorState
              title={t('sitios.errores.cargarLista')}
              onRetry={() => void sitiosQuery.refetch()}
            />
          ) : hasSitios ? (
            <div className="mt-6 space-y-3">
              {sitiosVisibles.map((sitio) => (
                <SitioCard
                  key={sitio.id}
                  sitio={sitio}
                  desconectando={desconexion !== null && desconexion.sitioId === sitio.id && !desconexionFallo}
                  onDesconectar={() => {
                    desconectar.reset();
                    setADesconectar(sitio);
                  }}
                  onEliminar={() => {
                    eliminar.reset();
                    setAEliminar(sitio);
                  }}
                />
              ))}
            </div>
          ) : null}
        </>
      )}

      {/* Modal de la vista en vivo: abre cuando la fila del login (con su URL) ya existe. */}
      {sitioEnLogin && (
        <LoginEnVivoDialog
          sitio={sitioEnLogin}
          confirmando={confirmar.isPending}
          error={confirmar.isError ? backendMessage(confirmar.error) : null}
          onConfirmar={handleConfirmar}
          onCerrar={handleCancelarLogin}
        />
      )}

      <DesconectarSitioDialog
        open={aDesconectar !== null}
        dominio={aDesconectar?.dominio ?? ''}
        busy={desconectar.isPending}
        error={desconectar.isError ? backendMessage(desconectar.error) : undefined}
        onConfirm={handleDesconectar}
        onCancel={() => setADesconectar(null)}
      />

      <EliminarSitioDialog
        open={aEliminar !== null}
        dominio={aEliminar?.dominio ?? ''}
        busy={eliminar.isPending}
        error={eliminar.isError ? backendMessage(eliminar.error) : undefined}
        onConfirm={handleEliminar}
        onCancel={() => setAEliminar(null)}
      />
    </div>
  );
}
