import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import type { Env } from '../config/env.js';

export interface AuthenticatedUser {
  id: string;     // sub del JWT (uuid del usuario de Supabase)
  email: string | null;
}

export interface JwtVerifier {
  verify(token: string): Promise<AuthenticatedUser>;
}

/** Construye un verificador de JWT contra la JWKS de Supabase (ES256). */
export function createSupabaseJwtVerifier(config: Env): JwtVerifier {
  const issuer = `${config.SUPABASE_URL.replace(/\/$/, '')}/auth/v1`;
  const jwksUrl = new URL(`${issuer}/.well-known/jwks.json`);
  const jwks = createRemoteJWKSet(jwksUrl);

  return {
    async verify(token: string): Promise<AuthenticatedUser> {
      const { payload }: { payload: JWTPayload } = await jwtVerify(token, jwks, { issuer });
      const sub = payload.sub;
      if (typeof sub !== 'string' || sub === '') {
        throw new Error('token without sub');
      }
      const email = typeof payload.email === 'string' ? payload.email : null;
      return { id: sub, email };
    },
  };
}
