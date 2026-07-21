import db from '../index.js';
import {
  computeSessionStart,
  computeRest,
  computeDecay,
  riskLevelFor,
  type Category,
  type PreviousSession,
} from '../calculations.js';
import { statsStore } from './stats-store.js';
import { injuryStore } from './injury-store.js';
import { eventBus } from '../../events/bus.js';
import { eventPollerStore } from '../../events/store.js';

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

export interface SessionWithDetails extends Session {
  category_id: number;
  item_name: string;
  item_color: string;
  category_name: string;
  category_icon: string;
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
           SELECT sess.id FROM sessions sess
           JOIN items it ON it.id = sess.item_id
           WHERE it.category_id = i.category_id AND sess.ended_at IS NOT NULL
           ORDER BY sess.ended_at DESC LIMIT 1
         )`,
      )
      .all() as ItemWithLastSession[];
  }

  findAll(opts: { itemId?: number; categoryId?: number; before?: number; limit?: number } = {}): SessionWithDetails[] {
    const { itemId, categoryId, before, limit = 100 } = opts;
    const clauses: string[] = ['s.ended_at IS NOT NULL'];
    const params: number[] = [];
    if (itemId !== undefined) {
      clauses.push('s.item_id = ?');
      params.push(itemId);
    }
    if (categoryId !== undefined) {
      clauses.push('i.category_id = ?');
      params.push(categoryId);
    }
    if (before !== undefined) {
      clauses.push('s.started_at < ?');
      params.push(before);
    }
    params.push(limit);

    return db
      .prepare(
        `SELECT s.*, i.category_id, i.name AS item_name, i.color AS item_color,
                c.name AS category_name, c.icon AS category_icon
         FROM sessions s
         JOIN items i ON i.id = s.item_id
         JOIN categories c ON c.id = i.category_id
         WHERE ${clauses.join(' AND ')}
         ORDER BY s.started_at DESC
         LIMIT ?`,
      )
      .all(...params) as SessionWithDetails[];
  }

  dates(categoryId?: number, itemId?: number): string[] {
    const clauses: string[] = [];
    const params: number[] = [];
    if (categoryId !== undefined) {
      clauses.push('category_id = ?');
      params.push(categoryId);
    }
    if (itemId !== undefined) {
      clauses.push('item_id = ?');
      params.push(itemId);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = db
      .prepare(`SELECT DISTINCT day FROM session_day_index ${where} ORDER BY day`)
      .all(...params) as { day: string }[];
    return rows.map((r) => r.day);
  }

  find(id: number): Session | undefined {
    return db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as Session | undefined;
  }

  /** Most recently ended session for ANY item in the category (the formula's previous_session). */
  findLastEndedInCategory(categoryId: number): PreviousSession | undefined {
    return db
      .prepare(
        `SELECT s.target_wear_seconds, s.max_wear_seconds, s.ended_at, s.started_at, s.rest_seconds
         FROM sessions s JOIN items i ON i.id = s.item_id
         WHERE i.category_id = ? AND s.ended_at IS NOT NULL AND s.ended_in_injury = 0
         ORDER BY s.ended_at DESC LIMIT 1`,
      )
      .get(categoryId) as PreviousSession | undefined;
  }

  /** Last `limit` sessions (any item) in a category, newest first. Feeds rotationAvailability. */
  findRecentInCategory(categoryId: number, limit: number): { item_id: number }[] {
    return db
      .prepare(
        `SELECT s.item_id FROM sessions s JOIN items i ON i.id = s.item_id
         WHERE i.category_id = ? AND s.ended_at IS NOT NULL
         ORDER BY s.ended_at DESC LIMIT ?`,
      )
      .all(categoryId, limit) as { item_id: number }[];
  }

  /** Most recent session (any item, open or closed) in the category that started on/after `dayStart`. Feeds the rotation daily-cap check. */
  findSessionStartedTodayInCategory(categoryId: number, dayStart: number): { started_at: number } | undefined {
    return db
      .prepare(
        `SELECT s.started_at FROM sessions s JOIN items i ON i.id = s.item_id
         WHERE i.category_id = ? AND s.started_at >= ?
         ORDER BY s.started_at DESC LIMIT 1`,
      )
      .get(categoryId, dayStart) as { started_at: number } | undefined;
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
    let target: number;
    let max: number | null;

    if (category.type === 'rotation') {
      target = category.initial_target_wear_duration_seconds;
      max = null;
    } else {
      const previous = this.findLastEndedInCategory(category.id) ?? null;
      const injuryActive = injuryStore.hasActiveInCategory(category.id);
      ({ target, max } = computeSessionStart(category, item, previous, startedAt, injuryActive));
    }

    // A new session in this category synchronously resolves any rest/decay period the
    // previous session left owing — otherwise it would silently linger until the next
    // poller tick, and the poller itself now skips a category's previous-session block
    // entirely while a session is open (see events/poller.ts).
    if (previous) {
      const restEnd = previous.ended_at + previous.rest_seconds;
      if (startedAt < restEnd) {
        eventBus.emit('rest_end', {
          category_id: category.id,
          category_name: category.name,
          timestamp: startedAt,
          rest_seconds: previous.rest_seconds,
          elapsed_rest_seconds: startedAt - previous.ended_at,
        });
      } else {
        const decay = computeDecay(previous, category, startedAt);
        const storedRow = eventPollerStore.get(category.id);
        const alreadyReported = storedRow?.decay_state === 'fully_decayed';
        if (decay.decay_state === 'fully_decayed' && !alreadyReported) {
          eventBus.emit('decay_finish', {
            category_id: category.id,
            category_name: category.name,
            timestamp: startedAt,
            decay_state: 'fully_decayed',
          });
        }
      }
    }

    const result = db
      .prepare(
        'INSERT INTO sessions (item_id, started_at, target_wear_seconds, max_wear_seconds) VALUES (?, ?, ?, ?)',
      )
      .run(itemId, startedAt, target, max);
    const session = this.find(result.lastInsertRowid as number)!;

    eventBus.emit('session_start', {
      category_id: category.id,
      category_name: category.name,
      timestamp: startedAt,
      session_id: session.id,
      item_id: itemId,
      target_wear_seconds: session.target_wear_seconds,
      max_wear_seconds: session.max_wear_seconds,
    });

    return session;
  }

  /** Write-through derived index: one row per (day, category, item) the first time a session on it completes. */
  recordDayIndex(sessionId: number): void {
    db.prepare(
      `INSERT OR IGNORE INTO session_day_index (day, category_id, item_id)
       SELECT date(s.started_at, 'unixepoch'), i.category_id, s.item_id
       FROM sessions s JOIN items i ON i.id = s.item_id
       WHERE s.id = ?`,
    ).run(sessionId);
  }

  /** End a session: derive elapsed, compute rest, persist; target/max stay as set at start. */
  end(session: Session, category: Category, endedAt: number): Session {
    return db.transaction(() => {
      let rest: number | null;
      if (category.type === 'rotation') {
        rest = null;
      } else {
        const elapsed = endedAt - session.started_at;
        const injuryActive = injuryStore.hasActiveInCategory(category.id);
        const riskLevel = riskLevelFor(elapsed, category);
        rest = computeRest(elapsed, session.max_wear_seconds, category, riskLevel, injuryActive);
      }

      db.prepare('UPDATE sessions SET ended_at = ?, rest_seconds = ? WHERE id = ?').run(endedAt, rest, session.id);

      const updated = this.find(session.id)!;
      const snapshot = { ...updated, ended_at: endedAt };
      statsStore.recordItemSession(snapshot);
      statsStore.recordCategorySession(category.id, category.break_grace_time, snapshot);
      this.recordDayIndex(session.id);

      eventBus.emit('session_end', {
        category_id: category.id,
        category_name: category.name,
        timestamp: endedAt,
        session_id: session.id,
        item_id: session.item_id,
        target_wear_seconds: session.target_wear_seconds,
        max_wear_seconds: session.max_wear_seconds,
        actual_duration_seconds: elapsed,
        rest_seconds: rest,
        risk_level: riskLevel?.text ?? null,
      });

      return updated;
    })();
  }

  /**
   * Close an open session as ended-in-injury (no stats update — wear is not credited).
   */
  endWithInjury(sessionId: number, endedAt: number): void {
    db.prepare('UPDATE sessions SET ended_at = ?, ended_in_injury = 1 WHERE id = ?').run(endedAt, sessionId);
    this.recordDayIndex(sessionId);
  }

  /**
   * Correct a completed session's end time (duration is derived by the caller).
   * `started_at` never changes. Injury-ended sessions never had rest_seconds/stats
   * contributions, so they're skipped for both here, matching endWithInjury().
   */
  updateEnd(session: Session, category: Category, newEndedAt: number): Session {
    return db.transaction(() => {
      if (session.ended_in_injury) {
        db.prepare('UPDATE sessions SET ended_at = ? WHERE id = ?').run(newEndedAt, session.id);
        return this.find(session.id)!;
      }

      const elapsed = newEndedAt - session.started_at;
      let rest: number | null;
      if (category.type === 'rotation') {
        rest = null;
      } else {
        const injuryActive = injuryStore.hasActiveInCategory(category.id);
        const riskLevel = riskLevelFor(elapsed, category);
        rest = computeRest(elapsed, session.max_wear_seconds, category, riskLevel, injuryActive);
      }

      db.prepare('UPDATE sessions SET ended_at = ?, rest_seconds = ? WHERE id = ?').run(
        newEndedAt,
        rest,
        session.id,
      );

      statsStore.recomputeItem(session.item_id);
      statsStore.recomputeCategory(category.id, category.break_grace_time);

      return this.find(session.id)!;
    })();
  }

  /**
   * Delete a completed session, recompute its item/category stats, and drop its
   * session_day_index row if no sibling session remains on that (day, category, item).
   */
  remove(session: Session, category: Category): void {
    const day = new Date(session.started_at * 1000).toISOString().slice(0, 10);

    db.transaction(() => {
      db.prepare('DELETE FROM sessions WHERE id = ?').run(session.id);

      const remaining = db
        .prepare(`SELECT COUNT(*) AS n FROM sessions WHERE item_id = ? AND date(started_at, 'unixepoch') = ?`)
        .get(session.item_id, day) as { n: number };
      if (remaining.n === 0) {
        db.prepare('DELETE FROM session_day_index WHERE day = ? AND category_id = ? AND item_id = ?').run(
          day,
          category.id,
          session.item_id,
        );
      }

      if (!session.ended_in_injury && session.ended_at !== null) {
        statsStore.recomputeItem(session.item_id);
        statsStore.recomputeCategory(category.id, category.break_grace_time);
      }
    })();
  }
}

export const sessionStore = new SessionStore();
