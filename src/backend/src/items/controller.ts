import { Hono } from 'hono';
import { prepare } from '../db/index.js';
import { NotFoundError, ValidationError } from '../middleware/errors.js';

interface ItemRow {
  id: number;
  category_id: number;
  name: string;
  color: string;
  difficulty_multiplier: number;
}

export const controller = new Hono();

// GET /api/items
controller.get('/', (c) => {
  const categoryId = c.req.query('category_id');
  const rows = categoryId
    ? (prepare('SELECT * FROM items WHERE category_id = ? ORDER BY id').all(Number(categoryId)) as ItemRow[])
    : (prepare('SELECT * FROM items ORDER BY id').all() as ItemRow[]);
  return c.json(rows);
});

// GET /api/items/:id/stats — must be before /:id to avoid shadowing
controller.get('/:id/stats', (c) => {
  const id = Number(c.req.param('id'));
  const item = prepare('SELECT id FROM items WHERE id = ?').get(id);
  if (!item) throw new NotFoundError(`Item ${id} not found`);

  const stats = prepare('SELECT * FROM stats WHERE item_id = ?').get(id);
  return c.json(
    stats ?? {
      item_id: id,
      total_wear_seconds: 0,
      session_count: 0,
      max_single_session_wear_seconds: 0,
    },
  );
});

// GET /api/items/:id/stats/history?unit=month|week
controller.get('/:id/stats/history', (c) => {
  const id = Number(c.req.param('id'));
  const item = prepare('SELECT id FROM items WHERE id = ?').get(id);
  if (!item) throw new NotFoundError(`Item ${id} not found`);

  const unit = c.req.query('unit') ?? 'month';
  if (unit !== 'month' && unit !== 'week') {
    throw new ValidationError('unit must be "month" or "week"');
  }

  const format = unit === 'month' ? '%Y-%m' : '%Y-%W';
  const rows = prepare(`
    SELECT strftime('${format}', datetime(ended_at, 'unixepoch')) AS period,
           SUM(calculated_wear_seconds) AS total_wear_seconds,
           COUNT(*) AS session_count
    FROM sessions
    WHERE item_id = ? AND ended_at IS NOT NULL
    GROUP BY period
    ORDER BY period ASC
  `).all(id);

  return c.json(rows);
});

// GET /api/items/:id
controller.get('/:id', (c) => {
  const id = Number(c.req.param('id'));
  const row = prepare('SELECT * FROM items WHERE id = ?').get(id) as ItemRow | undefined;
  if (!row) throw new NotFoundError(`Item ${id} not found`);
  return c.json(row);
});

// POST /api/items
controller.post('/', async (c) => {
  const body = await c.req.json();
  const { name, category_id, color, difficulty_multiplier } = body;

  if (!name || typeof name !== 'string') throw new ValidationError('name is required');
  if (typeof category_id !== 'number') throw new ValidationError('category_id must be a number');
  if (!color || typeof color !== 'string') throw new ValidationError('color is required');

  // Verify category exists
  const category = prepare('SELECT id FROM categories WHERE id = ?').get(category_id);
  if (!category) throw new ValidationError(`Category ${category_id} does not exist`);

  const resolvedDifficulty = typeof difficulty_multiplier === 'number' ? difficulty_multiplier : 1.0;

  const result = prepare(
    'INSERT INTO items (name, category_id, color, difficulty_multiplier) VALUES (?, ?, ?, ?)',
  ).run(name, category_id, color, resolvedDifficulty);

  const row = prepare('SELECT * FROM items WHERE id = ?').get(result.lastInsertRowid) as ItemRow;

  // Initialise cumulative stats row for this item
  prepare('INSERT OR IGNORE INTO stats (item_id) VALUES (?)').run(row.id);

  return c.json(row, 201);
});

// PATCH /api/items/:id
controller.patch('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const existing = prepare('SELECT * FROM items WHERE id = ?').get(id) as ItemRow | undefined;
  if (!existing) throw new NotFoundError(`Item ${id} not found`);

  const body = await c.req.json();
  const updates: Record<string, unknown> = {};

  if ('name' in body) {
    if (typeof body.name !== 'string') throw new ValidationError('name must be a string');
    updates.name = body.name;
  }
  if ('category_id' in body) {
    if (typeof body.category_id !== 'number') throw new ValidationError('category_id must be a number');
    const category = prepare('SELECT id FROM categories WHERE id = ?').get(body.category_id);
    if (!category) throw new ValidationError(`Category ${body.category_id} does not exist`);
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

  const setClauses = Object.keys(updates)
    .map((k) => `${k} = ?`)
    .join(', ');
  prepare(`UPDATE items SET ${setClauses} WHERE id = ?`).run(...Object.values(updates), id);

  const row = prepare('SELECT * FROM items WHERE id = ?').get(id) as ItemRow;
  return c.json(row);
});

// DELETE /api/items/:id
controller.delete('/:id', (c) => {
  const id = Number(c.req.param('id'));
  const existing = prepare('SELECT * FROM items WHERE id = ?').get(id) as ItemRow | undefined;
  if (!existing) throw new NotFoundError(`Item ${id} not found`);
  prepare('DELETE FROM items WHERE id = ?').run(id);
  return c.body(null, 204);
});
