export type ErrorCode =
  | 'INTERNAL_ERROR'
  | 'NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'RATE_LIMIT_EXCEEDED'
  | 'UNAUTHORIZED'
  | 'AUTHENTICATION'
  // Una dependencia opcional de la plataforma no esta configurada (p.ej. el modelo de plataforma
  // del Configurador). Se mapea a 503: la peticion es valida pero la feature no esta disponible.
  | 'SERVICE_UNAVAILABLE';

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly details?: unknown;

  constructor(code: ErrorCode, statusCode: number, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}
