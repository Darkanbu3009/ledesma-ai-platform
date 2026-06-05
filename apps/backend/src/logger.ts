export const loggerRedaction = {
  paths: [
    'req.headers.authorization',
    'req.headers["x-api-key"]',
    'req.headers.cookie',
    'res.headers["set-cookie"]',
    'req.body.apiKey',
    'req.body.api_key',
    'req.body.key',
    'apiKey',
    'api_key',
  ],
  censor: '[REDACTED]',
};
