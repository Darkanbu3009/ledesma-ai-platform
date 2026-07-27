import { useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, ShieldCheck, TriangleAlert } from 'lucide-react';
import type { TeclaControl } from '../../lib/relay-teclado';
import { useTecladoRelay, type FuenteRelay } from './useTecladoRelay';

/**
 * RELAY DE TECLADO MOVIL (conocimiento minimo). SOLO se monta en dispositivos tactiles (lo deciden
 * LoginEnVivoDialog y GrabarTareaDialog): la vista en vivo del proveedor no levanta el teclado nativo,
 * asi que el usuario teclea en ESTE campo propio y las pulsaciones se transmiten CIFRADAS por nuestra
 * infraestructura hacia el navegador seguro. El desktop no usa nada de esto (entrada directa al iframe).
 *
 * La integracion del canal (soporte, token, handshake ECDH autenticado, reenvio cifrado) vive en el
 * hook compartido useTecladoRelay; la FUENTE dice si el token se acuna sobre la sesion del login de un
 * sitio o sobre la de una grabacion en curso. Los textos del campo cambian con la fuente (en el login
 * se teclea el inicio de sesion; en la grabacion, los datos de la tarea y JAMAS una contrasena).
 *
 * El campo se limpia tras cada pulsacion (no acumula texto), no tiene autocompletado/autocorreccion ni
 * queda en el historial, y las teclas de control (Tab/Enter/Backspace) tienen botones propios. La
 * divulgacion al usuario se muestra ANTES de escribir, en lenguaje simple.
 */

/** Keys i18n que dependen de la fuente (el resto del bloque es identico en ambas pantallas). */
const TEXTOS_POR_FUENTE: Record<FuenteRelay['tipo'], { aviso: string; campoAria: string; placeholder: string; divulgacion: string }> = {
  sitio: {
    aviso: 'sitios.modal.avisoMovil',
    campoAria: 'sitios.relayMovil.campoAria',
    placeholder: 'sitios.relayMovil.placeholder',
    divulgacion: 'sitios.relayMovil.divulgacion',
  },
  grabacion: {
    aviso: 'grabacion.relayMovil.avisoMovil',
    campoAria: 'grabacion.relayMovil.campoAria',
    placeholder: 'grabacion.relayMovil.placeholder',
    divulgacion: 'grabacion.relayMovil.divulgacion',
  },
};

export function RelayTecladoMovil({ fuente }: { fuente: FuenteRelay }) {
  const { t } = useTranslation();
  const { estado, enviarTexto, enviarTecla } = useTecladoRelay(fuente);
  const [valor, setValor] = useState('');
  const textos = TEXTOS_POR_FUENTE[fuente.tipo];

  // Cada cambio del campo se reenvia y el campo se LIMPIA de inmediato: jamas acumula texto.
  function alCambiar(nuevo: string): void {
    if (nuevo.length > 0) enviarTexto(nuevo);
    setValor('');
  }

  // Teclas de control por teclado fisico (bonus): en movil los botones dedicados son el camino fiable.
  function alTecla(e: KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Enter') {
      e.preventDefault();
      enviarTecla('Enter');
    } else if (e.key === 'Tab') {
      e.preventDefault();
      enviarTecla('Tab');
    } else if (e.key === 'Backspace' && valor.length === 0) {
      e.preventDefault();
      enviarTecla('Backspace');
    }
  }

  // Sin soporte (navegador viejo) o feature apagada: el aviso de siempre (hazlo desde una computadora).
  if (estado === 'no_disponible') {
    return (
      <div role="note" className="flex-none border-b border-brasa-line bg-brasa-soft px-6 py-3">
        <p className="flex items-start gap-1.5 text-sm font-medium text-brasa">
          <TriangleAlert className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" />
          <span>{t(textos.aviso)}</span>
        </p>
      </div>
    );
  }

  const teclas: TeclaControl[] = ['Tab', 'Backspace', 'Enter'];

  return (
    <div className="flex-none border-b border-line-soft bg-field/40 px-6 py-3">
      {/* Tarjeta puramente visual: no aporta elementos enfocables ni cambia el orden de foco. */}
      <div className="rounded-xl border border-line bg-surface p-3">
        <p className="text-xs font-medium text-muted">{t('sitios.relayMovil.titulo')}</p>

        <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            type="text"
            inputMode="text"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            name="relay-teclado-efimero"
            aria-label={t(textos.campoAria)}
            placeholder={t(textos.placeholder)}
            value={valor}
            disabled={estado !== 'listo'}
            onChange={(e) => alCambiar(e.target.value)}
            onKeyDown={alTecla}
            className="w-full flex-1 rounded-xl border border-brasa bg-field px-4 py-3 text-sm text-ink placeholder:text-muted-soft focus:outline-none focus:ring-2 focus:ring-brasa-soft disabled:opacity-60"
          />
          <div className="flex flex-none gap-2">
            {teclas.map((tecla) => (
              <button
                key={tecla}
                type="button"
                disabled={estado !== 'listo'}
                onClick={() => enviarTecla(tecla)}
                className="inline-flex h-11 items-center justify-center rounded-[10px] border border-line bg-cream px-3 text-[13px] font-medium text-ink transition hover:border-brasa-line disabled:cursor-not-allowed disabled:opacity-60"
              >
                {t(`sitios.relayMovil.tecla.${tecla}`)}
              </button>
            ))}
          </div>
        </div>

        {/* En estado listo el aviso queda solo para lectores de pantalla (sr-only): visualmente no
            hace falta, pero conserva el elemento y su role. */}
        <p
          className={
            estado === 'listo' ? 'sr-only' : 'mt-2 flex items-center gap-1.5 text-[11px] text-muted'
          }
          role="status"
        >
          {estado === 'listo' ? (
            t('sitios.relayMovil.listo')
          ) : estado === 'error' ? (
            <span className="text-brasa">{t('sitios.relayMovil.error')}</span>
          ) : (
            <>
              <Loader2 className="h-3 w-3 flex-none animate-spin" aria-hidden="true" />
              {t('sitios.relayMovil.conectando')}
            </>
          )}
        </p>

        {/* DIVULGACION explicita en lenguaje simple (ES/EN), visible antes de escribir. */}
        <p className="mt-2 flex items-start gap-1.5 text-xs leading-relaxed text-muted">
          <ShieldCheck className="mt-0.5 h-4 w-4 flex-none text-ok" aria-hidden="true" />
          <span>{t(textos.divulgacion)}</span>
        </p>
      </div>
    </div>
  );
}
