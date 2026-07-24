import db from '../index.js';

// ─── Per-item stats ──────────────────────────────────────────────────────────

export interface ItemStats {
  item_id: number;
  total_wear_seconds: number;
  session_count: number;
  max_single_session_wear_seconds: number;
}

// ─── Per-category stats (includes streak tracking) ───────────────────────────

export interface CategoryStats {
  category_id: number;
  total_wear_seconds: number;
  session_count: number;
  max_single_session_wear_seconds: number;
  streak_wear_seconds: number;
  streak_count: number;
  best_streak_wear_seconds: number;
  best_streak_count: number;
}

// Minimal session shape needed for stats update logic.
export interface SessionSnapshot {
  id: number;
  item_id: number;
  started_at: number;
  ended_at: number;
  target_wear_seconds: number;
  max_wear_seconds: number | null;
  rest_seconds: number | null;
}

type PrevSession = { ended_at: number; rest_seconds: number | null };

function computeNewStreak(
  stats: CategoryStats,
  prevSession: PrevSession | null,
  session: SessionSnapshot,
  breakGraceTime: number,
): { streak_count: number; streak_wear: number } {
  const duration = session.ended_at - session.started_at;
  let streakWear = stats.streak_wear_seconds + duration;
  let streakCount = stats.streak_count + 1;

  if (prevSession && prevSession.rest_seconds !== null) {
    const breakSeconds = session.started_at - prevSession.ended_at;
    if (breakSeconds > prevSession.rest_seconds + breakGraceTime) {
      streakWear = duration;
      streakCount = 1;
    }
  }

  return { streak_count: streakCount, streak_wear: streakWear };
}

class StatsStore {
  // ── Per-item ───────────────────────────────────────────────────────────────

  findForItem(itemId: number): ItemStats | undefined {
    return db.prepare('SELECT * FROM stats WHERE item_id = ?').get(itemId) as
      ItemStats | undefined;
  }

  initItem(itemId: number): void {
    db.prepare('INSERT OR IGNORE INTO stats (item_id) VALUES (?)').run(itemId);
  }

  /** Update cumulative per-item stats when a session ends. */
  recordItemSession(session: SessionSnapshot): void {
    const duration = session.ended_at - session.started_at;
    db.prepare(
      `
      UPDATE stats SET
        total_wear_seconds = total_wear_seconds + ?,
        session_count = session_count + 1,
        max_single_session_wear_seconds =
          MAX(max_single_session_wear_seconds, ?)
      WHERE item_id = ?
    `,
    ).run(duration, duration, session.item_id);
  }

  /**
   * Reset then replay every completed, non-injury session for this item
   * through recordItemSession, in order.
   */
  recomputeItem(itemId: number): void {
    db.prepare(
      `UPDATE stats SET total_wear_seconds = 0, session_count = 0,
       max_single_session_wear_seconds = 0
       WHERE item_id = ?`,
    ).run(itemId);

    const sessions = db
      .prepare(
        `SELECT * FROM sessions WHERE item_id = ? AND ended_at IS NOT NULL
         AND ended_in_injury = 0
         ORDER BY ended_at ASC`,
      )
      .all(itemId) as SessionSnapshot[];

    for (const session of sessions) {
      this.recordItemSession(session);
    }
  }

  /** Time-series wear data for one item, grouped by month or week. */
  history(itemId: number, unit: 'month' | 'week'): unknown[] {
    const format = unit === 'month' ? '%Y-%m' : '%Y-%W';
    return db
      .prepare(
        `SELECT strftime('${format}', datetime(ended_at, 'unixepoch'))
                  AS period,
                SUM(ended_at - started_at) AS total_wear_seconds,
                COUNT(*) AS session_count
         FROM sessions
         WHERE item_id = ? AND ended_at IS NOT NULL
         GROUP BY period ORDER BY period ASC`,
      )
      .all(itemId);
  }

  // ── Per-category ───────────────────────────────────────────────────────────

  findForCategory(
    categoryId: number,
  ): (CategoryStats & { item_count: number }) | undefined {
    const stats = db
      .prepare('SELECT * FROM category_stats WHERE category_id = ?')
      .get(categoryId) as CategoryStats | undefined;
    if (!stats) {
      return undefined;
    }
    const { item_count } = db
      .prepare('SELECT COUNT(*) AS item_count FROM items WHERE category_id = ?')
      .get(categoryId) as { item_count: number };
    return { ...stats, item_count };
  }

  initCategory(categoryId: number): void {
    db.prepare(
      'INSERT OR IGNORE INTO category_stats (category_id) VALUES (?)',
    ).run(categoryId);
  }

