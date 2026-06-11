export const loggerRedaction = {
  paths: [
    'req.headers.authorization',
    'req.headers["x-api-key"]',
    'req.headers["x-provider-key"]',
    'req.headers["x-provider-base-url"]',
    'req.headers["x-admin-token"]',
    'req.headers["x-session-token"]',
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
    'apiKey',
    'api_key',
  ],
  censor: '[REDACTED]',
};
