import { useCallback, useEffect, useRef, useState } from 'react';
import { soportaRelay } from '../../lib/relay-crypto';
import {
  ConexionRelayTeclado,
  solicitarTokenRelay,
  solicitarTokenRelayGrabacion,
  type EstadoConexionRelay,
  type TeclaControl,
} from '../../lib/relay-teclado';

/**
 * HOOK REUTILIZABLE del RELAY DE TECLADO MOVIL (conocimiento minimo). Es la integracion completa del
 * canal, extraida de RelayTecladoMovil para que la pantalla de login y la de grabacion consuman LA
 * MISMA pieza: soporte del navegador, token efimero del backend, handshake ECDH autenticado y reenvio
 * cifrado de cada pulsacion. Cero duplicacion: cualquier pantalla nueva con vista en vivo tactil se
 * suma pasando su fuente.
 *
 * La FUENTE dice sobre que sesion de navegador se acuna el token: la del login de un sitio
 * (POST /v1/sitios/:id/relay-token) o la de una grabacion en curso
 * (POST /v1/grabaciones/:id/relay-token). El canal, el cifrado y el comportamiento son identicos.
 */

/** Sobre que sesion viva se abre el canal del relay. */
export interface FuenteRelay {
  tipo: 'sitio' | 'grabacion';
  id: string;
}

export type EstadoUI = 'preparando' | 'conectando' | 'listo' | 'no_disponible' | 'error';

function mapear(estado: EstadoConexionRelay): EstadoUI {
  if (estado === 'listo') return 'listo';
  if (estado === 'conectando') return 'conectando';
  return 'error'; // 'error' | 'cerrado' inesperado
}

export function useTecladoRelay(fuente: FuenteRelay): {
  estado: EstadoUI;
  enviarTexto: (texto: string) => void;
  enviarTecla: (tecla: TeclaControl) => void;
} {
  const [estado, setEstado] = useState<EstadoUI>('preparando');
  const conexionRef = useRef<ConexionRelayTeclado | null>(null);
  const { tipo, id } = fuente;

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
        tk = tipo === 'grabacion' ? await solicitarTokenRelayGrabacion(id) : await solicitarTokenRelay(id);
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
        hs: tk.hs,
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
  }, [tipo, id]);

  const enviarTexto = useCallback((texto: string) => {
    void conexionRef.current?.enviarTexto(texto);
  }, []);
  const enviarTecla = useCallback((tecla: TeclaControl) => {
    void conexionRef.current?.enviarTecla(tecla);
  }, []);

  return { estado, enviarTexto, enviarTecla };
}
