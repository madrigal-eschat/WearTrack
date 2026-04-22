import { Hono } from 'hono';
import { prepare } from '../db/index.js';
import { NotFoundError, ValidationError } from '../middleware/errors.js';

const LEADERBOARD_TYPES = ['longest-wear', 'most-total-wear', 'best-streak', 'most-sessions'] as const;
type LeaderboardType = (typeof LEADERBOARD_TYPES)[number];

function leaderboardQuery(type: LeaderboardType): string {
  switch (type) {
    case 'longest-wear':
      return `SELECT s.item_id, i.name as item_name, c.name as category_name,
                s.max_single_session_wear_seconds as score
              FROM stats s
              JOIN items i ON i.id = s.item_id
              JOIN categories c ON c.id = i.category_id
              ORDER BY s.max_single_session_wear_seconds DESC
              LIMIT 20`;
    case 'most-total-wear':
      return `SELECT s.item_id, i.name as item_name, c.name as category_name,
                s.total_wear_seconds as score
              FROM stats s
              JOIN items i ON i.id = s.item_id
              JOIN categories c ON c.id = i.category_id
              ORDER BY s.total_wear_seconds DESC
              LIMIT 20`;
    case 'best-streak':
      return `SELECT s.item_id, i.name as item_name, c.name as category_name,
                s.best_streak_wear_seconds as score, s.best_streak_count as streak_sessions
              FROM stats s
              JOIN items i ON i.id = s.item_id
              JOIN categories c ON c.id = i.category_id
              ORDER BY s.best_streak_wear_seconds DESC
              LIMIT 20`;
    case 'most-sessions':
      return `SELECT s.item_id, i.name as item_name, c.name as category_name,
                s.session_count as score
              FROM stats s
              JOIN items i ON i.id = s.item_id
              JOIN categories c ON c.id = i.category_id
              ORDER BY s.session_count DESC
              LIMIT 20`;
  }
}

export const controller = new Hono();

// GET /api/stats/leaderboard/:type — MUST be defined before /:item_id to avoid shadowing
controller.get('/leaderboard/:type', (c) => {
  const type = c.req.param('type') as LeaderboardType;
  if (!LEADERBOARD_TYPES.includes(type)) {
    throw new ValidationError(`type must be one of: ${LEADERBOARD_TYPES.join(', ')}`);
  }
  const rows = prepare(leaderboardQuery(type)).all();
  return c.json(rows);
});

// GET /api/stats/:item_id — cumulative stats for a single item
controller.get('/:item_id', (c) => {
  const itemId = Number(c.req.param('item_id'));
  const item = prepare('SELECT id FROM items WHERE id = ?').get(itemId);
  if (!item) throw new NotFoundError(`Item ${itemId} not found`);

  const stats = prepare('SELECT * FROM stats WHERE item_id = ?').get(itemId);
  return c.json(stats ?? {
    item_id: itemId,
    total_wear_seconds: 0,
    session_count: 0,
    max_single_session_wear_seconds: 0,
    streak_wear_seconds: 0,
    streak_count: 0,
    best_streak_wear_seconds: 0,
    best_streak_count: 0,
  });
});

// GET /api/stats/:item_id/history?unit=month|week — time-series aggregated from sessions
controller.get('/:item_id/history', (c) => {
  const itemId = Number(c.req.param('item_id'));
  const item = prepare('SELECT id FROM items WHERE id = ?').get(itemId);
  if (!item) throw new NotFoundError(`Item ${itemId} not found`);

  const unit = c.req.query('unit') ?? 'month';
  if (unit !== 'month' && unit !== 'week') {
    throw new ValidationError('unit must be "month" or "week"');
  }

  // SQLite strftime: %Y-%m for month, %Y-%W for week
  const format = unit === 'month' ? '%Y-%m' : '%Y-%W';

  const rows = prepare(`
    SELECT strftime('${format}', datetime(ended_at, 'unixepoch')) as period,
           SUM(calculated_wear_seconds) as total_wear_seconds,
           COUNT(*) as session_count
    FROM sessions
    WHERE item_id = ? AND ended_at IS NOT NULL
    GROUP BY period
    ORDER BY period ASC
  `).all(itemId);

  return c.json(rows);
});
