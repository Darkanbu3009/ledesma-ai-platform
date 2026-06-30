import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Env } from '../config/env.js';
import { AppError } from '../errors/app-error.js';
import { getSql } from '../db/client.js';
import { ProviderCredentialRepository } from '../credentials/provider-credential-repository.js';
import { createSupabaseJwtVerifier, type JwtVerifier } from '../auth/jwt-verifier.js';
import { requireUser } from '../auth/require-user.js';
import { encryptToToken } from '../crypto/aes-gcm.js';

// Body de creacion. providerId espeja el enum real (igual que AgentInputSchema); apiKey es la key en
// CLARO y vive SOLO en este request: se cifra de inmediato (AES-256-GCM) y nunca se persiste ni se
// loguea en claro (el logger redacta req.body.apiKey y apiKey). openai-compatible exige baseUrl.
const CreateCredentialSchema = z
  .object({
    label: z.string().min(1).max(120),
    providerId: z.enum(['anthropic', 'openai', 'openai-compatible']),
    apiKey: z.string().min(1).max(8192),
    baseUrl: z.string().url().optional(),
  })
  .refine((body) => body.providerId !== 'openai-compatible' || body.baseUrl !== undefined, {
    message: 'baseUrl es requerido para el proveedor openai-compatible',
    path: ['baseUrl'],
  });

const CredentialIdParamSchema = z.object({ id: z.string().uuid() });

/**
 * Endpoints de la BOVEDA DE CREDENCIALES, todos scoped por el usuario autenticado (requireUser, mismo
 * auth JWT de Supabase que /v1/agents). El owner_id SIEMPRE sale del token (se ignora cualquier
 * ownerId del body). NO existe ningun endpoint que devuelva la key descifrada: solo metadata.
 * Permite inyectar el verifier en tests.
 */
export function credentialRoutes(config: Env, deps?: { verifier?: JwtVerifier }) {
  return async function (app: FastifyInstance): Promise<void> {
    const repo = new ProviderCredentialRepository(getSql(config));
    const verifier = deps?.verifier ?? createSupabaseJwtVerifier(config);

    // Guarda una credencial cifrada del usuario. La apiKey en claro se cifra con AES-256-GCM bajo
    // VAULT_SECRET ANTES de tocar la base; la respuesta es metadata SIN la key (ni cifrada ni en claro).
    app.post('/v1/credentials', async (request: FastifyRequest, reply: FastifyReply) => {
      const user = await requireUser(request, verifier);
      const parsed = CreateCredentialSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new AppError('VALIDATION_ERROR', 400, 'Invalid credential', parsed.error.issues);
      }
      const encryptedKey = encryptToToken(parsed.data.apiKey, config.VAULT_SECRET);
      const credential = await repo.create({
        // owner_id SIEMPRE = usuario autenticado (ignora cualquier ownerId del body).
        ownerId: user.id,
        label: parsed.data.label,
        providerId: parsed.data.providerId,
        encryptedKey,
        baseUrl: parsed.data.baseUrl ?? null,
      });
      return reply.status(201).send({ credential });
    });

    // Lista la metadata de las credenciales del usuario (id, label, providerId, baseUrl, createdAt).
    // NUNCA la key.
    app.get('/v1/credentials', async (request: FastifyRequest, reply: FastifyReply) => {
      const user = await requireUser(request, verifier);
      const credentials = await repo.listByOwner(user.id);
      return reply.send({ credentials });
    });

    // Borra una credencial del usuario. Acotado al owner: solo borra las propias.
    app.delete(
      '/v1/credentials/:id',
      async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
        const user = await requireUser(request, verifier);
        const params = CredentialIdParamSchema.safeParse(request.params);
        if (!params.success) {
          throw new AppError('VALIDATION_ERROR', 400, 'Invalid credential id', params.error.issues);
        }
        const removed = await repo.deleteForOwner(user.id, params.data.id);
        if (!removed) throw new AppError('NOT_FOUND', 404, 'Credential not found');
        return reply.status(204).send();
      },
    );
  };
}
