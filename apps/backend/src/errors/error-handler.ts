import type { FastifyError, FastifyInstance } from 'fastify';
import { AppError } from './app-error.js';
import type { Env } from '../config/env.js';

export function registerErrorHandler(app: FastifyInstance, config: Env): void {
  app.setNotFoundHandler((req, reply) => {
    reply.status(404).send({
      error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.url} not found` },
      requestId: req.id,
    });
  });

  app.setErrorHandler((error: FastifyError, req, reply) => {
    if (error.validation) {
      reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: error.message,
          details: error.validation,
        },
        requestId: req.id,
      });
      return;
    }

    if (error instanceof AppError) {
      reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          ...(error.details !== undefined ? { details: error.details } : {}),
        },
        requestId: req.id,
      });
      return;
    }

    req.log.error(error);
    reply.status(500).send({
      error: {
        code: 'INTERNAL_ERROR',
        message: config.NODE_ENV === 'production' ? 'Internal server error' : error.message,
      },
      requestId: req.id,
    });
  });
}
