import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react';
import {
  agruparPorCategoria,
  filtrarCatalogo,
  type SitioSugerido,
} from '../../lib/catalogo-sitios';
import { LOGOS_CATALOGO, usaColorDeMarca } from '../../lib/logos-catalogo';

const INPUT_ID = 'sitio-url';
const LISTBOX_ID = 'sitio-url-listbox';

function opcionId(sitioId: string): string {
  return `sitio-url-opcion-${sitioId}`;
}

/**
 * Logo de una fila del catalogo: SVG inline de simple-icons (20x20, un solo path) con el hex de
 * marca, o currentColor sobre text-ink cuando el hex no contrasta 3:1 contra el panel. Para
 * iconoSlug null (o slug sin logo empaquetado), circulo de la MISMA medida con la inicial del
 * nombre, para que la lista no baile.
 */
function LogoSitio({ nombre, iconoSlug }: { nombre: string; iconoSlug: string | null }) {
  const logo = iconoSlug === null ? undefined : LOGOS_CATALOGO[iconoSlug];
  if (logo === undefined) {
    return (
      <span
        aria-hidden="true"
        className="flex h-5 w-5 flex-none items-center justify-center rounded-full border border-line bg-field text-[10px] font-semibold text-muted"
      >
        {nombre.charAt(0).toUpperCase()}
      </span>
    );
  }
  const deMarca = usaColorDeMarca(logo.hex);
  return (
    <svg
      viewBox="0 0 24 24"
      width={20}
      height={20}
      aria-hidden="true"
      className={deMarca ? 'flex-none' : 'flex-none text-ink'}
      fill={deMarca ? `#${logo.hex}` : 'currentColor'}
    >
      <path d={logo.path} />
    </svg>
  );
}

/**
 * Input de URL de /sitios con el CATALOGO de sitios sugeridos desplegable (patron combobox ARIA).
 * Es SOLO un atajo de captura: al enfocar se abre el panel; teclear filtra por nombre y dominio
 * (sin coincidencias el panel se oculta y la URL libre sigue funcionando igual que siempre);
 * seleccionar una fila rellena el input con la URL de login y cierra el panel, SIN conectar nada.
 * El submit del formulario, la validacion y la mutacion de conectar siguen viviendo en la pagina.
 * Los sitios ya conectados se muestran atenuados y no son seleccionables.
 */
