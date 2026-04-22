import { Hono } from 'hono';
import { prepare } from '../db/index.js';
import { NotFoundError, ValidationError } from '../middleware/errors.js';
import type { RiskLevel } from '../db/calculations.js';

interface CategoryRow {
  id: number;
  name: string;
  icon: string;
  initial_wear: number;
  rest_multiplier: number;
  rest_constant: number;
  risk_levels: string;
  break_decay_multiplier: number;
  break_penalty_period: number;
}

function serializeCategory(row: CategoryRow) {
  return {
    ...row,
    risk_levels: JSON.parse(row.risk_levels) as RiskLevel[],
  };
}

function validateRiskLevels(levels: unknown): levels is RiskLevel[] {
  if (!Array.isArray(levels)) return false;
  return levels.every(
    (l) =>
      typeof l === 'object' &&
      l !== null &&
      (l.lower === null || typeof l.lower === 'number') &&
      (l.upper === null || typeof l.upper === 'number') &&
      typeof l.text === 'string' &&
      typeof l.severity === 'number',
  );
}

export const controller = new Hono();

// GET /api/categories
controller.get('/', (c) => {
  const rows = prepare('SELECT * FROM categories ORDER BY id').all() as CategoryRow[];
  return c.json(rows.map(serializeCategory));
});

// GET /api/categories/:id
controller.get('/:id', (c) => {
  const id = Number(c.req.param('id'));
  const row = prepare('SELECT * FROM categories WHERE id = ?').get(id) as CategoryRow | undefined;
  if (!row) throw new NotFoundError(`Category ${id} not found`);
  return c.json(serializeCategory(row));
});

// POST /api/categories
controller.post('/', async (c) => {
  const body = await c.req.json();
  const {
    name,
    icon,
    initial_wear,
    rest_multiplier,
    rest_constant,
    risk_levels,
    break_decay_multiplier,
    break_penalty_period,
  } = body;

  if (!name || typeof name !== 'string') throw new ValidationError('name is required');
  if (!icon || typeof icon !== 'string') throw new ValidationError('icon is required');
  if (typeof initial_wear !== 'number') throw new ValidationError('initial_wear must be a number');
  if (typeof rest_multiplier !== 'number') throw new ValidationError('rest_multiplier must be a number');
  if (typeof rest_constant !== 'number') throw new ValidationError('rest_constant must be a number');
  if (!validateRiskLevels(risk_levels)) throw new ValidationError('risk_levels must be an array of valid risk level objects');
  if (typeof break_decay_multiplier !== 'number') throw new ValidationError('break_decay_multiplier must be a number');
  if (typeof break_penalty_period !== 'number') throw new ValidationError('break_penalty_period must be a number');

  const result = prepare(
    `INSERT INTO categories (name, icon, initial_wear, rest_multiplier, rest_constant, risk_levels, break_decay_multiplier, break_penalty_period)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(name, icon, initial_wear, rest_multiplier, rest_constant, JSON.stringify(risk_levels), break_decay_multiplier, break_penalty_period);

  const row = prepare('SELECT * FROM categories WHERE id = ?').get(result.lastInsertRowid) as CategoryRow;
  return c.json(serializeCategory(row), 201);
});

// PATCH /api/categories/:id
controller.patch('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const existing = prepare('SELECT * FROM categories WHERE id = ?').get(id) as CategoryRow | undefined;
  if (!existing) throw new NotFoundError(`Category ${id} not found`);

  const body = await c.req.json();
  const updates: Record<string, unknown> = {};

  if ('name' in body) {
    if (typeof body.name !== 'string') throw new ValidationError('name must be a string');
    updates.name = body.name;
  }
  if ('icon' in body) {
    if (typeof body.icon !== 'string') throw new ValidationError('icon must be a string');
    updates.icon = body.icon;
  }
  if ('initial_wear' in body) {
    if (typeof body.initial_wear !== 'number') throw new ValidationError('initial_wear must be a number');
    updates.initial_wear = body.initial_wear;
  }
  if ('rest_multiplier' in body) {
    if (typeof body.rest_multiplier !== 'number') throw new ValidationError('rest_multiplier must be a number');
    updates.rest_multiplier = body.rest_multiplier;
  }
  if ('rest_constant' in body) {
    if (typeof body.rest_constant !== 'number') throw new ValidationError('rest_constant must be a number');
    updates.rest_constant = body.rest_constant;
  }
  if ('risk_levels' in body) {
    if (!validateRiskLevels(body.risk_levels)) throw new ValidationError('risk_levels must be an array of valid risk level objects');
    updates.risk_levels = JSON.stringify(body.risk_levels);
  }
  if ('break_decay_multiplier' in body) {
    if (typeof body.break_decay_multiplier !== 'number') throw new ValidationError('break_decay_multiplier must be a number');
    updates.break_decay_multiplier = body.break_decay_multiplier;
  }
  if ('break_penalty_period' in body) {
    if (typeof body.break_penalty_period !== 'number') throw new ValidationError('break_penalty_period must be a number');
    updates.break_penalty_period = body.break_penalty_period;
  }

  if (Object.keys(updates).length === 0) {
    return c.json(serializeCategory(existing));
  }

  const setClauses = Object.keys(updates)
    .map((k) => `${k} = ?`)
    .join(', ');
  prepare(`UPDATE categories SET ${setClauses} WHERE id = ?`).run(...Object.values(updates), id);

  const row = prepare('SELECT * FROM categories WHERE id = ?').get(id) as CategoryRow;
  return c.json(serializeCategory(row));
});

// DELETE /api/categories/:id
controller.delete('/:id', (c) => {
  const id = Number(c.req.param('id'));
  const existing = prepare('SELECT * FROM categories WHERE id = ?').get(id) as CategoryRow | undefined;
  if (!existing) throw new NotFoundError(`Category ${id} not found`);
  prepare('DELETE FROM categories WHERE id = ?').run(id);
  return c.body(null, 204);
});
