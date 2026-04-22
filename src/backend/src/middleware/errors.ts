import type { MiddlewareHandler } from 'hono';

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export const errorHandler = (): MiddlewareHandler => {
  return async (c, next) => {
    await next();
    if (c.error) {
      if (c.error instanceof NotFoundError) {
        return c.json({ error: 'Not found' }, 404);
      }
      if (c.error instanceof ConflictError) {
        return c.json({ error: 'Conflict' }, 409);
      }
      if (c.error instanceof ValidationError) {
        return c.json({ error: c.error.message }, 400);
      }
    }
  };
};
