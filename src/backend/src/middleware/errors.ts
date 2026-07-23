import type { ErrorHandler } from 'hono';

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends Error {
  readonly details?: Record<string, unknown>;
  constructor(message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'ConflictError';
    this.details = details;
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * Registered via app.onError() so Hono routes it through the compose
 * error path, which correctly overrides the default 500 response.
 */
export const errorHandler = (): ErrorHandler => {
  return (e, c) => {
    if (e instanceof NotFoundError) {
      return c.json({ error: 'Not found' }, 404);
    }
    if (e instanceof ConflictError) {
      return c.json({ error: e.message, ...(e.details ?? {}) }, 409);
    }
    if (e instanceof ValidationError) {
      return c.json({ error: e.message }, 400);
    }
    console.error('Unhandled error:', e);
    return c.json({ error: 'Internal server error' }, 500);
  };
};
