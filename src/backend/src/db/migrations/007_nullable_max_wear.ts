import { dbExport } from '../index.js'

export default function runMigration007() {
  dbExport.exec(`
    CREATE TABLE sessions_new (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id              INTEGER NOT NULL REFERENCES items(id),
      started_at           INTEGER NOT NULL,
      ended_at             INTEGER,
      target_wear_seconds  INTEGER NOT NULL DEFAULT 0,
      max_wear_seconds     INTEGER,
      rest_seconds         INTEGER,
      ended_in_injury      INTEGER NOT NULL DEFAULT 0
    );

    INSERT INTO sessions_new
      SELECT id, item_id, started_at, ended_at, target_wear_seconds,
             max_wear_seconds, rest_seconds, ended_in_injury
      FROM sessions;

    DROP TABLE sessions;
    ALTER TABLE sessions_new RENAME TO sessions;
  `)
}
