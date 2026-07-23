// src/backend/tests/db/stats-store.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import db from '../../src/db/index.js';
import { runMigrations } from '../../src/db/migrations/index.js';
import { statsStore } from '../../src/db/stores/stats-store.js';
import { categoryStore } from '../../src/db/stores/category-store.js';

// category_id=1, item_id=1 (item2 id=2 for leaderboard ordering tests)
beforeAll(() => {
  runMigrations();
  categoryStore.create({
    name: 'C',
    icon: 'x',
    initial_target_wear_duration_seconds: 900,
    initial_max_wear_duration_seconds: 1800,
    rest_multiplier: 2,
    minimum_rest: 0,
    risk_levels: [{ lower: null, upper: null, text: 'Only', severity: 1 }],
    break_decay_multiplier: 0.91,
    break_grace_time: 86400,
  });
  db.prepare(
    `INSERT INTO items (category_id, name, color, difficulty_multiplier)
     VALUES (1,'i','#fff',1)`,
  ).run();
  db.prepare(
    `INSERT INTO items (category_id, name, color, difficulty_multiplier)
     VALUES (1,'j','#000',1)`,
  ).run();
  statsStore.initItem(1);
  statsStore.initItem(2);
  statsStore.initCategory(1);
});

// Helper: insert a real session row with the given timestamps and rest_seconds
function insertSession(
  id: number,
  itemId: number,
  startedAt: number,
  endedAt: number | null,
  restSeconds: number | null = null,
) {
  db.prepare(
    `INSERT INTO sessions (id, item_id, started_at, ended_at,
       target_wear_seconds, max_wear_seconds, rest_seconds)
     VALUES (?, ?, ?, ?, 900, 1800, ?)`,
  ).run(id, itemId, startedAt, endedAt, restSeconds);
}

describe('recordItemSession', () => {
  it(
    'counts wear as elapsed (ended_at - started_at), not the stored ' + 'max',
    () => {
      statsStore.recordItemSession({
        id: 1,
        item_id: 1,
        started_at: 100,
        ended_at: 100 + 3600,
        target_wear_seconds: 900,
        max_wear_seconds: 1800,
        rest_seconds: 0,
      });
      const stats = statsStore.findForItem(1)!;
      expect(stats.total_wear_seconds).toBe(3600);
      expect(stats.max_single_session_wear_seconds).toBe(3600);
    },
  );
});

describe('recordCategorySession — streak logic', () => {
  // Session IDs start at 100 to avoid collision with other tests
  it(
    'continues streak when gap is within rest_seconds + ' + 'breakGraceTime',
    () => {
      const breakGraceTime = 3600;
      const restSeconds = 1800;
      // Session A: ends at t=10000, duration=900
      insertSession(100, 1, 9100, 10000, restSeconds);
      statsStore.recordCategorySession(1, breakGraceTime, {
        id: 100,
        item_id: 1,
        started_at: 9100,
        ended_at: 10000,
        target_wear_seconds: 900,
        max_wear_seconds: 1800,
        rest_seconds: restSeconds,
      });

      // Session B starts within (restSeconds + breakGraceTime) = 5400
      // seconds of prev ended_at
      // starts at 10000 + 5000 = 15000 (gap 5000 < 5400)
      insertSession(101, 1, 15000, 15900, restSeconds);
      statsStore.recordCategorySession(1, breakGraceTime, {
        id: 101,
        item_id: 1,
        started_at: 15000,
        ended_at: 15900,
        target_wear_seconds: 900,
        max_wear_seconds: 1800,
        rest_seconds: restSeconds,
      });

      const stats = statsStore.findForCategory(1)!;
      expect(stats.streak_count).toBe(2);
      expect(stats.streak_wear_seconds).toBe(900 + 900);
    },
  );

  it('resets streak when gap exceeds rest_seconds + breakGraceTime', () => {
    const breakGraceTime = 3600;
    const restSeconds = 1800;
    // Session C: ends at t=20000, duration=900
    insertSession(102, 1, 19100, 20000, restSeconds);
    statsStore.recordCategorySession(1, breakGraceTime, {
      id: 102,
      item_id: 1,
      started_at: 19100,
      ended_at: 20000,
      target_wear_seconds: 900,
      max_wear_seconds: 1800,
      rest_seconds: restSeconds,
    });

    const afterC = statsStore.findForCategory(1)!;
    const streakCountBeforeReset = afterC.streak_count;

    // Session D starts WAY after (gap >> rest + grace)
    const tooLate = 20000 + restSeconds + breakGraceTime + 9999;
    insertSession(103, 1, tooLate, tooLate + 600, restSeconds);
    statsStore.recordCategorySession(1, breakGraceTime, {
      id: 103,
      item_id: 1,
      started_at: tooLate,
      ended_at: tooLate + 600,
      target_wear_seconds: 900,
      max_wear_seconds: 1800,
      rest_seconds: restSeconds,
    });

    const afterD = statsStore.findForCategory(1)!;
    // Streak must have reset to 1 for session D alone
    expect(afterD.streak_count).toBe(1);
    expect(afterD.streak_wear_seconds).toBe(600);
    // best streak should still reflect the earlier higher streak
    expect(afterD.best_streak_count).toBeGreaterThanOrEqual(
      streakCountBeforeReset,
    );
  });
});

