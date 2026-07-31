import db from '../index.js'

export interface ReminderStateRow {
  session_id: number;
  schedule_id: number;
  fired_count: number;
}

class ReminderStateStore {
  get(sessionId: number, scheduleId: number): ReminderStateRow | undefined {
    return db
      .prepare(
        'SELECT * FROM reminder_state ' +
          'WHERE session_id = ? AND schedule_id = ?',
      )
      .get(sessionId, scheduleId) as ReminderStateRow | undefined
  }

  upsert(sessionId: number, scheduleId: number, firedCount: number): void {
    db.prepare(
      `INSERT INTO reminder_state (session_id, schedule_id, fired_count)
       VALUES (?, ?, ?)
       ON CONFLICT (session_id, schedule_id) DO UPDATE SET
         fired_count = excluded.fired_count`,
    ).run(sessionId, scheduleId, firedCount)
  }
}

export const reminderStateStore = new ReminderStateStore()
