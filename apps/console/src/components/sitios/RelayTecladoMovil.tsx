import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, ShieldCheck, TriangleAlert } from 'lucide-react';
import { soportaRelay } from '../../lib/relay-crypto';
import {
  ConexionRelayTeclado,
  solicitarTokenRelay,
  type EstadoConexionRelay,
  type TeclaControl,
} from '../../lib/relay-teclado';

/**
 * RELAY DE TECLADO MOVIL (conocimiento minimo). SOLO se monta en dispositivos tactiles (lo decide
 * LoginEnVivoDialog): la vista en vivo del proveedor no levanta el teclado nativo, asi que el usuario
 * teclea en ESTE campo propio y las pulsaciones se transmiten CIFRADAS por nuestra infraestructura
 * hacia el navegador seguro. El desktop no usa nada de esto (entrada directa al iframe).
 *
 * El campo se limpia tras cada pulsacion (no acumula texto), no tiene autocompletado/autocorreccion ni
 * queda en el historial, y las teclas de control (Tab/Enter/Backspace) tienen botones propios para un
 * login real. La divulgacion al usuario se muestra ANTES de escribir, en lenguaje simple.
 */

type EstadoUI = 'preparando' | 'conectando' | 'listo' | 'no_disponible' | 'error';

function mapear(estado: EstadoConexionRelay): EstadoUI {
  if (estado === 'listo') return 'listo';
  if (estado === 'conectando') return 'conectando';
  return 'error'; // 'error' | 'cerrado' inesperado
}

function useRelayTeclado(sitioId: string): {
  estado: EstadoUI;
  enviarTexto: (texto: string) => void;
  enviarTecla: (tecla: TeclaControl) => void;
} {
  const [estado, setEstado] = useState<EstadoUI>('preparando');
  const conexionRef = useRef<ConexionRelayTeclado | null>(null);

  useEffect(() => {
    let cancelado = false;
    // Toda la mutacion de estado ocurre DENTRO de esta funcion async (tras awaits) o en el callback
    // onEstado: nunca hay setState sincrono en el cuerpo del efecto.
    const iniciar = async (): Promise<void> => {
      const soporta = await soportaRelay();
      if (cancelado) return;
      if (!soporta) {
        setEstado('no_disponible');
        return;
      }
      let tk;
      try {
        tk = await solicitarTokenRelay(sitioId);
      } catch (error) {
        if (cancelado) return;
        // 501 (RELAY_NO_DISPONIBLE): feature apagada -> aviso de siempre. Se lee el status de forma
        // estructural (ApiError lo expone) para no arrastrar lib/api ni supabase al arbol del componente.
        const status = (error as { status?: number }).status;
        setEstado(status === 501 ? 'no_disponible' : 'error');
        return;
      }
      if (cancelado) return;
      const conexion = new ConexionRelayTeclado({
        relayUrl: tk.relayUrl,
        token: tk.token,
        onEstado: (e) => {
          if (!cancelado) setEstado(mapear(e));
        },
      });
      conexionRef.current = conexion;
      setEstado('conectando');
      await conexion.conectar();
    };
    void iniciar();
    return () => {
      cancelado = true;
      conexionRef.current?.cerrar();
      conexionRef.current = null;
    };
  }, [sitioId]);

  const enviarTexto = useCallback((texto: string) => {
    void conexionRef.current?.enviarTexto(texto);
  }, []);
  const enviarTecla = useCallback((tecla: TeclaControl) => {
    void conexionRef.current?.enviarTecla(tecla);
  }, []);

  return { estado, enviarTexto, enviarTecla };
}

export function RelayTecladoMovil({ sitioId }: { sitioId: string }) {
  const { t } = useTranslation();
  const { estado, enviarTexto, enviarTecla } = useRelayTeclado(sitioId);
  const [valor, setValor] = useState('');

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
          <span>{t('sitios.modal.avisoMovil')}</span>
        </p>
      </div>
    );
  }

  const teclas: TeclaControl[] = ['Tab', 'Backspace', 'Enter'];

  return (
    <div className="flex-none border-b border-line-soft bg-field/40 px-6 py-3">
      {/* DIVULGACION explicita ANTES de escribir, en lenguaje simple (ES/EN). */}
      <p className="flex items-start gap-1.5 text-[13px] leading-snug text-muted">
        <ShieldCheck className="mt-0.5 h-4 w-4 flex-none text-ok" aria-hidden="true" />
        <span>{t('sitios.relayMovil.divulgacion')}</span>
      </p>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          type="text"
          inputMode="text"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          name="relay-teclado-efimero"
          aria-label={t('sitios.relayMovil.campoAria')}
          placeholder={t('sitios.relayMovil.placeholder')}
          value={valor}
          disabled={estado !== 'listo'}
          onChange={(e) => alCambiar(e.target.value)}
          onKeyDown={alTecla}
          className="h-11 w-full flex-1 rounded-xl border border-line bg-field px-4 text-sm text-ink placeholder:text-muted-soft focus:border-brasa-line focus:outline-none disabled:opacity-60"
        />
        <div className="flex flex-none gap-2">
          {teclas.map((tecla) => (
            <button
              key={tecla}
              type="button"
              disabled={estado !== 'listo'}
              onClick={() => enviarTecla(tecla)}
              className="inline-flex h-11 items-center justify-center rounded-[10px] border border-line bg-surface px-3 text-[13px] font-medium text-muted transition hover:border-brasa-line hover:text-ink disabled:cursor-not-allowed disabled:opacity-60"
            >
              {t(`sitios.relayMovil.tecla.${tecla}`)}
            </button>
          ))}
        </div>
      </div>

      <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-soft" role="status">
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
    </div>
  );
}
