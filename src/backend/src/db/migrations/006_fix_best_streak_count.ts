import { dbExport } from '../index.js';

type CategoryRow = { id: number; break_grace_time: number };
type SessionRow = {
  started_at: number;
  ended_at: number;
  rest_seconds: number | null;
};

export default function runMigration006() {
  const categories = dbExport
    .prepare('SELECT id, break_grace_time FROM categories')
    .all() as CategoryRow[];

  const getSessionsStmt = dbExport.prepare<[number]>(
    `SELECT s.started_at, s.ended_at, s.rest_seconds
     FROM sessions s JOIN items i ON i.id = s.item_id
     WHERE i.category_id = ? AND s.ended_at IS NOT NULL
     ORDER BY s.ended_at ASC`,
  );

  const updateStmt = dbExport.prepare<[number, number]>(
    'UPDATE category_stats SET best_streak_count = ? WHERE category_id = ?',
  );

  for (const cat of categories) {
    const sessions = getSessionsStmt.all(cat.id) as SessionRow[];

    let streakCount = 0;
    let bestCount = 0;
    let prev: SessionRow | null = null;

    for (const s of sessions) {
      if (prev && prev.rest_seconds !== null) {
        const gap = s.started_at - prev.ended_at;
        if (gap > prev.rest_seconds + cat.break_grace_time) {
          streakCount = 0;
        }
      }
      streakCount += 1;
      if (streakCount > bestCount) {
        bestCount = streakCount;
      }
      prev = s;
    }

    updateStmt.run(bestCount, cat.id);
  }
}
