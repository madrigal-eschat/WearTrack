import { Hono } from 'hono';
import { prepare } from '../db/index.js';
import { hasActiveInjury, recordInjury, healInjury } from '../db/injury.js';
import { getRiskLevel, type Category } from '../db/calculations.js';
import { NotFoundError, ValidationError } from '../middleware/errors.js';

interface InjuryRow {
  id: number;
  item_id: number;
  occurred_at: number;
  heals_at: number | null;
  severity: number;
}

function getItem(itemId: number) {
  return prepare('SELECT * FROM items WHERE id = ?').get(itemId) as { id: number; category_id: number } | undefined;
}

function getCategory(categoryId: number): Category {
  return prepare('SELECT * FROM categories WHERE id = ?').get(categoryId) as Category;
}

export const controller = new Hono();

// GET /api/injuries?item_id=
controller.get('/', (c) => {
  const itemId = c.req.query('item_id');
  const rows = itemId
    ? (prepare('SELECT * FROM injuries WHERE item_id = ? ORDER BY occurred_at DESC').all(Number(itemId)) as InjuryRow[])
    : (prepare('SELECT * FROM injuries ORDER BY occurred_at DESC').all() as InjuryRow[]);
  return c.json(rows);
});

// GET /api/injuries/:id
controller.get('/:id', (c) => {
  const id = Number(c.req.param('id'));
  const row = prepare('SELECT * FROM injuries WHERE id = ?').get(id) as InjuryRow | undefined;
  if (!row) throw new NotFoundError(`Injury ${id} not found`);
  return c.json(row);
});

// POST /api/injuries — record a new injury for an item
// Severity is derived from the item's current wear and category risk levels.
// The request may optionally supply a wear_seconds override (e.g. from a just-ended session);
// if omitted we use the latest session's calculated_wear.
controller.post('/', async (c) => {
  const body = await c.req.json();
  const { item_id, wear_seconds } = body;

  if (typeof item_id !== 'number') throw new ValidationError('item_id must be a number');

  const item = getItem(item_id);
  if (!item) throw new NotFoundError(`Item ${item_id} not found`);

  if (hasActiveInjury(item_id)) {
    throw new ValidationError(`Item ${item_id} already has an active injury`);
  }

  // Resolve wear to derive severity
  let wearSeconds: number;
  if (typeof wear_seconds === 'number') {
    wearSeconds = wear_seconds;
  } else {
    const lastSession = prepare(
      'SELECT calculated_wear FROM sessions WHERE item_id = ? AND ended_at IS NOT NULL ORDER BY ended_at DESC LIMIT 1',
    ).get(item_id) as { calculated_wear: number } | undefined;
    wearSeconds = lastSession?.calculated_wear ?? 0;
  }

  const category = getCategory(item.category_id);
  const riskLevel = getRiskLevel(wearSeconds, category);
  const severity = riskLevel?.severity ?? 1;

  const injury = recordInjury(item_id, severity);

  // End any open session for this item — wearing while injured isn't tracked
  const openSession = prepare(
    'SELECT id FROM sessions WHERE item_id = ? AND ended_at IS NULL',
  ).get(item_id) as { id: number } | undefined;
  if (openSession) {
    const now = Math.floor(Date.now() / 1000);
    prepare('UPDATE sessions SET ended_at = ?, injury = 1 WHERE id = ?').run(now, openSession.id);
  }

  return c.json(injury, 201);
});

// POST /api/injuries/:id/heal — mark an injury as healed
controller.post('/:id/heal', (c) => {
  const id = Number(c.req.param('id'));
  const injury = prepare('SELECT * FROM injuries WHERE id = ?').get(id) as InjuryRow | undefined;
  if (!injury) throw new NotFoundError(`Injury ${id} not found`);
  if (injury.heals_at !== null) throw new ValidationError(`Injury ${id} is already healed`);

  healInjury(injury.item_id);

  const updated = prepare('SELECT * FROM injuries WHERE id = ?').get(id) as InjuryRow;
  return c.json(updated);
});
