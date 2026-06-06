/**
 * Errores normalizados de la capa de modelo. Mapea los errores especificos de cada SDK
 * (Anthropic / OpenAI / OpenAI-compatible) a un codigo comun. SEGURIDAD: solo se copian
 * escalares seguros (code, providerId, status, message). NUNCA se retiene el objeto de error
 * crudo del SDK, que podria contener headers con la credencial.
 */

export type ProviderErrorCode =
  | 'AUTHENTICATION'
  | 'RATE_LIMIT'
  | 'MODEL_NOT_FOUND'
  | 'INVALID_REQUEST'
  | 'TIMEOUT'
  | 'CANCELLED'
  | 'PROVIDER_UNAVAILABLE'
  | 'UNKNOWN';

const RETRYABLE_CODES: ReadonlySet<ProviderErrorCode> = new Set<ProviderErrorCode>([
  'RATE_LIMIT',
  'TIMEOUT',
  'PROVIDER_UNAVAILABLE',
]);

const DEFAULT_MESSAGES: Record<ProviderErrorCode, string> = {
  AUTHENTICATION: 'Authentication failed with the model provider',
  RATE_LIMIT: 'Rate limit exceeded at the model provider',
  MODEL_NOT_FOUND: 'The requested model was not found',
  INVALID_REQUEST: 'The request to the model provider was invalid',
  TIMEOUT: 'The model provider request timed out',
  CANCELLED: 'The model provider request was cancelled',
  PROVIDER_UNAVAILABLE: 'The model provider is temporarily unavailable',
  UNKNOWN: 'An unknown error occurred while calling the model provider',
};

export interface ProviderErrorParams {
  code: ProviderErrorCode;
  providerId: string;
  message: string;
  status?: number;
}

export class ProviderError extends Error {
  public readonly code: ProviderErrorCode;
  public readonly providerId: string;
  public readonly status: number | undefined;
  public readonly retryable: boolean;

  constructor(params: ProviderErrorParams) {
    super(params.message);
    this.name = 'ProviderError';
    this.code = params.code;
    this.providerId = params.providerId;
    this.status = params.status;
    this.retryable = RETRYABLE_CODES.has(params.code);
  }
}

function getStatus(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const value = (error as { status?: unknown }).status;
    if (typeof value === 'number') {
      return value;
    }
  }
  return undefined;
}

function getName(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'name' in error) {
    const value = (error as { name?: unknown }).name;
    if (typeof value === 'string') {
      return value;
    }
  }
  return '';
}

function getMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const value = (error as { message?: unknown }).message;
    if (typeof value === 'string' && value.trim() !== '') {
      return value;
    }
  }
  return '';
}

function classify(error: unknown): { code: ProviderErrorCode; status?: number } {
  const status = getStatus(error);
  const name = getName(error);

  if (name === 'APIUserAbortError' || name === 'AbortError') {
    return { code: 'CANCELLED' };
  }
  if (name === 'APIConnectionTimeoutError' || name === 'APITimeoutError' || name === 'TimeoutError') {
    return { code: 'TIMEOUT' };
  }
  if (name === 'APIConnectionError') {
    return { code: 'PROVIDER_UNAVAILABLE' };
  }

  if (status !== undefined) {
    if (status === 401 || status === 403) {
      return { code: 'AUTHENTICATION', status };
    }
    if (status === 404) {
      return { code: 'MODEL_NOT_FOUND', status };
    }
    if (status === 429) {
      return { code: 'RATE_LIMIT', status };
    }
    if (status === 400 || status === 422) {
      return { code: 'INVALID_REQUEST', status };
    }
    if (status >= 500 && status <= 599) {
      return { code: 'PROVIDER_UNAVAILABLE', status };
    }
    return { code: 'UNKNOWN', status };
  }

  return { code: 'UNKNOWN' };
}

/**
 * Normaliza cualquier error a ProviderError. Idempotente: si ya es ProviderError, lo devuelve.
 * Solo extrae message (texto de error del proveedor, sin la key) y status; descarta el resto.
 */
export function toProviderError(error: unknown, providerId: string): ProviderError {
  if (error instanceof ProviderError) {
    return error;
  }
  const { code, status } = classify(error);
  const providerMessage = getMessage(error);
  const message = providerMessage !== '' ? providerMessage : DEFAULT_MESSAGES[code];
  return new ProviderError({ code, providerId, message, status });
}