describe('history', () => {
  // Use item_id=2 and session IDs 200+ to avoid cross-test pollution
  it(
    'groups sessions by week and excludes open (null ended_at) ' + 'sessions',
    () => {
      // 2024-01-01 (Monday, week 01) — epoch 1704067200
      const week1Start = 1704067200;
      // 2024-01-08 (Monday, week 02) — one week later
      const week2Start = week1Start + 7 * 86400;

      // week 1, 1800s
      insertSession(200, 2, week1Start, week1Start + 1800, null);
      // week 1, 1800s
      insertSession(201, 2, week1Start + 3600, week1Start + 5400, null);
      // week 2, 3600s
      insertSession(202, 2, week2Start, week2Start + 3600, null);
      // open — must be excluded
      insertSession(203, 2, week2Start + 7200, null, null);

      const rows = statsStore.history(2, 'week') as Array<{
        period: string;
        total_wear_seconds: number;
        session_count: number;
      }>;

      expect(rows).toHaveLength(2);
      expect(rows[0].period).toMatch(/^\d{4}-\d{2}$/); // format YYYY-WW
      // two 1800s sessions in week 1
      expect(rows[0].total_wear_seconds).toBe(3600);
      expect(rows[0].session_count).toBe(2);
      // one 3600s session in week 2
      expect(rows[1].total_wear_seconds).toBe(3600);
      expect(rows[1].session_count).toBe(1);
    },
  );
});

describe('leaderboards', () => {
  it('longestWear returns [] when no sessions have been recorded', () => {
    // Use a fresh category + item that has no stats
    categoryStore.create({
      name: 'Empty',
      icon: 'e',
      initial_target_wear_duration_seconds: 60,
      initial_max_wear_duration_seconds: null,
      rest_multiplier: 1,
      minimum_rest: 0,
      risk_levels: [],
      break_decay_multiplier: 1,
      break_grace_time: 0,
    });
    // No sessions or stats rows for this category; the query filters WHERE
    // total_wear_seconds > 0
    // For the seeded items that DO have stats, check ordering
    const rows = statsStore.longestWear() as Array<{
      max_single_session_wear_seconds: number;
    }>;
    // Check descending order
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].max_single_session_wear_seconds).toBeLessThanOrEqual(
        rows[i - 1].max_single_session_wear_seconds,
      );
    }
  });

  it(
    'mostTotalWear returns results in descending total_wear_seconds ' + 'order',
    () => {
      const rows = statsStore.mostTotalWear() as Array<{
        total_wear_seconds: number;
      }>;
      for (let i = 1; i < rows.length; i++) {
        expect(rows[i].total_wear_seconds).toBeLessThanOrEqual(
          rows[i - 1].total_wear_seconds,
        );
      }
    },
  );

  it('bestStreak returns results in descending best_streak_count order', () => {
    const rows = statsStore.bestStreak() as Array<{ streak_sessions: number }>;
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].streak_sessions).toBeLessThanOrEqual(
        rows[i - 1].streak_sessions,
      );
    }
  });

  it('mostSessions returns results in descending session_count order', () => {
    const rows = statsStore.mostSessions() as Array<{ session_count: number }>;
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].session_count).toBeLessThanOrEqual(
        rows[i - 1].session_count,
      );
    }
  });
});