export function CatalogoSitiosCombobox({
  value,
  onChange,
  dominiosConectados,
}: {
  value: string;
  onChange: (valor: string) => void;
  /** Dominios ya conectados por el usuario (de la lista que la pagina ya tiene). */
  dominiosConectados: ReadonlySet<string>;
}) {
  const { t } = useTranslation();
  const contenedorRef = useRef<HTMLDivElement>(null);
  const [abierto, setAbierto] = useState(false);
  const [activoId, setActivoId] = useState<string | null>(null);

  const resultados = filtrarCatalogo(value);
  const grupos = agruparPorCategoria(resultados);
  // Sin coincidencias el panel se oculta solo: el usuario escribe su URL libremente.
  const visible = abierto && grupos.length > 0;
  const seleccionables = resultados.filter((sitio) => !dominiosConectados.has(sitio.dominio));
  const activo = visible ? (seleccionables.find((sitio) => sitio.id === activoId) ?? null) : null;

  // Clic fuera cierra el panel. Listener global: el mousedown en las opciones se previene para no
  // robar el foco del input, asi que blur no sirve como senal de cierre.
  useEffect(() => {
    function alPresionarFuera(evento: PointerEvent) {
      if (contenedorRef.current && !contenedorRef.current.contains(evento.target as Node)) {
        setAbierto(false);
      }
    }
    document.addEventListener('pointerdown', alPresionarFuera);
    return () => document.removeEventListener('pointerdown', alPresionarFuera);
  }, []);

  function seleccionar(sitio: SitioSugerido) {
    onChange(sitio.urlLogin);
    setAbierto(false);
    setActivoId(null);
  }

  /** Mueve el resaltado con las flechas entre las opciones seleccionables y lo deja a la vista. */
  function mover(delta: 1 | -1) {
    if (seleccionables.length === 0) return;
    const indice = seleccionables.findIndex((sitio) => sitio.id === activoId);
    const siguiente =
      indice === -1
        ? delta === 1
          ? 0
          : seleccionables.length - 1
        : (indice + delta + seleccionables.length) % seleccionables.length;
    const sitio = seleccionables[siguiente];
    if (sitio === undefined) return;
    setActivoId(sitio.id);
    const opcion = document.getElementById(opcionId(sitio.id));
    // jsdom no implementa scrollIntoView; en el navegador mantiene el resaltado a la vista.
    if (opcion && typeof opcion.scrollIntoView === 'function') {
      opcion.scrollIntoView({ block: 'nearest' });
    }
  }

  function alTeclear(evento: KeyboardEvent<HTMLInputElement>) {
    if (evento.key === 'ArrowDown' || evento.key === 'ArrowUp') {
      evento.preventDefault();
      if (!abierto) setAbierto(true);
      mover(evento.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (evento.key === 'Enter' && activo !== null) {
      // Enter con una opcion resaltada selecciona; sin resaltado, el submit del form sigue igual.
      evento.preventDefault();
      seleccionar(activo);
      return;
    }
    if (evento.key === 'Escape' && visible) {
      evento.preventDefault();
      setAbierto(false);
    }
  }

  return (
    <div ref={contenedorRef} className="relative w-full flex-1">
      <input
        id={INPUT_ID}
        type="url"
        inputMode="url"
        role="combobox"
        aria-expanded={visible}
        aria-controls={LISTBOX_ID}
        aria-autocomplete="list"
        aria-activedescendant={activo !== null ? opcionId(activo.id) : undefined}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setAbierto(true);
          setActivoId(null);
        }}
        onFocus={() => setAbierto(true)}
        onClick={() => setAbierto(true)}
        onKeyDown={alTeclear}
        placeholder={t('sitios.conectar.placeholder')}
        className="h-12 w-full rounded-xl border border-line bg-field px-4 text-sm text-ink placeholder:text-muted-soft focus:border-brasa-line focus:outline-none sm:h-11"
      />
      {visible && (
        <ul
          role="listbox"
          id={LISTBOX_ID}
          aria-label={t('sitios.catalogo.listaAria')}
          className="absolute left-0 right-0 top-full z-20 mt-2 max-h-[320px] overflow-y-auto rounded-xl border border-line bg-surface p-1.5 shadow-card-hover"
        >
          {grupos.map((grupo) => [
            <li
              key={grupo.categoria}
              role="presentation"
              className="px-2.5 pb-1 pt-2.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-soft first:pt-1.5"
            >
              {t(`sitios.catalogo.grupo.${grupo.categoria}`)}
            </li>,
            ...grupo.sitios.map((sitio) => {
              const conectado = dominiosConectados.has(sitio.dominio);
              const resaltado = activo?.id === sitio.id;
              return (
                <li
                  key={sitio.id}
                  id={opcionId(sitio.id)}
                  role="option"
                  aria-selected={resaltado}
                  aria-disabled={conectado || undefined}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    if (!conectado) seleccionar(sitio);
                  }}
                  className={[
                    'flex items-start gap-2.5 rounded-lg px-2.5 py-2',
                    conectado ? 'opacity-50' : 'cursor-pointer',
                    resaltado ? 'bg-line-soft' : conectado ? '' : 'hover:bg-line-soft',
                  ].join(' ')}
                >
                  <span className="mt-0.5 flex-none">
                    <LogoSitio nombre={sitio.nombre} iconoSlug={sitio.iconoSlug} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-sm font-medium text-ink">{sitio.nombre}</span>
                      <span className="truncate text-[12px] text-muted">{sitio.dominio}</span>
                    </span>
                    {sitio.advertencia !== undefined && (
                      <span className="mt-0.5 block text-[12px] leading-snug text-muted">
                        {sitio.advertencia === 'automatizacion_restringida'
                          ? t('sitios.catalogo.advertencia.automatizacionRestringida')
                          : t('sitios.catalogo.advertencia.datosSensibles')}
                      </span>
                    )}
                    {sitio.nota !== undefined && (
                      <span className="mt-0.5 block text-[12px] leading-snug text-muted">
                        {t(`sitios.catalogo.nota.${sitio.nota}`)}
                      </span>
                    )}
                  </span>
                  {conectado && (
                    <span className="flex flex-none items-center gap-1 self-center text-[11px] font-semibold uppercase tracking-wide text-ok">
                      <Check className="h-3.5 w-3.5" aria-hidden="true" />
                      {t('sitios.catalogo.conectado')}
                    </span>
                  )}
                </li>
              );
            }),
          ])}
        </ul>
      )}
    </div>
  );
}
