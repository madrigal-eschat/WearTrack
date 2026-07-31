import { dbExport } from '../index.js'

export default function runMigration013() {
  dbExport.exec(`
    CREATE TABLE reminder_schedules (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id         INTEGER NOT NULL
        REFERENCES categories(id) ON DELETE CASCADE,
      remind_each_seconds INTEGER NOT NULL,
      text                TEXT NOT NULL
    );

    CREATE TABLE reminder_state (
      session_id  INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      schedule_id INTEGER NOT NULL
        REFERENCES reminder_schedules(id) ON DELETE CASCADE,
      fired_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (session_id, schedule_id)
    );
  `)
}
