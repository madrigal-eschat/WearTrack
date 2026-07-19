import { Hono } from 'hono';
import { injuryStore } from '../db/stores/injury-store.js';
import { itemStore } from '../db/stores/item-store.js';
import { categoryStore } from '../db/stores/category-store.js';
import { sessionStore } from '../db/stores/session-store.js';
import { riskLevelFor } from '../db/calculations.js';
import { NotFoundError, ValidationError } from '../middleware/errors.js';
import { nowSeconds } from '../utils/time.js';

export const router = new Hono();

// GET /api/injuries?item_id=
router.get('/', (c) => {
  const itemId = c.req.query('item_id');
  return c.json(injuryStore.findAll(itemId !== undefined ? Number(itemId) : undefined));
});

// GET /api/injuries/:id
router.get('/:id', (c) => {
  const id = Number(c.req.param('id'));
  const injury = injuryStore.find(id);
  if (!injury) throw new NotFoundError(`Injury ${id} not found`);
  return c.json(injury);
});

// POST /api/injuries — record a new injury for an item
// Severity is derived from the item's current wear and category risk levels.
// The request may optionally supply a wear_seconds override (e.g. from a just-ended session);
// if omitted we use the latest session's calculated_wear.
router.post('/', async (c) => {
  const body = await c.req.json();
  const { item_id, wear_seconds } = body;

  if (typeof item_id !== 'number') throw new ValidationError('item_id must be a number');

  const item = itemStore.find(item_id);
  if (!item) throw new NotFoundError(`Item ${item_id} not found`);

  if (injuryStore.hasActive(item_id)) {
    throw new ValidationError(`Item ${item_id} already has an active injury`);
  }

  // Resolve wear to derive severity
  const wearSeconds: number =
    typeof wear_seconds === 'number' ? wear_seconds : injuryStore.lastSessionWear(item_id);

  const category = categoryStore.findRaw(item.category_id)!;
  if (category.type === 'rotation') {
    throw new ValidationError('Injuries are not supported for rotation categories');
  }
  const riskLevel = riskLevelFor(wearSeconds, category);
  const severity = riskLevel?.severity ?? 1;

  const injury = injuryStore.record(item_id, severity);

  // End any open session for this item — wearing while injured isn't tracked
  const openSession = sessionStore.findOpenForItem(item_id);
  if (openSession) {
    sessionStore.endWithInjury(openSession.id, nowSeconds());
  }

  return c.json(injury, 201);
});

// POST /api/injuries/:id/heal — mark an injury as healed
router.post('/:id/heal', (c) => {
  const id = Number(c.req.param('id'));
  const injury = injuryStore.find(id);
  if (!injury) throw new NotFoundError(`Injury ${id} not found`);
  if (injury.healed_at !== null) throw new ValidationError(`Injury ${id} is already healed`);

  injuryStore.heal(injury.item_id);

  return c.json(injuryStore.find(id)!);
});
