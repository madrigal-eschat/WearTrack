import { Hono } from 'hono';
import { itemStore } from '../db/stores/item-store.js';
import { categoryStore } from '../db/stores/category-store.js';
import { statsStore } from '../db/stores/stats-store.js';
import { NotFoundError, ValidationError } from '../middleware/errors.js';

export const router = new Hono();

// GET /api/items
router.get('/', (c) => {
  const categoryId = c.req.query('category_id');
  return c.json(itemStore.findAll(categoryId !== undefined ? Number(categoryId) : undefined));
});

// GET /api/items/:id/stats/history — must be before /:id/stats and /:id to avoid shadowing
router.get('/:id/stats/history', (c) => {
  const id = Number(c.req.param('id'));
  if (!itemStore.find(id)) throw new NotFoundError(`Item ${id} not found`);

  const unit = c.req.query('unit') ?? 'month';
  if (unit !== 'month' && unit !== 'week') {
    throw new ValidationError('unit must be "month" or "week"');
  }

  return c.json(statsStore.history(id, unit));
});

// GET /api/items/:id/stats — must be before /:id to avoid shadowing
router.get('/:id/stats', (c) => {
  const id = Number(c.req.param('id'));
  if (!itemStore.find(id)) throw new NotFoundError(`Item ${id} not found`);

  const stats = statsStore.findForItem(id);
  return c.json(
    stats ?? {
      item_id: id,
      total_wear_seconds: 0,
      session_count: 0,
      max_single_session_wear_seconds: 0,
    },
  );
});

// GET /api/items/:id
router.get('/:id', (c) => {
  const id = Number(c.req.param('id'));
  const item = itemStore.find(id);
  if (!item) throw new NotFoundError(`Item ${id} not found`);
  return c.json(item);
});

// POST /api/items
router.post('/', async (c) => {
  const body = await c.req.json();
  const { name, category_id, color, difficulty_multiplier } = body;

  if (!name || typeof name !== 'string') throw new ValidationError('name is required');
  if (typeof category_id !== 'number') throw new ValidationError('category_id must be a number');
  if (!color || typeof color !== 'string') throw new ValidationError('color is required');

  if (!categoryStore.find(category_id)) {
    throw new ValidationError(`Category ${category_id} does not exist`);
  }

  // itemStore.create() also initialises the stats row for this item
  const item = itemStore.create({
    name,
    category_id,
    color,
    difficulty_multiplier: typeof difficulty_multiplier === 'number' ? difficulty_multiplier : undefined,
  });

  return c.json(item, 201);
});

// PATCH /api/items/:id
router.patch('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const existing = itemStore.find(id);
  if (!existing) throw new NotFoundError(`Item ${id} not found`);

  const body = await c.req.json();
  const updates: Parameters<typeof itemStore.update>[1] = {};

  if ('name' in body) {
    if (typeof body.name !== 'string') throw new ValidationError('name must be a string');
    updates.name = body.name;
  }
  if ('category_id' in body) {
    if (typeof body.category_id !== 'number') throw new ValidationError('category_id must be a number');
    if (!categoryStore.find(body.category_id)) {
      throw new ValidationError(`Category ${body.category_id} does not exist`);
    }
    updates.category_id = body.category_id;
  }
  if ('color' in body) {
    if (typeof body.color !== 'string') throw new ValidationError('color must be a string');
    updates.color = body.color;
  }
  if ('difficulty_multiplier' in body) {
    if (typeof body.difficulty_multiplier !== 'number') throw new ValidationError('difficulty_multiplier must be a number');
    updates.difficulty_multiplier = body.difficulty_multiplier;
  }

  if (Object.keys(updates).length === 0) {
    return c.json(existing);
  }

  return c.json(itemStore.update(id, updates));
});

// DELETE /api/items/:id
router.delete('/:id', (c) => {
  const id = Number(c.req.param('id'));
  const existing = itemStore.find(id);
  if (!existing) throw new NotFoundError(`Item ${id} not found`);
  itemStore.delete(id);
  return c.body(null, 204);
});
