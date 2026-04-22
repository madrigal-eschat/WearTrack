import { dbExport } from '../index.js';

export default function runMigration() {
  dbExport.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      schema_version INTEGER PRIMARY KEY,
      applied_at     TEXT NOT NULL,
      name           TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS categories (
      id                     INTEGER PRIMARY KEY AUTOINCREMENT,
      name                   TEXT(100) NOT NULL,
      icon                   TEXT NOT NULL,
      initial_wear           INTEGER NOT NULL,
      rest_multiplier        REAL NOT NULL,
      rest_constant          REAL NOT NULL,
      risk_levels            TEXT NOT NULL,
      break_decay_multiplier REAL NOT NULL,
      break_penalty_period   INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS items (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
      name        TEXT(100) NOT NULL,
      color       TEXT NOT NULL,
      difficulty  REAL NOT NULL DEFAULT 1.0
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id         INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      started_at      INTEGER NOT NULL,
      ended_at        INTEGER,
      calculated_wear INTEGER NOT NULL DEFAULT 0,
      calculated_rest INTEGER,
      injury          INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS injuries (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id     INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      occurred_at INTEGER NOT NULL,
      heals_at    INTEGER,
      severity    INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS stats (
      item_id           INTEGER PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
      total_wear        INTEGER NOT NULL DEFAULT 0,
      session_count     INTEGER NOT NULL DEFAULT 0,
      max_wear          INTEGER NOT NULL DEFAULT 0,
      streak_wear       INTEGER NOT NULL DEFAULT 0,
      streak_count      INTEGER NOT NULL DEFAULT 0,
      best_streak_wear  INTEGER NOT NULL DEFAULT 0,
      best_streak_count INTEGER NOT NULL DEFAULT 0
    );
  `);
}
