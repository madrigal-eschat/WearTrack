import db from '../db/index.js';
import type { CategorySchedulerState, NotificationType } from './types.js';

class NotificationStore {
  getSchedulerState(): CategorySchedulerState[] {
    const catRows = db.prepare(`
      SELECT c.id AS category_id, c.name AS category_name, c.break_grace_time,
             s.id AS prev_id, s.ended_at AS prev_ended_at, s.rest_seconds AS prev_rest_seconds
      FROM categories c
      LEFT JOIN sessions s ON s.id = (
        SELECT s2.id FROM sessions s2 JOIN items i2 ON i2.id = s2.item_id
        WHERE i2.category_id = c.id AND s2.ended_at IS NOT NULL AND s2.ended_in_injury = 0
          AND s2.rest_seconds IS NOT NULL
        ORDER BY s2.ended_at DESC LIMIT 1
      )
    `).all() as Array<{
      category_id: number; category_name: string; break_grace_time: number;
      prev_id: number | null; prev_ended_at: number | null; prev_rest_seconds: number | null;
    }>;

    const openSessions = db.prepare(`
      SELECT s.id, s.started_at, s.target_wear_seconds, s.max_wear_seconds, i.category_id
      FROM sessions s JOIN items i ON i.id = s.item_id WHERE s.ended_at IS NULL
    `).all() as Array<{
      id: number; started_at: number; target_wear_seconds: number;
      max_wear_seconds: number | null; category_id: number;
    }>;

    const openByCategory = new Map(openSessions.map(s => [s.category_id, s]));

    return catRows.map(row => ({
      category_id: row.category_id,
      category_name: row.category_name,
      break_grace_time: row.break_grace_time,
      previous: row.prev_id !== null
        ? { id: row.prev_id, ended_at: row.prev_ended_at!, rest_seconds: row.prev_rest_seconds! }
        : null,
      session: openByCategory.get(row.category_id) ?? null,
    }));
  }

  getSubscription(): string | null {
    const row = db.prepare('SELECT subscription_json FROM push_subscriptions LIMIT 1').get() as
      { subscription_json: string } | undefined;
    return row?.subscription_json ?? null;
  }

  upsertSubscription(json: string): void {
    db.prepare('DELETE FROM push_subscriptions').run();
    db.prepare('INSERT INTO push_subscriptions (subscription_json, created_at) VALUES (?, ?)')
      .run(json, Math.floor(Date.now() / 1000));
  }

  deleteSubscription(): void {
    db.prepare('DELETE FROM push_subscriptions').run();
  }

  getSentForSessions(sessionIds: number[]): Set<string> {
    if (sessionIds.length === 0) return new Set();
    const placeholders = sessionIds.map(() => '?').join(', ');
    const rows = db.prepare(
      `SELECT session_id, type FROM sent_notifications WHERE session_id IN (${placeholders})`
    ).all(...sessionIds) as { session_id: number; type: string }[];
    return new Set(rows.map(r => `${r.session_id}:${r.type}`));
  }

  tryMarkSent(sessionId: number, type: NotificationType, sentAt: number): boolean {
    const result = db.prepare(
      'INSERT OR IGNORE INTO sent_notifications (session_id, type, sent_at) VALUES (?, ?, ?)'
    ).run(sessionId, type, sentAt);
    return result.changes > 0;
  }
}

export const notificationStore = new NotificationStore();
