export const loggerRedaction = {
  paths: [
    'req.headers.authorization',
    'req.headers["x-api-key"]',
    'req.headers["x-provider-key"]',
    'req.headers["x-provider-base-url"]',
    'req.headers["x-admin-token"]',
    'req.headers["x-session-token"]',
    // Token de un trigger 'url_token' (Fase 5.4): credencial del webhook entrante; jamas en logs.
    'req.headers["x-trigger-token"]',
    'req.headers.cookie',
    'res.headers["set-cookie"]',
    'req.body.apiKey',
    'req.body.api_key',
    'req.body.key',
    // Variantes de primer nivel: cubren logs manuales que adjuntan headers sin envolver en req.
    'headers.authorization',
    'headers["x-provider-key"]',
    'headers["x-admin-token"]',
    'headers["x-session-token"]',
    'headers["x-trigger-token"]',
    'apiKey',
    'api_key',
  ],
  censor: '[REDACTED]',
};

/**
 * Redacta el query param `token` de una URL antes de loggearla. El webhook entrante de un trigger
 * 'url_token' (Fase 5.4) recibe su credencial en la URL (?token=...); el serializer de request de pino
 * loggea req.url, asi que sin esto el token viajaria a los logs. Otros params se preservan. Sin token en
 * la query -> se devuelve la URL tal cual (sin costo de re-serializar).
 */
export function sanitizeLoggedUrl(url: string): string {
  // Defensivo: logs manuales pueden pasar un req sin url (no string); se devuelve tal cual.
  if (typeof url !== 'string') return url;
  const qIndex = url.indexOf('?');
  if (qIndex === -1) return url;
  const query = url.slice(qIndex + 1);
  if (!query.includes('token=')) return url;
  const params = new URLSearchParams(query);
  if (!params.has('token')) return url;
  params.set('token', '[REDACTED]');
  return `${url.slice(0, qIndex)}?${params.toString()}`;
}

interface LoggableRequest {
  method: string;
  url: string;
  hostname?: string;
  ip?: string;
  socket?: { remotePort?: number };
}

/**
 * Serializers de pino para el logger de Fastify. `req` REEMPLAZA al serializer por defecto de Fastify
 * (mismos campos: method/url/hostname/remoteAddress/remotePort) pero pasando la url por
 * sanitizeLoggedUrl, para no filtrar el token del webhook entrante. Se mantiene el resto identico para
 * no cambiar el formato de los logs existentes.
 */
export const loggerSerializers = {
  req(request: LoggableRequest) {
    return {
      method: request.method,
      url: sanitizeLoggedUrl(request.url),
      hostname: request.hostname,
      remoteAddress: request.ip,
      remotePort: request.socket?.remotePort,
    };
  },
};
