import { dbExport } from '../index.js';

export default function runMigration009() {
  dbExport.exec(`
    DROP TABLE IF EXISTS sent_notifications;

    CREATE TABLE event_poller_state (
      category_id                  INTEGER PRIMARY KEY REFERENCES categories(id) ON DELETE CASCADE,
      decay_state                  TEXT NOT NULL DEFAULT 'none',
      resting                      INTEGER NOT NULL DEFAULT 0,
      halfway_notified             INTEGER NOT NULL DEFAULT 0,
      decay_soon_notified          INTEGER NOT NULL DEFAULT 0,
      last_session_id              INTEGER,
      target_met_notified          INTEGER NOT NULL DEFAULT 0,
      overtime_warning_30_notified INTEGER NOT NULL DEFAULT 0,
      overtime_warning_5_notified  INTEGER NOT NULL DEFAULT 0,
      overtime_notified            INTEGER NOT NULL DEFAULT 0
    );
  `);
}
