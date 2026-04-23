import { Hono } from 'hono';
import { prepare } from '../db/index.js';

export const controller = new Hono();

// GET /api/leaderboards/longest-wear — items ranked by best single session
controller.get('/longest-wear', (c) => {
  const rows = prepare(`
    SELECT s.item_id, i.name AS item_name, c.name AS category_name,
           s.max_single_session_wear_seconds AS score
    FROM stats s
    JOIN items i ON i.id = s.item_id
    JOIN categories c ON c.id = i.category_id
    ORDER BY s.max_single_session_wear_seconds DESC
    LIMIT 20
  `).all();
  return c.json(rows);
});

// GET /api/leaderboards/most-total-wear — items ranked by lifetime wear
controller.get('/most-total-wear', (c) => {
  const rows = prepare(`
    SELECT s.item_id, i.name AS item_name, c.name AS category_name,
           s.total_wear_seconds AS score
    FROM stats s
    JOIN items i ON i.id = s.item_id
    JOIN categories c ON c.id = i.category_id
    ORDER BY s.total_wear_seconds DESC
    LIMIT 20
  `).all();
  return c.json(rows);
});

// GET /api/leaderboards/best-streak — categories ranked by best wear streak
controller.get('/best-streak', (c) => {
  const rows = prepare(`
    SELECT cs.category_id, c.name AS category_name,
           cs.best_streak_wear_seconds AS score,
           cs.best_streak_count AS streak_sessions
    FROM category_stats cs
    JOIN categories c ON c.id = cs.category_id
    ORDER BY cs.best_streak_wear_seconds DESC
    LIMIT 20
  `).all();
  return c.json(rows);
});

// GET /api/leaderboards/most-sessions — items ranked by session count
controller.get('/most-sessions', (c) => {
  const rows = prepare(`
    SELECT s.item_id, i.name AS item_name, c.name AS category_name,
           s.session_count AS score
    FROM stats s
    JOIN items i ON i.id = s.item_id
    JOIN categories c ON c.id = i.category_id
    ORDER BY s.session_count DESC
    LIMIT 20
  `).all();
  return c.json(rows);
});
