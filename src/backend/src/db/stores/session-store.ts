import db from '../index.js';
import { calculateRest, calculatePostBreakWear, type Category } from '../calculations.js';
import { statsStore } from './stats-store.js';
import { injuryStore } from './injury-store.js';

export interface Session {
  id: number;
  item_id: number;
  started_at: number;
  ended_at: number | null;
  calculated_wear_seconds: number;
  calculated_rest_seconds: number | null;
  ended_in_injury: number;
}

/** Joined row returned by findOpenWithItemData — raw columns from the JOIN query. */
export interface OpenSessionWithItem extends Session {
  category_id: number;
  item_name: string;
  item_color: string;
  item_difficulty_multiplier: number;
}

const GRACE_SECONDS = 24 * 3600;

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

class SessionStore {
  findAll(itemId?: number): Session[] {
    if (itemId !== undefined) {
      return db
        .prepare('SELECT * FROM sessions WHERE item_id = ? ORDER BY started_at DESC')
        .all(itemId) as Session[];
    }
    return db.prepare('SELECT * FROM sessions ORDER BY started_at DESC').all() as Session[];
  }

  find(id: number): Session | undefined {
    return db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as Session | undefined;
  }

  findLastEnded(itemId: number): Session | undefined {
    return db
      .prepare(
        'SELECT * FROM sessions WHERE item_id = ? AND ended_at IS NOT NULL ORDER BY ended_at DESC LIMIT 1',
      )
      .get(itemId) as Session | undefined;
  }

  /**
   * Find the open session (if any) in a given category, along with item info for error messages.
   */
  findOpenInCategory(
    categoryId: number,
  ): { session_id: number; item_id: number; item_name: string } | undefined {
    return db
      .prepare(
        `SELECT s.id AS session_id, i.id AS item_id, i.name AS item_name
         FROM sessions s
         JOIN items i ON i.id = s.item_id
         WHERE i.category_id = ? AND s.ended_at IS NULL`,
      )
      .get(categoryId) as { session_id: number; item_id: number; item_name: string } | undefined;
  }

  /** Find the open session for a specific item (used by the injuries controller). */
  findOpenForItem(itemId: number): { id: number } | undefined {
    return db
      .prepare('SELECT id FROM sessions WHERE item_id = ? AND ended_at IS NULL')
      .get(itemId) as { id: number } | undefined;
  }

  /**
   * All currently open sessions, with their item columns inlined.
   * Used by the GET /sessions/current endpoint.
   */
  findOpenWithItemData(): OpenSessionWithItem[] {
    return db
      .prepare(
        `SELECT s.*, i.category_id, i.name AS item_name, i.color AS item_color,
                i.difficulty_multiplier AS item_difficulty_multiplier
         FROM sessions s
         JOIN items i ON i.id = s.item_id
         WHERE s.ended_at IS NULL`,
      )
      .all() as OpenSessionWithItem[];
  }

  /**
   * Work out how much wear credit carries over from a previous session.
   * If the break was within calculated_rest_seconds + grace, no decay applies.
   * If longer, apply exponential decay.
   */
  resolveInitialWear(itemId: number, category: Category, startedAt: number): number {
    const last = this.findLastEnded(itemId);
    if (!last || last.calculated_rest_seconds === null) {
      return category.initial_wear_duration_seconds;
    }

    const breakSeconds = startedAt - last.ended_at!;
    const graceWindow = last.calculated_rest_seconds + GRACE_SECONDS;

    if (breakSeconds <= graceWindow) {
      return last.calculated_wear_seconds;
    }

    const breakHoursOverGrace = (breakSeconds - last.calculated_rest_seconds) / 3600;
    return calculatePostBreakWear(last.calculated_wear_seconds, breakHoursOverGrace, category);
  }

  /** Start a new session. Category must already be fetched by the caller. */
  start(itemId: number, category: Category, startedAt: number): Session {
    const initialWear = this.resolveInitialWear(itemId, category, startedAt);
    const result = db
      .prepare(
        'INSERT INTO sessions (item_id, started_at, calculated_wear_seconds) VALUES (?, ?, ?)',
      )
      .run(itemId, startedAt, initialWear);
    return this.find(result.lastInsertRowid as number)!;
  }

  /**
   * End a session: compute final wear and rest, persist, then update cumulative stats.
   * Runs inside a transaction.
   */
  end(session: Session, category: Category, endedAt: number): Session {
    return db.transaction(() => {
      const elapsed = endedAt - session.started_at;
      const finalWear = session.calculated_wear_seconds + elapsed;
      const injuryActive = injuryStore.hasActive(session.item_id);
      const calculatedRest = calculateRest(finalWear, category, injuryActive);

      db.prepare(
        `UPDATE sessions SET ended_at = ?, calculated_wear_seconds = ?, calculated_rest_seconds = ? WHERE id = ?`,
      ).run(endedAt, finalWear, calculatedRest, session.id);

      const updated = this.find(session.id)!;
      // ended_at is guaranteed non-null after the UPDATE above
      const snapshot = { ...updated, ended_at: endedAt };
      statsStore.recordItemSession(snapshot);
      statsStore.recordCategorySession(category.id, snapshot);
      return updated;
    })();
  }

  /**
   * Close an open session as ended-in-injury (no stats update — wear is not credited).
   */
  endWithInjury(sessionId: number, endedAt: number): void {
    db.prepare(
      'UPDATE sessions SET ended_at = ?, ended_in_injury = 1 WHERE id = ?',
    ).run(endedAt, sessionId);
  }
}

export const sessionStore = new SessionStore();
