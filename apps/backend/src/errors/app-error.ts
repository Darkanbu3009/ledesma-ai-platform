export type ErrorCode =
  | 'INTERNAL_ERROR'
  | 'NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'RATE_LIMIT_EXCEEDED'
  | 'UNAUTHORIZED'
  | 'CONFLICT'
  | 'FORBIDDEN'
  | 'AUTHENTICATION'
  // POST /v1/sitios/conectar sin pais en el body ni declarado en el perfil: la consola mapea este
  // codigo a un mensaje traducido (ES/EN) que manda al usuario a declarar su pais.
  | 'PAIS_REQUERIDO'
  // POST /v1/sitios/:id/relay-token cuando el relay de teclado movil no esta configurado
  // (faltan RELAY_TOKEN_SECRET / RELAY_PUBLIC_URL): la consola cae al aviso de "hazlo desde una
  // computadora" en tactil. El desktop nunca invoca este endpoint.
  | 'RELAY_NO_DISPONIBLE';

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
