import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from './api';
import { supabase } from './supabase';
import type { DeleteAccountResponse } from './account';

/**
 * BORRADO SELF-SERVICE de la propia cuenta (DELETE /v1/me con { confirmEmail }). Vive APARTE de
 * mutations.ts a proposito: a diferencia de las mutaciones de datos puras de ese archivo (solo apiFetch +
 * invalidacion de cache), esta tiene EFECTOS de sesion/navegacion (signOut + redirect) y por eso importa
 * supabase y react-router. Mantenerla aislada evita arrastrar esas dependencias a mutations.ts (y a sus
 * tests, que no las mockean).
 *
 * Al EXITO (200): la cuenta ya no existe. El JWT es STATELESS -> el backend no puede revocar el token; la
 * sesion se invalida del lado CLIENTE con signOut(). Se hace SIEMPRE ante un 200, sin ramificar por
 * `authUser`: en los cuatro outcomes los datos del usuario ya se borraron, asi que la sesion no debe
 * persistir. Tras cerrar sesion se redirige a la landing publica (/, fuera de la consola). Es best-effort: aunque el
 * signOut falle (p.ej. el revoke de red da error porque la identidad ya no existe), NO dejamos al usuario
 * dentro de una consola cuya cuenta se borro -> el redirect ocurre igual.
 *
 * El error 400 (el email escrito no coincide, revalidado server-side) se propaga como ApiError para que el
 * modal lo muestre; la mutacion no maneja el error aqui (lo hace la UI con deleteAccountErrorMessage).
 */
export function useDeleteAccount() {
  const navigate = useNavigate();
  return useMutation({
    mutationFn: (confirmEmail: string) =>
      apiFetch<DeleteAccountResponse>('/v1/me', {
        method: 'DELETE',
        body: JSON.stringify({ confirmEmail }),
      }),
    onSuccess: async () => {
      // Cerrar sesion del lado cliente ANTES de navegar: la landing (/) rebota a /agentes si aun hay
      // sesion (HomePage), asi que primero invalidamos la sesion y luego salimos. try/catch: un fallo del
      // signOut no debe impedir el redirect (la cuenta ya se borro; la sesion no debe quedar viva).
      try {
        await supabase.auth.signOut();
      } catch {
        // Ignorado a proposito: el redirect de abajo saca al usuario aunque el signOut falle.
      }
      navigate('/', { replace: true });
    },
  });
}
