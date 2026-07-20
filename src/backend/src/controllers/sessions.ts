import { Hono } from 'hono';
import { sessionStore, type ItemWithLastSession } from '../db/stores/session-store.js';
import { itemStore } from '../db/stores/item-store.js';
import { categoryStore } from '../db/stores/category-store.js';
import { injuryStore } from '../db/stores/injury-store.js';
import { statsStore } from '../db/stores/stats-store.js';
import {
  computeSessionStart,
  computeDecay,
  rotationAvailability,
  isConsecutiveLockEligible,
  type PreviousSession,
  type Category,
} from '../db/calculations.js';
import { NotFoundError, ValidationError, ConflictError } from '../middleware/errors.js';
import { nowSeconds } from '../utils/time.js';

/** A last-session item row enriched with the expected target/max for the next session. */
interface ItemWithExpected extends ItemWithLastSession {
  expected_target: number;
  expected_max: number | null;
  rotation_available: boolean;
}

function enrichItemsWithExpected(
  items: ItemWithLastSession[],
  category: Category,
  previous: PreviousSession | null,
  now: number,
  injuryActive: boolean,
  rotationAvailableIds: Set<number>,
): ItemWithExpected[] {
  return items.map((it) => {
    const { target, max } = computeSessionStart(
      category,
      { difficulty_multiplier: it.difficulty_multiplier },
      previous,
      now,
      injuryActive,
    );
    return {
      ...it,
      expected_target: target,
      expected_max: max,
      rotation_available: rotationAvailableIds.has(it.item_id),
    };
  });
}

export const router = new Hono();

// GET /api/sessions?item_id=&category_id=&before=&limit=
router.get('/', (c) => {
  const itemId = c.req.query('item_id');
  const categoryId = c.req.query('category_id');
  const before = c.req.query('before');
  const limit = c.req.query('limit');
  return c.json(
    sessionStore.findAll({
      itemId: itemId !== undefined ? Number(itemId) : undefined,
      categoryId: categoryId !== undefined ? Number(categoryId) : undefined,
      before: before !== undefined ? Number(before) : undefined,
      limit: limit !== undefined ? Number(limit) : undefined,
    }),
  );
});

// GET /api/sessions/current — one entry per category with active session or nulls
router.get('/current', (c) => {
  const categories = categoryStore.findAll();
  const openSessions = sessionStore.findOpenWithItemData();
  const allItems = sessionStore.findAllLastSessions();
  const now = nowSeconds();

  const sessionByCategory = new Map(openSessions.map((s) => [s.category_id, s]));
  const itemsByCategory = new Map<number, ItemWithLastSession[]>();
  for (const item of allItems) {
    if (!itemsByCategory.has(item.category_id)) itemsByCategory.set(item.category_id, []);
    itemsByCategory.get(item.category_id)!.push(item);
  }

  return c.json(
    categories.map((cat) => {
      const previous = sessionStore.findLastEndedInCategory(cat.id) ?? null;
      const injuryActive = injuryStore.hasActiveInCategory(cat.id);
      const { decay_start_time, decay_state, decay_full_time } =
        cat.type === 'duration'
          ? computeDecay(previous, cat, now)
          : { decay_start_time: null, decay_state: 'none' as const, decay_full_time: null };
      const streak_count = statsStore.findForCategory(cat.id)?.streak_count ?? 0;

      const rotationAvailableIds =
        cat.type === 'rotation'
          ? rotationAvailability(
              itemStore.findAll(cat.id).map((i) => i.id),
              sessionStore.findRecentInCategory(cat.id, 100),
            )
          : new Set((itemsByCategory.get(cat.id) ?? []).map((i) => i.item_id));

      const items = enrichItemsWithExpected(itemsByCategory.get(cat.id) ?? [], cat, previous, now, injuryActive, rotationAvailableIds);

      const s = sessionByCategory.get(cat.id);
      if (!s) return { category: cat, item: null, session: null, items, decay_start_time, decay_state, decay_full_time, streak_count };

      const item = {
        id: s.item_id, category_id: s.category_id, name: s.item_name,
        color: s.item_color, difficulty_multiplier: s.item_difficulty_multiplier,
      };
      const session = {
        id: s.id, item_id: s.item_id, started_at: s.started_at, ended_at: s.ended_at,
        target_wear_seconds: s.target_wear_seconds, max_wear_seconds: s.max_wear_seconds,
        rest_seconds: s.rest_seconds, ended_in_injury: s.ended_in_injury,
      };
      return { category: cat, item, session, items, decay_start_time, decay_state, decay_full_time, streak_count };
    }),
  );
});

