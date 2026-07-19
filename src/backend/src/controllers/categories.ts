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

function validateType(type: unknown): type is 'duration' | 'rotation' {
  return type === 'duration' || type === 'rotation';
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
    initial_target_wear_duration_seconds,
    initial_max_wear_duration_seconds,
    rest_multiplier,
    minimum_rest,
    risk_levels,
    break_decay_multiplier,
    break_grace_time,
    type,
    consecutive_wear_days,
  } = body;

  if (!name || typeof name !== 'string') throw new ValidationError('name is required');
  if (!icon || typeof icon !== 'string') throw new ValidationError('icon is required');
  if (typeof initial_target_wear_duration_seconds !== 'number') throw new ValidationError('initial_target_wear_duration_seconds must be a number');
  if (initial_max_wear_duration_seconds !== null && typeof initial_max_wear_duration_seconds !== 'number') throw new ValidationError('initial_max_wear_duration_seconds must be a number or null');
  if (typeof rest_multiplier !== 'number') throw new ValidationError('rest_multiplier must be a number');
  if (typeof minimum_rest !== 'number') throw new ValidationError('minimum_rest must be a number');
  if (!validateRiskLevels(risk_levels)) throw new ValidationError('risk_levels must be an array of valid risk level objects');
  if (typeof break_decay_multiplier !== 'number') throw new ValidationError('break_decay_multiplier must be a number');
  if (typeof break_grace_time !== 'number') throw new ValidationError('break_grace_time must be a number');
  if (type !== undefined && !validateType(type)) throw new ValidationError("type must be 'duration' or 'rotation'");
  if (consecutive_wear_days !== undefined && (typeof consecutive_wear_days !== 'number' || consecutive_wear_days < 1)) {
    throw new ValidationError('consecutive_wear_days must be a positive number');
  }

  // categoryStore.create() also initialises the category_stats row
  const category = categoryStore.create({
    name,
    icon,
    initial_target_wear_duration_seconds,
    initial_max_wear_duration_seconds,
    rest_multiplier,
    minimum_rest,
    risk_levels,
    break_decay_multiplier,
    break_grace_time,
    type,
    consecutive_wear_days,
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
  if ('initial_target_wear_duration_seconds' in body) {
    if (typeof body.initial_target_wear_duration_seconds !== 'number') throw new ValidationError('initial_target_wear_duration_seconds must be a number');
    updates.initial_target_wear_duration_seconds = body.initial_target_wear_duration_seconds;
  }
  if ('initial_max_wear_duration_seconds' in body) {
    if (body.initial_max_wear_duration_seconds !== null && typeof body.initial_max_wear_duration_seconds !== 'number') throw new ValidationError('initial_max_wear_duration_seconds must be a number or null');
    updates.initial_max_wear_duration_seconds = body.initial_max_wear_duration_seconds;
  }
  if ('rest_multiplier' in body) {
    if (typeof body.rest_multiplier !== 'number') throw new ValidationError('rest_multiplier must be a number');
    updates.rest_multiplier = body.rest_multiplier;
  }
  if ('minimum_rest' in body) {
    if (typeof body.minimum_rest !== 'number') throw new ValidationError('minimum_rest must be a number');
    updates.minimum_rest = body.minimum_rest;
  }
  if ('risk_levels' in body) {
    if (!validateRiskLevels(body.risk_levels)) throw new ValidationError('risk_levels must be an array of valid risk level objects');
    updates.risk_levels = body.risk_levels;
  }
  if ('break_decay_multiplier' in body) {
    if (typeof body.break_decay_multiplier !== 'number') throw new ValidationError('break_decay_multiplier must be a number');
    updates.break_decay_multiplier = body.break_decay_multiplier;
  }
  if ('break_grace_time' in body) {
    if (typeof body.break_grace_time !== 'number') throw new ValidationError('break_grace_time must be a number');
    updates.break_grace_time = body.break_grace_time;
  }
  if ('type' in body) {
    if (!validateType(body.type)) throw new ValidationError("type must be 'duration' or 'rotation'");
    updates.type = body.type;
  }
  if ('consecutive_wear_days' in body) {
    if (typeof body.consecutive_wear_days !== 'number' || body.consecutive_wear_days < 1) {
      throw new ValidationError('consecutive_wear_days must be a positive number');
    }
    updates.consecutive_wear_days = body.consecutive_wear_days;
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