  /**
   * Update per-category cumulative stats and streak when a session ends.
   * The streak continues as long as each session starts within
   * `previousSession.rest_seconds + breakGraceTime` of the previous
   * category session (any item). Otherwise the streak resets.
   */
  recordCategorySession(
    categoryId: number,
    breakGraceTime: number,
    session: SessionSnapshot,
  ): void {
    const stats = db
      .prepare('SELECT * FROM category_stats WHERE category_id = ?')
      .get(categoryId) as CategoryStats | undefined;
    if (!stats) {
      return;
    }

    const duration = session.ended_at - session.started_at;

    const prev = db
      .prepare(
        `SELECT s.* FROM sessions s JOIN items i ON i.id = s.item_id
         WHERE i.category_id = ? AND s.ended_at IS NOT NULL AND s.id != ?
         ORDER BY s.ended_at DESC LIMIT 1`,
      )
      .get(categoryId, session.id) as PrevSession | undefined;

    const { streak_count: streakCount, streak_wear: streakWear } =
      computeNewStreak(stats, prev ?? null, session, breakGraceTime);

    const newBestStreakWear = Math.max(
      stats.best_streak_wear_seconds,
      streakWear,
    );
    const newBestStreakCount = Math.max(stats.best_streak_count, streakCount);

    db.prepare(
      `
      UPDATE category_stats SET
        total_wear_seconds = total_wear_seconds + ?,
        session_count = session_count + 1,
        max_single_session_wear_seconds =
          MAX(max_single_session_wear_seconds, ?),
        streak_wear_seconds = ?, streak_count = ?,
        best_streak_wear_seconds = ?, best_streak_count = ?
      WHERE category_id = ?
    `,
    ).run(
      duration,
      duration,
      streakWear,
      streakCount,
      newBestStreakWear,
      newBestStreakCount,
      categoryId,
    );
  }

  /**
   * Reset then replay every completed, non-injury session for this
   * category through recordCategorySession, in order.
   */
  recomputeCategory(categoryId: number, breakGraceTime: number): void {
    db.prepare(
      `UPDATE category_stats SET
         total_wear_seconds = 0, session_count = 0,
         max_single_session_wear_seconds = 0,
         streak_wear_seconds = 0, streak_count = 0,
         best_streak_wear_seconds = 0, best_streak_count = 0
       WHERE category_id = ?`,
    ).run(categoryId);

    const sessions = db
      .prepare(
        `SELECT s.* FROM sessions s JOIN items i ON i.id = s.item_id
         WHERE i.category_id = ? AND s.ended_at IS NOT NULL
         AND s.ended_in_injury = 0
         ORDER BY s.ended_at ASC`,
      )
      .all(categoryId) as SessionSnapshot[];

    for (const session of sessions) {
      this.recordCategorySession(categoryId, breakGraceTime, session);
    }
  }

  // ── Leaderboards ───────────────────────────────────────────────────────────

  longestWear(): unknown[] {
    return db
      .prepare(
        `SELECT s.item_id, i.name AS item_name, c.name AS category_name,
                c.icon AS category_icon, i.color AS item_color,
                s.max_single_session_wear_seconds
         FROM stats s
         JOIN items i ON i.id = s.item_id
         JOIN categories c ON c.id = i.category_id
         WHERE s.total_wear_seconds > 0
         ORDER BY s.max_single_session_wear_seconds DESC
         LIMIT 20`,
      )
      .all();
  }

  mostTotalWear(): unknown[] {
    return db
      .prepare(
        `SELECT s.item_id, i.name AS item_name, c.name AS category_name,
                c.icon AS category_icon, i.color AS item_color,
                s.total_wear_seconds
         FROM stats s
         JOIN items i ON i.id = s.item_id
         JOIN categories c ON c.id = i.category_id
         WHERE s.total_wear_seconds > 0
         ORDER BY s.total_wear_seconds DESC
         LIMIT 20`,
      )
      .all();
  }

  /** Best streak is per-category, not per-item. */
  bestStreak(): unknown[] {
    return db
      .prepare(
        `SELECT cs.category_id, c.name AS category_name,
                c.icon AS category_icon,
                cs.best_streak_wear_seconds,
                cs.best_streak_count AS streak_sessions
         FROM category_stats cs
         JOIN categories c ON c.id = cs.category_id
         WHERE cs.best_streak_wear_seconds > 0
         ORDER BY cs.best_streak_count DESC
         LIMIT 20`,
      )
      .all();
  }

  mostSessions(): unknown[] {
    return db
      .prepare(
        `SELECT s.item_id, i.name AS item_name, c.name AS category_name,
                c.icon AS category_icon, i.color AS item_color,
                s.session_count
         FROM stats s
         JOIN items i ON i.id = s.item_id
         JOIN categories c ON c.id = i.category_id
         WHERE s.total_wear_seconds > 0
         ORDER BY s.session_count DESC
         LIMIT 20`,
      )
      .all();
  }
}

export const statsStore = new StatsStore();