// GET /api/sessions/dates?item_id=&category_id= — distinct days with completed sessions, for the Log jump index
router.get('/dates', (c) => {
  const categoryId = c.req.query('category_id');
  const itemId = c.req.query('item_id');
  return c.json(
    sessionStore.dates(
      categoryId !== undefined ? Number(categoryId) : undefined,
      itemId !== undefined ? Number(itemId) : undefined,
    ),
  );
});

// GET /api/sessions/:id
router.get('/:id', (c) => {
  const id = Number(c.req.param('id'));
  const session = sessionStore.find(id);
  if (!session) throw new NotFoundError(`Session ${id} not found`);
  return c.json(session);
});

// POST /api/sessions/start — begin a new session for an item
router.post('/start', async (c) => {
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

  if (category.type === 'rotation') {
    const activeItemIds = itemStore.findAll(item.category_id).map((i) => i.id);
    const recent = sessionStore.findRecentInCategory(item.category_id, 100);
    const available = rotationAvailability(activeItemIds, recent);
    const consecutiveLockEligible = isConsecutiveLockEligible(recent, item_id, category.consecutive_wear_days);
    if (!available.has(item_id) && !consecutiveLockEligible) {
      throw new ValidationError(`Item ${item_id} is not available yet — it's another item's turn in the rotation`);
    }
  }

  const startTs = typeof started_at === 'number' ? started_at : nowSeconds();
  const session = sessionStore.start(item_id, category, item, startTs);
  return c.json(session, 201);
});

// POST /api/sessions/:id/end — finish a session and compute wear/rest
router.post('/:id/end', async (c) => {
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

// PATCH /api/sessions/:id — correct a completed session's end time or duration
router.patch('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const session = sessionStore.find(id);
  if (!session) throw new NotFoundError(`Session ${id} not found`);
  if (session.ended_at === null) throw new ValidationError(`Session ${id} has not ended yet`);

  const body = (await c.req.json().catch(() => ({}))) as { ended_at?: number; duration_seconds?: number };

  let newEndedAt: number;
  if (typeof body.ended_at === 'number') {
    newEndedAt = body.ended_at;
  } else if (typeof body.duration_seconds === 'number') {
    newEndedAt = session.started_at + body.duration_seconds;
  } else {
    throw new ValidationError('ended_at or duration_seconds (number) is required');
  }
  if (newEndedAt <= session.started_at) throw new ValidationError('ended_at must be after started_at');

  const item = itemStore.find(session.item_id);
  if (!item) throw new NotFoundError(`Item ${session.item_id} not found`);
  const category = categoryStore.findRaw(item.category_id)!;

  const updated = sessionStore.updateEnd(session, category, newEndedAt);
  return c.json(updated);
});

// DELETE /api/sessions/:id
router.delete('/:id', (c) => {
  const id = Number(c.req.param('id'));
  const session = sessionStore.find(id);
  if (!session) throw new NotFoundError(`Session ${id} not found`);

  const item = itemStore.find(session.item_id);
  if (!item) throw new NotFoundError(`Item ${session.item_id} not found`);
  const category = categoryStore.findRaw(item.category_id)!;

  sessionStore.remove(session, category);
  return c.body(null, 204);
});
