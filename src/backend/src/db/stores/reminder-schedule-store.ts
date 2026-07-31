import db from '../index.js'

export interface ReminderSchedule {
  id: number;
  category_id: number;
  remind_each_seconds: number;
  text: string;
}

export interface ReminderScheduleCreate {
  category_id: number;
  remind_each_seconds: number;
  text: string;
}

export type ReminderScheduleUpdate = Partial<
  Omit<ReminderScheduleCreate, 'category_id'>
>;

class ReminderScheduleStore {
  findAllForCategory(categoryId: number): ReminderSchedule[] {
    return db
      .prepare(
        'SELECT * FROM reminder_schedules WHERE category_id = ? ORDER BY id',
      )
      .all(categoryId) as ReminderSchedule[]
  }

  find(id: number): ReminderSchedule | undefined {
    return db
      .prepare('SELECT * FROM reminder_schedules WHERE id = ?')
      .get(id) as ReminderSchedule | undefined
  }

  create(data: ReminderScheduleCreate): ReminderSchedule {
    const result = db
      .prepare(
        `INSERT INTO reminder_schedules
           (category_id, remind_each_seconds, text)
         VALUES (?, ?, ?)`,
      )
      .run(data.category_id, data.remind_each_seconds, data.text)
    return this.find(result.lastInsertRowid as number)!
  }

  update(id: number, data: ReminderScheduleUpdate): ReminderSchedule {
    const ALLOWED_COLUMNS = new Set(['remind_each_seconds', 'text'])
    const entries = Object.entries(data).filter(([k]) =>
      ALLOWED_COLUMNS.has(k),
    )
    const setClauses = entries.map(([k]) => `${k} = ?`).join(', ')
    db.prepare(
      `UPDATE reminder_schedules SET ${setClauses} WHERE id = ?`,
    ).run(...entries.map(([, v]) => v), id)
    return this.find(id)!
  }

  delete(id: number): void {
    db.prepare('DELETE FROM reminder_schedules WHERE id = ?').run(id)
  }
}

export const reminderScheduleStore = new ReminderScheduleStore()
