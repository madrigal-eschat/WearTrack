import { Hono } from 'hono';
import { prepare } from '../db/index.js';
import { hasActiveInjury } from '../db/injury.js';
import { calculateRest, calculatePostBreakWear, type Category } from '../db/calculations.js';
import { NotFoundError, ValidationError, ConflictError } from '../middleware/errors.js';
import type { RiskLevel } from '../db/calculations.js';

interface SessionRow {
  id: number;
  item_id: number;
  started_at: number;
  ended_at: number | null;
  calculated_wear_seconds: number;
  calculated_rest_seconds: number | null;
  ended_in_injury: number;
}

interface CategoryRow {
  id: number;
  name: string;
  icon: string;
  initial_wear_duration_seconds: number;
  rest_multiplier: number;
  rest_constant_seconds: number;
  risk_levels: string;
  break_decay_multiplier: number;
  break_starts_after_seconds: number;
}

interface ItemRow {
  id: number;
  category_id: number;
  name: string;
  color: string;
  difficulty_multiplier: number;
}

interface OpenSessionWithItem extends SessionRow {
  category_id: number;
  item_name: string;
  item_color: string;
  item_difficulty_multiplier: number;
}

const GRACE_SECONDS = 24 * 3600; // 24-hour grace on top of calculated_rest_seconds

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function getItem(itemId: number) {
  return prepare('SELECT * FROM items WHERE id = ?').get(itemId) as ItemRow | undefined;
}

function getCategory(categoryId: number): Category {
  return prepare('SELECT * FROM categories WHERE id = ?').get(categoryId) as Category;
}

function getLastEndedSession(itemId: number): SessionRow | undefined {
  return prepare(
    'SELECT * FROM sessions WHERE item_id = ? AND ended_at IS NOT NULL ORDER BY ended_at DESC LIMIT 1',
  ).get(itemId) as SessionRow | undefined;
}

function serializeCategory(row: CategoryRow) {
  return {
    ...row,
    risk_levels: JSON.parse(row.risk_levels) as RiskLevel[],
  };
}

/**
 * Work out how much wear credit carries over from a previous session.
 * If the break was within calculated_rest_seconds + grace, no decay applies.
 * If longer, apply exponential decay.
 */
function resolveInitialWear(itemId: number, category: Category, startedAt: number): number {
  const last = getLastEndedSession(itemId);
  if (!last || last.calculated_rest_seconds === null) {
    // No prior session — start from category initial_wear_duration_seconds
    return category.initial_wear_duration_seconds;
  }

  const breakSeconds = startedAt - last.ended_at!;
  const graceWindow = last.calculated_rest_seconds + GRACE_SECONDS;

  if (breakSeconds <= graceWindow) {
    // Within grace — carry previous wear forward unchanged
    return last.calculated_wear_seconds;
  }

  // Beyond grace — apply decay based on hours over the grace window
  const breakHoursOverGrace = (breakSeconds - last.calculated_rest_seconds) / 3600;
  return calculatePostBreakWear(last.calculated_wear_seconds, breakHoursOverGrace, category);
}

/** Update per-item cumulative stats (totals only; no streak). */
function updateItemStats(itemId: number, session: SessionRow) {
  const duration = session.calculated_wear_seconds;
  prepare(`
    UPDATE stats SET
      total_wear_seconds              = total_wear_seconds + ?,
      session_count                   = session_count + 1,
      max_single_session_wear_seconds = MAX(max_single_session_wear_seconds, ?)
    WHERE item_id = ?
  `).run(duration, duration, itemId);
}

/**
 * Update per-category cumulative stats including streak tracking.
 * Streak breaks if the gap between the previous category session's end and
 * this session's start exceeded that previous session's calculated_rest_seconds + 24h grace.
 */
function updateCategoryStats(categoryId: number, session: SessionRow) {
  const stats = prepare('SELECT * FROM category_stats WHERE category_id = ?').get(categoryId) as {
    streak_wear_seconds: number;
    streak_count: number;
    best_streak_wear_seconds: number;
    best_streak_count: number;
  } | undefined;
  if (!stats) return;

  const duration = session.calculated_wear_seconds;

  // Last ended session for ANY item in this category (not the one just ended)
  const prev = prepare(`
    SELECT s.* FROM sessions s
    JOIN items i ON i.id = s.item_id
    WHERE i.category_id = ? AND s.ended_at IS NOT NULL AND s.id != ?
    ORDER BY s.ended_at DESC LIMIT 1
  `).get(categoryId, session.id) as SessionRow | undefined;

  let streakWear = stats.streak_wear_seconds + duration;
  let streakCount = stats.streak_count + 1;

  if (prev && prev.calculated_rest_seconds !== null) {
    const breakSeconds = session.started_at - prev.ended_at!;
    if (breakSeconds > prev.calculated_rest_seconds + GRACE_SECONDS) {
      streakWear = duration;
      streakCount = 1;
    }
  }

  const newBestStreakWear = Math.max(stats.best_streak_wear_seconds, streakWear);
  const newBestStreakCount =
    streakWear > stats.best_streak_wear_seconds ? streakCount : stats.best_streak_count;

  prepare(`
    UPDATE category_stats SET
      total_wear_seconds              = total_wear_seconds + ?,
      session_count                   = session_count + 1,
      max_single_session_wear_seconds = MAX(max_single_session_wear_seconds, ?),
      streak_wear_seconds             = ?,
      streak_count                    = ?,
      best_streak_wear_seconds        = ?,
      best_streak_count               = ?
    WHERE category_id = ?
  `).run(duration, duration, streakWear, streakCount, newBestStreakWear, newBestStreakCount, categoryId);
}

