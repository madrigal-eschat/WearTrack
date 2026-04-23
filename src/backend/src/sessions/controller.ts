import { Hono } from 'hono';
import { sessionStore } from '../db/stores/session-store.js';
import { itemStore } from '../db/stores/item-store.js';
import { categoryStore } from '../db/stores/category-store.js';
import { NotFoundError, ValidationError, ConflictError } from '../middleware/errors.js';

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export const controller = new Hono();

// GET /api/sessions?item_id=
controller.get('/', (c) => {
  const itemId = c.req.query('item_id');
  return c.json(sessionStore.findAll(itemId !== undefined ? Number(itemId) : undefined));
});

// GET /api/sessions/current — one entry per category with active session or nulls
controller.get('/current', (c) => {
  const categories = categoryStore.findAll();
  const openSessions = sessionStore.findOpenWithItemData();

  const sessionByCategory = new Map(openSessions.map((s) => [s.category_id, s]));

  return c.json(
    categories.map((cat) => {
      const s = sessionByCategory.get(cat.id);
      if (!s) {
        return { category: cat, item: null, session: null };
      }
      const item = {
        id: s.item_id,
        category_id: s.category_id,
        name: s.item_name,
        color: s.item_color,
        difficulty_multiplier: s.item_difficulty_multiplier,
      };
      const session = {
        id: s.id,
        item_id: s.item_id,
        started_at: s.started_at,
        ended_at: s.ended_at,
        calculated_wear_seconds: s.calculated_wear_seconds,
        calculated_rest_seconds: s.calculated_rest_seconds,
        ended_in_injury: s.ended_in_injury,
      };
      return { category: cat, item, session };
    }),
  );
});

// GET /api/sessions/:id
controller.get('/:id', (c) => {
  const id = Number(c.req.param('id'));
  const session = sessionStore.find(id);
  if (!session) throw new NotFoundError(`Session ${id} not found`);
  return c.json(session);
});

// POST /api/sessions/start — begin a new session for an item
controller.post('/start', async (c) => {
  const body = await c.req.json();
  const { item_id, started_at } = body;

  if (typeof item_id !== 'number') throw new ValidationError('item_id must be a number');
  if (started_at !== undefined && typeof started_at !== 'number') {
    throw new ValidationError('started_at must be a Unix timestamp (number)');
  }

  const item = itemStore.find(item_id);
  if (!item) throw new NotFoundError(`Item ${item_id} not found`);

  const conflict = sessionStore.findOpenInCategory(item.category_id);
  if (conflict) {
    throw new ConflictError(
      `Category already has an open session on item "${conflict.item_name}" (id ${conflict.item_id})`,
      { conflicting_item: { id: conflict.item_id, name: conflict.item_name } },
    );
  }

  const category = categoryStore.findRaw(item.category_id)!;
  const startTs = typeof started_at === 'number' ? started_at : nowSeconds();
  const session = sessionStore.start(item_id, category, startTs);
  return c.json(session, 201);
});

// POST /api/sessions/:id/end — finish a session and compute wear/rest
controller.post('/:id/end', async (c) => {
  const id = Number(c.req.param('id'));
  const session = sessionStore.find(id);
  if (!session) throw new NotFoundError(`Session ${id} not found`);
  if (session.ended_at !== null) throw new ValidationError(`Session ${id} is already ended`);

  const body = await c.req.json().catch(() => ({})) as { ended_at?: number };
  if (body.ended_at !== undefined && typeof body.ended_at !== 'number') {
    throw new ValidationError('ended_at must be a Unix timestamp (number)');
  }

  const item = itemStore.find(session.item_id);
  if (!item) throw new NotFoundError(`Item ${session.item_id} not found`);

  const category = categoryStore.findRaw(item.category_id)!;
  const endTs = typeof body.ended_at === 'number' ? body.ended_at : nowSeconds();

  const updated = sessionStore.end(session, category, endTs);
  return c.json(updated);
});
