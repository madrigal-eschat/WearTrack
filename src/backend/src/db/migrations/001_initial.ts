import { dbExport } from '../index.js';

export default function runMigration() {
  dbExport.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      schema_version INTEGER PRIMARY KEY,
      applied_at     TEXT NOT NULL,
      name           TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS categories (
      id                            INTEGER PRIMARY KEY AUTOINCREMENT,
      name                          TEXT(100) NOT NULL,
      icon                          TEXT NOT NULL,              -- SF Symbols name (e.g. "figure.walk")
      initial_wear_duration_seconds INTEGER NOT NULL,           -- T0: wear credit assigned at the start of a fresh session
      rest_multiplier               REAL NOT NULL,              -- m in rest = m × wear + c
      rest_constant_seconds         REAL NOT NULL,              -- c in rest = m × wear + c (e.g. 86400 = 24 h minimum)
      risk_levels                   TEXT NOT NULL,              -- JSON: [{lower, upper, text, severity}] sorted ascending
      break_decay_multiplier        REAL NOT NULL,              -- exponential base for wear decay after a long break (e.g. 0.75)
      break_starts_after_seconds    INTEGER NOT NULL            -- break length beyond rest window before decay applies
    );

    CREATE TABLE IF NOT EXISTS items (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id           INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
      name                  TEXT(100) NOT NULL,
      color                 TEXT NOT NULL,                      -- hex colour for UI (e.g. "#ff0000")
      difficulty_multiplier REAL NOT NULL DEFAULT 1.0          -- scales wear accumulation; >1.0 = harder/more demanding
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id                      INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id                 INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      started_at              INTEGER NOT NULL,                 -- unix timestamp
      ended_at                INTEGER,                         -- unix timestamp; null while session is active
      calculated_wear_seconds INTEGER NOT NULL DEFAULT 0,      -- wear credit carried into this session, grows with elapsed time
      calculated_rest_seconds INTEGER,                         -- required rest after ending; null while still active
      ended_in_injury         INTEGER NOT NULL DEFAULT 0       -- 1 if user reported an injury when ending this session
    );

    CREATE TABLE IF NOT EXISTS injuries (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id     INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      occurred_at INTEGER NOT NULL,                            -- unix timestamp when injury was reported
      healed_at   INTEGER,                                     -- unix timestamp; null until user reports healed
      severity    INTEGER NOT NULL                             -- 1–5, derived from the risk_levels band at time of injury
    );

    CREATE TABLE IF NOT EXISTS stats (
      item_id                         INTEGER PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
      total_wear_seconds              INTEGER NOT NULL DEFAULT 0,   -- lifetime cumulative wear across all sessions
      session_count                   INTEGER NOT NULL DEFAULT 0,   -- total number of completed sessions
      max_single_session_wear_seconds INTEGER NOT NULL DEFAULT 0,   -- highest wear recorded in any single session
      streak_wear_seconds             INTEGER NOT NULL DEFAULT 0,   -- total wear in the current unbroken streak
      streak_count                    INTEGER NOT NULL DEFAULT 0,   -- number of sessions in the current streak
      best_streak_wear_seconds        INTEGER NOT NULL DEFAULT 0,   -- all-time best streak measured by wear seconds
      best_streak_count               INTEGER NOT NULL DEFAULT 0    -- session count of the all-time best streak
    );
  `);
}
