import { Hono } from 'hono';
import { categoryStore } from '../db/stores/category-store.js';
import { statsStore } from '../db/stores/stats-store.js';
import { NotFoundError, ValidationError } from '../middleware/errors.js';
import type { RiskLevel } from '../db/calculations.js';

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

export const router = new Hono();

// GET /api/categories
router.get('/', (c) => {
  return c.json(categoryStore.findAll());
});

// GET /api/categories/:id/stats — must be before /:id to avoid shadowing
router.get('/:id/stats', (c) => {
  const id = Number(c.req.param('id'));
  if (!categoryStore.find(id)) throw new NotFoundError(`Category ${id} not found`);

  const stats = statsStore.findForCategory(id);
  return c.json(
    stats ?? {
      category_id: id,
      total_wear_seconds: 0,
      session_count: 0,
      max_single_session_wear_seconds: 0,
      streak_wear_seconds: 0,
      streak_count: 0,
      best_streak_wear_seconds: 0,
      best_streak_count: 0,
      item_count: 0,
    },
  );
});

// GET /api/categories/:id
router.get('/:id', (c) => {
  const id = Number(c.req.param('id'));
  const category = categoryStore.find(id);
  if (!category) throw new NotFoundError(`Category ${id} not found`);
  return c.json(category);
});

// POST /api/categories
router.post('/', async (c) => {
  const body = await c.req.json();
  const {
    name,
    icon,
    initial_wear_duration_seconds,
    rest_multiplier,
    rest_constant_seconds,
    risk_levels,
    break_decay_multiplier,
    break_starts_after_seconds,
  } = body;

  if (!name || typeof name !== 'string') throw new ValidationError('name is required');
  if (!icon || typeof icon !== 'string') throw new ValidationError('icon is required');
  if (typeof initial_wear_duration_seconds !== 'number') throw new ValidationError('initial_wear_duration_seconds must be a number');
  if (typeof rest_multiplier !== 'number') throw new ValidationError('rest_multiplier must be a number');
  if (typeof rest_constant_seconds !== 'number') throw new ValidationError('rest_constant_seconds must be a number');
  if (!validateRiskLevels(risk_levels)) throw new ValidationError('risk_levels must be an array of valid risk level objects');
  if (typeof break_decay_multiplier !== 'number') throw new ValidationError('break_decay_multiplier must be a number');
  if (typeof break_starts_after_seconds !== 'number') throw new ValidationError('break_starts_after_seconds must be a number');

  // categoryStore.create() also initialises the category_stats row
  const category = categoryStore.create({
    name,
    icon,
    initial_wear_duration_seconds,
    rest_multiplier,
    rest_constant_seconds,
    risk_levels,
    break_decay_multiplier,
    break_starts_after_seconds,
  });

  return c.json(category, 201);
});

// PATCH /api/categories/:id
router.patch('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const existing = categoryStore.find(id);
  if (!existing) throw new NotFoundError(`Category ${id} not found`);

  const body = await c.req.json();
  const updates: Parameters<typeof categoryStore.update>[1] = {};

  if ('name' in body) {
    if (typeof body.name !== 'string') throw new ValidationError('name must be a string');
    updates.name = body.name;
  }
  if ('icon' in body) {
    if (typeof body.icon !== 'string') throw new ValidationError('icon must be a string');
    updates.icon = body.icon;
  }
  if ('initial_wear_duration_seconds' in body) {
    if (typeof body.initial_wear_duration_seconds !== 'number') throw new ValidationError('initial_wear_duration_seconds must be a number');
    updates.initial_wear_duration_seconds = body.initial_wear_duration_seconds;
  }
  if ('rest_multiplier' in body) {
    if (typeof body.rest_multiplier !== 'number') throw new ValidationError('rest_multiplier must be a number');
    updates.rest_multiplier = body.rest_multiplier;
  }
  if ('rest_constant_seconds' in body) {
    if (typeof body.rest_constant_seconds !== 'number') throw new ValidationError('rest_constant_seconds must be a number');
    updates.rest_constant_seconds = body.rest_constant_seconds;
  }
  if ('risk_levels' in body) {
    if (!validateRiskLevels(body.risk_levels)) throw new ValidationError('risk_levels must be an array of valid risk level objects');
    updates.risk_levels = body.risk_levels;
  }
  if ('break_decay_multiplier' in body) {
    if (typeof body.break_decay_multiplier !== 'number') throw new ValidationError('break_decay_multiplier must be a number');
    updates.break_decay_multiplier = body.break_decay_multiplier;
  }
  if ('break_starts_after_seconds' in body) {
    if (typeof body.break_starts_after_seconds !== 'number') throw new ValidationError('break_starts_after_seconds must be a number');
    updates.break_starts_after_seconds = body.break_starts_after_seconds;
  }

  if (Object.keys(updates).length === 0) {
    return c.json(existing);
  }

  return c.json(categoryStore.update(id, updates));
});

// DELETE /api/categories/:id
router.delete('/:id', (c) => {
  const id = Number(c.req.param('id'));
  const existing = categoryStore.find(id);
  if (!existing) throw new NotFoundError(`Category ${id} not found`);
  categoryStore.delete(id);
  return c.body(null, 204);
});
