import { z } from 'zod';
import { AppError } from '../errors/app-error.js';
import type {
  DecryptedProviderCredential,
  ProviderCredentialRepository,
} from './provider-credential-repository.js';

const CredentialIdSchema = z.string().uuid();

/**
 * Resuelve una credencial GUARDADA del usuario a su key descifrada, para uso server-side al ejecutar
 * o configurar un agente. Punto unico que comparten el runtime y el Configurador para que el
 * comportamiento de aislamiento sea identico:
 *  - valida que el credentialId sea un uuid (un header malformado da 404, no un 500 de Postgres);
 *  - delega el aislamiento por owner al repositorio: una credencial ajena, inexistente o con la key
 *    no descifrable -> 404 NOT_FOUND. Un usuario JAMAS obtiene la key de otro.
 * Nunca devuelve la key por HTTP: el llamador la usa solo para construir ProviderCredentials.
 */
export async function resolveStoredCredential(
  repo: ProviderCredentialRepository,
  ownerId: string,
  credentialId: string,
  vaultSecret: string,
): Promise<DecryptedProviderCredential> {
  const id = CredentialIdSchema.safeParse(credentialId);
  if (!id.success) throw new AppError('NOT_FOUND', 404, 'Credential not found');
  const credential = await repo.getDecryptedKeyForOwner(ownerId, id.data, vaultSecret);
  if (!credential) throw new AppError('NOT_FOUND', 404, 'Credential not found');
  return credential;
}