export const controller = new Hono();

// GET /api/sessions?item_id=
controller.get('/', (c) => {
  const itemId = c.req.query('item_id');
  const rows = itemId
    ? (prepare('SELECT * FROM sessions WHERE item_id = ? ORDER BY started_at DESC').all(Number(itemId)) as SessionRow[])
    : (prepare('SELECT * FROM sessions ORDER BY started_at DESC').all() as SessionRow[]);
  return c.json(rows);
});

// GET /api/sessions/current — one entry per category with active session or nulls
controller.get('/current', (c) => {
  const categories = prepare('SELECT * FROM categories ORDER BY id').all() as CategoryRow[];

  const openSessions = prepare(`
    SELECT s.*, i.category_id, i.name AS item_name, i.color AS item_color, i.difficulty_multiplier AS item_difficulty_multiplier
    FROM sessions s
    JOIN items i ON i.id = s.item_id
    WHERE s.ended_at IS NULL
  `).all() as OpenSessionWithItem[];

  const sessionByCategory = new Map<number, OpenSessionWithItem>();
  for (const s of openSessions) {
    sessionByCategory.set(s.category_id, s);
  }

  return c.json(
    categories.map((cat) => {
      const s = sessionByCategory.get(cat.id);
      if (!s) {
        return { category: serializeCategory(cat), item: null, session: null };
      }
      const item: ItemRow = {
        id: s.item_id,
        category_id: s.category_id,
        name: s.item_name,
        color: s.item_color,
        difficulty_multiplier: s.item_difficulty_multiplier,
      };
      const session: SessionRow = {
        id: s.id,
        item_id: s.item_id,
        started_at: s.started_at,
        ended_at: s.ended_at,
        calculated_wear_seconds: s.calculated_wear_seconds,
        calculated_rest_seconds: s.calculated_rest_seconds,
        ended_in_injury: s.ended_in_injury,
      };
      return { category: serializeCategory(cat), item, session };
    }),
  );
});

// GET /api/sessions/:id
controller.get('/:id', (c) => {
  const id = Number(c.req.param('id'));
  const row = prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow | undefined;
  if (!row) throw new NotFoundError(`Session ${id} not found`);
  return c.json(row);
});

// POST /api/sessions/start — begin a new session for an item
controller.post('/start', async (c) => {
  const body = await c.req.json();
  const { item_id, started_at } = body;

  if (typeof item_id !== 'number') throw new ValidationError('item_id must be a number');
  if (started_at !== undefined && typeof started_at !== 'number') {
    throw new ValidationError('started_at must be a Unix timestamp (number)');
  }

  const item = getItem(item_id);
  if (!item) throw new NotFoundError(`Item ${item_id} not found`);

  // Enforce one open session per category
  const conflict = prepare(`
    SELECT s.id AS session_id, i.id AS item_id, i.name AS item_name
    FROM sessions s
    JOIN items i ON i.id = s.item_id
    WHERE i.category_id = ? AND s.ended_at IS NULL
  `).get(item.category_id) as { session_id: number; item_id: number; item_name: string } | undefined;

  if (conflict) {
    throw new ConflictError(
      `Category already has an open session on item "${conflict.item_name}" (id ${conflict.item_id})`,
      { conflicting_item: { id: conflict.item_id, name: conflict.item_name } },
    );
  }

  const category = getCategory(item.category_id);
  const startTs = typeof started_at === 'number' ? started_at : nowSeconds();
  const initialWear = resolveInitialWear(item_id, category, startTs);

  const result = prepare(
    'INSERT INTO sessions (item_id, started_at, calculated_wear_seconds) VALUES (?, ?, ?)',
  ).run(item_id, startTs, initialWear);

  const row = prepare('SELECT * FROM sessions WHERE id = ?').get(result.lastInsertRowid) as SessionRow;
  return c.json(row, 201);
});

// POST /api/sessions/:id/end — finish a session and compute wear/rest
controller.post('/:id/end', async (c) => {
  const id = Number(c.req.param('id'));
  const session = prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow | undefined;
  if (!session) throw new NotFoundError(`Session ${id} not found`);
  if (session.ended_at !== null) throw new ValidationError(`Session ${id} is already ended`);

  const body = await c.req.json().catch(() => ({})) as { ended_at?: number };
  if (body.ended_at !== undefined && typeof body.ended_at !== 'number') {
    throw new ValidationError('ended_at must be a Unix timestamp (number)');
  }

  const item = getItem(session.item_id);
  if (!item) throw new NotFoundError(`Item ${session.item_id} not found`);

  const category = getCategory(item.category_id);
  const endTs = typeof body.ended_at === 'number' ? body.ended_at : nowSeconds();
  const elapsed = endTs - session.started_at;
  const finalWear = session.calculated_wear_seconds + elapsed;

  const injuryActive = hasActiveInjury(session.item_id);
  const calculatedRest = calculateRest(finalWear, category, injuryActive);

  prepare(`UPDATE sessions SET
    ended_at = ?,
    calculated_wear_seconds = ?,
    calculated_rest_seconds = ?
    WHERE id = ?`).run(endTs, finalWear, calculatedRest, id);

  const updated = prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow;
  updateItemStats(session.item_id, updated);
  updateCategoryStats(item.category_id, updated);

  return c.json(updated);
});
