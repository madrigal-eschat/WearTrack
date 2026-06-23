import db from '../index.js';
import {
  computeSessionStart,
  computeRest,
  riskLevelFor,
  type Category,
  type PreviousSession,
} from '../calculations.js';
import { statsStore } from './stats-store.js';
import { injuryStore } from './injury-store.js';

export interface Session {
  id: number;
  item_id: number;
  started_at: number;
  ended_at: number | null;
  target_wear_seconds: number;
  max_wear_seconds: number | null;
  rest_seconds: number | null;
  ended_in_injury: number;
}

export interface OpenSessionWithItem extends Session {
  category_id: number;
  item_name: string;
  item_color: string;
  item_difficulty_multiplier: number;
}

export interface ItemWithLastSession {
  item_id: number;
  category_id: number;
  name: string;
  color: string;
  difficulty_multiplier: number;
  ended_at: number | null;
  started_at: number | null;
  target_wear_seconds: number | null;
  max_wear_seconds: number | null;
  rest_seconds: number | null;
}

class SessionStore {
  findAllLastSessions(): ItemWithLastSession[] {
    return db
      .prepare(
        `SELECT
           i.id AS item_id, i.category_id, i.name, i.color, i.difficulty_multiplier,
           s.ended_at, s.started_at, s.target_wear_seconds, s.max_wear_seconds, s.rest_seconds
         FROM items i
         LEFT JOIN sessions s ON s.id = (
           SELECT id FROM sessions
           WHERE item_id = i.id AND ended_at IS NOT NULL
           ORDER BY ended_at DESC LIMIT 1
         )`,
      )
      .all() as ItemWithLastSession[];
  }

  findAll(itemId?: number): Session[] {
    if (itemId !== undefined) {
      return db.prepare('SELECT * FROM sessions WHERE item_id = ? ORDER BY started_at DESC').all(itemId) as Session[];
    }
    return db.prepare('SELECT * FROM sessions ORDER BY started_at DESC').all() as Session[];
  }

  find(id: number): Session | undefined {
    return db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as Session | undefined;
  }

  /** Most recently ended session for ANY item in the category (the formula's previous_session). */
  findLastEndedInCategory(categoryId: number): PreviousSession | undefined {
    return db
      .prepare(
        `SELECT s.target_wear_seconds, s.max_wear_seconds, s.ended_at, s.rest_seconds
         FROM sessions s JOIN items i ON i.id = s.item_id
         WHERE i.category_id = ? AND s.ended_at IS NOT NULL AND s.ended_in_injury = 0
         ORDER BY s.ended_at DESC LIMIT 1`,
      )
      .get(categoryId) as PreviousSession | undefined;
  }

  findOpenInCategory(categoryId: number): { session_id: number; item_id: number; item_name: string } | undefined {
    return db
      .prepare(
        `SELECT s.id AS session_id, i.id AS item_id, i.name AS item_name
         FROM sessions s JOIN items i ON i.id = s.item_id
         WHERE i.category_id = ? AND s.ended_at IS NULL`,
      )
      .get(categoryId) as { session_id: number; item_id: number; item_name: string } | undefined;
  }

  /** Find the open session for a specific item (used by the injuries controller). */
  findOpenForItem(itemId: number): { id: number } | undefined {
    return db.prepare('SELECT id FROM sessions WHERE item_id = ? AND ended_at IS NULL').get(itemId) as
      | { id: number }
      | undefined;
  }

  findOpenWithItemData(): OpenSessionWithItem[] {
    return db
      .prepare(
        `SELECT s.*, i.category_id, i.name AS item_name, i.color AS item_color,
                i.difficulty_multiplier AS item_difficulty_multiplier
         FROM sessions s JOIN items i ON i.id = s.item_id
         WHERE s.ended_at IS NULL`,
      )
      .all() as OpenSessionWithItem[];
  }

  /** Start a new session. category is the raw DB row; item supplies difficulty. */
  start(itemId: number, category: Category, item: { difficulty_multiplier: number }, startedAt: number): Session {
    const previous = this.findLastEndedInCategory(category.id) ?? null;
    const injuryActive = injuryStore.hasActiveInCategory(category.id);
    const { target, max } = computeSessionStart(category, item, previous, startedAt, injuryActive);

    const result = db
      .prepare(
        'INSERT INTO sessions (item_id, started_at, target_wear_seconds, max_wear_seconds) VALUES (?, ?, ?, ?)',
      )
      .run(itemId, startedAt, target, max);
    return this.find(result.lastInsertRowid as number)!;
  }

  /** End a session: derive elapsed, compute rest, persist; target/max stay as set at start. */
  end(session: Session, category: Category, endedAt: number): Session {
    return db.transaction(() => {
      const elapsed = endedAt - session.started_at;
      const injuryActive = injuryStore.hasActiveInCategory(category.id);
      const riskLevel = riskLevelFor(elapsed, category);
      const rest = computeRest(elapsed, session.max_wear_seconds, category, riskLevel, injuryActive);

      db.prepare('UPDATE sessions SET ended_at = ?, rest_seconds = ? WHERE id = ?').run(endedAt, rest, session.id);

      const updated = this.find(session.id)!;
      const snapshot = { ...updated, ended_at: endedAt };
      statsStore.recordItemSession(snapshot);
      statsStore.recordCategorySession(category.id, category.break_grace_time, snapshot);
      return updated;
    })();
  }

  /**
   * Close an open session as ended-in-injury (no stats update — wear is not credited).
   */
  endWithInjury(sessionId: number, endedAt: number): void {
    db.prepare('UPDATE sessions SET ended_at = ?, ended_in_injury = 1 WHERE id = ?').run(endedAt, sessionId);
  }
}

export const sessionStore = new SessionStore();
