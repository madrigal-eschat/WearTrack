import { dbExport } from '../index.js';

export default function runMigration005() {
  dbExport.exec(`
    CREATE TABLE push_subscriptions (
      id                INTEGER PRIMARY KEY,
      subscription_json TEXT NOT NULL,
      created_at        INTEGER NOT NULL
    );

    CREATE TABLE sent_notifications (
      id         INTEGER PRIMARY KEY,
      session_id INTEGER NOT NULL,
      type       TEXT NOT NULL,
      sent_at    INTEGER NOT NULL,
      UNIQUE (session_id, type)
    );
  `);
}
