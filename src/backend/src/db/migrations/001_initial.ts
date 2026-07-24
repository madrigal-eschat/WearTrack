import { dbExport } from '../index.js'

export default function runMigration() {
  dbExport.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      schema_version INTEGER PRIMARY KEY,
      applied_at     TEXT NOT NULL,
      name           TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS categories (
      id   INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT(100) NOT NULL,
      -- SF Symbols name (e.g. "figure.walk")
      icon TEXT NOT NULL,
      -- T0: wear credit assigned at the start of a fresh session
      initial_wear_duration_seconds INTEGER NOT NULL,
      -- m in rest = m × wear + c
      rest_multiplier REAL NOT NULL,
      -- c in rest = m × wear + c (e.g. 86400 = 24 h minimum)
      rest_constant_seconds REAL NOT NULL,
      -- JSON: [{lower, upper, text, severity}] sorted ascending
      risk_levels TEXT NOT NULL,
      -- exponential base for wear decay after a long break (e.g. 0.75)
      break_decay_multiplier REAL NOT NULL,
      -- break length beyond rest window before decay applies
      break_starts_after_seconds INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS items (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id  INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
      name         TEXT(100) NOT NULL,
      -- hex colour for UI (e.g. "#ff0000")
      color TEXT NOT NULL,
      -- scales wear accumulation; >1.0 = harder/more demanding
      difficulty_multiplier REAL NOT NULL DEFAULT 1.0
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id      INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      -- unix timestamp
      started_at INTEGER NOT NULL,
      -- unix timestamp; null while session is active
      ended_at INTEGER,
      -- wear credit carried into this session, grows with elapsed time
      calculated_wear_seconds INTEGER NOT NULL DEFAULT 0,
      -- required rest after ending; null while still active
      calculated_rest_seconds INTEGER,
      -- 1 if user reported an injury when ending this session
      ended_in_injury INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS injuries (
      id      INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      -- unix timestamp when injury was reported
      occurred_at INTEGER NOT NULL,
      -- unix timestamp; null until user reports healed
      healed_at INTEGER,
      -- 1–5, derived from the risk_levels band at time of injury
      severity INTEGER NOT NULL
    );

    -- Per-item cumulative stats (no streak — streaks are tracked at
    -- category level)
    CREATE TABLE IF NOT EXISTS stats (
      item_id INTEGER PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
      -- lifetime cumulative wear across all sessions
      total_wear_seconds INTEGER NOT NULL DEFAULT 0,
      -- total number of completed sessions
      session_count INTEGER NOT NULL DEFAULT 0,
      -- highest wear recorded in any single session
      max_single_session_wear_seconds INTEGER NOT NULL DEFAULT 0
    );

    -- Per-category cumulative stats including streak tracking across all items
    CREATE TABLE IF NOT EXISTS category_stats (
      category_id INTEGER PRIMARY KEY
        REFERENCES categories(id) ON DELETE CASCADE,
      -- sum of wear across all items in this category
      total_wear_seconds INTEGER NOT NULL DEFAULT 0,
      -- total sessions across all items
      session_count INTEGER NOT NULL DEFAULT 0,
      -- highest single-session wear across all items
      max_single_session_wear_seconds INTEGER NOT NULL DEFAULT 0,
      -- total wear in the current unbroken streak (any item)
      streak_wear_seconds INTEGER NOT NULL DEFAULT 0,
      -- number of sessions in the current streak
      streak_count INTEGER NOT NULL DEFAULT 0,
      -- all-time best streak measured by wear seconds
      best_streak_wear_seconds INTEGER NOT NULL DEFAULT 0,
      -- session count of the all-time best streak
      best_streak_count INTEGER NOT NULL DEFAULT 0
    );
  `)
}
