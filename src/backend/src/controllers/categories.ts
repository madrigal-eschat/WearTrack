import { Hono } from 'hono';
import { categoryStore } from '../db/stores/category-store.js';
import { statsStore } from '../db/stores/stats-store.js';
import { NotFoundError } from '../middleware/errors.js';
import { CreateCategoryCommand, UpdateCategoryCommand } from '../commands/categories.js';

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
  const category = new CreateCategoryCommand(body).run();
  return c.json(category, 201);
});

// PATCH /api/categories/:id
router.patch('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const existing = categoryStore.find(id);
  if (!existing) throw new NotFoundError(`Category ${id} not found`);

  const body = await c.req.json();
  const category = new UpdateCategoryCommand(existing, body).run();
  return c.json(category);
});

// DELETE /api/categories/:id
router.delete('/:id', (c) => {
  const id = Number(c.req.param('id'));
  const existing = categoryStore.find(id);
  if (!existing) throw new NotFoundError(`Category ${id} not found`);
  categoryStore.delete(id);
  return c.body(null, 204);
});
