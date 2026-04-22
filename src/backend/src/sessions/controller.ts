import { Hono } from 'hono';
import { prepare } from '../db/index.js';
import { hasActiveInjury } from '../db/injury.js';
import { calculateRest, calculatePostBreakWear, type Category } from '../db/calculations.js';
import { NotFoundError, ValidationError } from '../middleware/errors.js';

interface SessionRow {
  id: number;
  item_id: number;
  started_at: number;
  ended_at: number | null;
  calculated_wear_seconds: number;
  calculated_rest_seconds: number | null;
  ended_in_injury: number;
}

interface StatsRow {
  item_id: number;
  total_wear_seconds: number;
  session_count: number;
  max_single_session_wear_seconds: number;
  streak_wear_seconds: number;
  streak_count: number;
  best_streak_wear_seconds: number;
  best_streak_count: number;
}

const GRACE_SECONDS = 24 * 3600; // 24-hour grace on top of calculated_rest_seconds

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function getItem(itemId: number) {
  return prepare('SELECT * FROM items WHERE id = ?').get(itemId) as { id: number; category_id: number } | undefined;
}

function getCategory(categoryId: number): Category {
  return prepare('SELECT * FROM categories WHERE id = ?').get(categoryId) as Category;
}

function getLastEndedSession(itemId: number): SessionRow | undefined {
  return prepare(
    'SELECT * FROM sessions WHERE item_id = ? AND ended_at IS NOT NULL ORDER BY ended_at DESC LIMIT 1',
  ).get(itemId) as SessionRow | undefined;
}

function getStats(itemId: number): StatsRow {
  return prepare('SELECT * FROM stats WHERE item_id = ?').get(itemId) as StatsRow;
}

/**
 * Work out how much wear credit carries over from a previous session.
 * If the break was within calculated_rest_seconds + grace, no decay applies.
 * If longer, apply exponential decay.
 */
function resolveInitialWear(itemId: number, category: Category): number {
  const last = getLastEndedSession(itemId);
  if (!last || last.calculated_rest_seconds === null) {
    // No prior session — start from category initial_wear_duration_seconds
    return category.initial_wear_duration_seconds;
  }

  const now = nowSeconds();
  const breakSeconds = now - last.ended_at!;
  const graceWindow = last.calculated_rest_seconds + GRACE_SECONDS;

  if (breakSeconds <= graceWindow) {
    // Within grace — carry previous wear forward unchanged
    return last.calculated_wear_seconds;
  }

  // Beyond grace — apply decay based on hours over the grace window
  const breakHoursOverGrace = (breakSeconds - last.calculated_rest_seconds) / 3600;
  return calculatePostBreakWear(last.calculated_wear_seconds, breakHoursOverGrace, category);
}

/**
 * Update cumulative stats after ending a session.
 * Streak: reset if the break exceeded calculated_rest_seconds + grace on the PREVIOUS session.
 */
function updateStats(itemId: number, session: SessionRow) {
  const stats = getStats(itemId);
  const duration = session.calculated_wear_seconds;

  // Did the streak survive into this session?
  // (The streak was already counted as broken if this session started with decayed wear)
  const last = prepare(
    'SELECT * FROM sessions WHERE item_id = ? AND ended_at IS NOT NULL AND id != ? ORDER BY ended_at DESC LIMIT 1',
  ).get(itemId, session.id) as SessionRow | undefined;

  let streakWear = stats.streak_wear_seconds + duration;
  let streakCount = stats.streak_count + 1;

  if (last && last.calculated_rest_seconds !== null) {
    const breakSeconds = session.started_at - last.ended_at!;
    const graceWindow = last.calculated_rest_seconds + GRACE_SECONDS;
    if (breakSeconds > graceWindow) {
      // Streak broken — reset to just this session
      streakWear = duration;
      streakCount = 1;
    }
  }

  const newMaxWear = Math.max(stats.max_single_session_wear_seconds, duration);
  const newBestStreakWear = Math.max(stats.best_streak_wear_seconds, streakWear);
  const newBestStreakCount = streakWear > stats.best_streak_wear_seconds ? streakCount : stats.best_streak_count;

  prepare(`UPDATE stats SET
    total_wear_seconds = total_wear_seconds + ?,
    session_count = session_count + 1,
    max_single_session_wear_seconds = ?,
    streak_wear_seconds = ?,
    streak_count = ?,
    best_streak_wear_seconds = ?,
    best_streak_count = ?
    WHERE item_id = ?`).run(
    duration,
    newMaxWear,
    streakWear,
    streakCount,
    newBestStreakWear,
    newBestStreakCount,
    itemId,
  );
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
  const { item_id } = body;

  if (typeof item_id !== 'number') throw new ValidationError('item_id must be a number');

  const item = getItem(item_id);
  if (!item) throw new NotFoundError(`Item ${item_id} not found`);

  // Ensure no open session exists
  const open = prepare('SELECT id FROM sessions WHERE item_id = ? AND ended_at IS NULL').get(item_id);
  if (open) throw new ValidationError(`Item ${item_id} already has an open session`);

  const category = getCategory(item.category_id);
  const initialWear = resolveInitialWear(item_id, category);
  const now = nowSeconds();

  const result = prepare(
    'INSERT INTO sessions (item_id, started_at, calculated_wear_seconds) VALUES (?, ?, ?)',
  ).run(item_id, now, initialWear);

  const row = prepare('SELECT * FROM sessions WHERE id = ?').get(result.lastInsertRowid) as SessionRow;
  return c.json(row, 201);
});

// POST /api/sessions/:id/end — finish a session and compute wear/rest
controller.post('/:id/end', (c) => {
  const id = Number(c.req.param('id'));
  const session = prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow | undefined;
  if (!session) throw new NotFoundError(`Session ${id} not found`);
  if (session.ended_at !== null) throw new ValidationError(`Session ${id} is already ended`);

  const item = getItem(session.item_id);
  if (!item) throw new NotFoundError(`Item ${session.item_id} not found`);

  const category = getCategory(item.category_id);
  const now = nowSeconds();
  const elapsed = now - session.started_at;
  const finalWear = session.calculated_wear_seconds + elapsed;

  const injuryActive = hasActiveInjury(session.item_id);
  const calculatedRest = calculateRest(finalWear, category, injuryActive);

  prepare(`UPDATE sessions SET
    ended_at = ?,
    calculated_wear_seconds = ?,
    calculated_rest_seconds = ?
    WHERE id = ?`).run(now, finalWear, calculatedRest, id);

  const updated = prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow;
  updateStats(session.item_id, updated);

  return c.json(updated);
});
