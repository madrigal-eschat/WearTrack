import { dbExport } from '../index.js';

export default function runMigration003() {
  dbExport.exec(`
    ALTER TABLE categories ADD COLUMN initial_target_wear_duration_seconds INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE categories ADD COLUMN initial_max_wear_duration_seconds INTEGER;
    ALTER TABLE categories ADD COLUMN break_grace_time INTEGER NOT NULL DEFAULT 86400;
    ALTER TABLE categories ADD COLUMN minimum_rest REAL NOT NULL DEFAULT 0;

    UPDATE categories SET
      initial_max_wear_duration_seconds    = initial_wear_duration_seconds,
      initial_target_wear_duration_seconds = CAST(initial_wear_duration_seconds * 2 / 3 AS INTEGER),
      minimum_rest                         = rest_constant_seconds,
      break_decay_multiplier               = 0.91;

    ALTER TABLE categories DROP COLUMN break_starts_after_seconds;

    ALTER TABLE sessions RENAME COLUMN calculated_wear_seconds TO max_wear_seconds;
    ALTER TABLE sessions ADD COLUMN target_wear_seconds INTEGER NOT NULL DEFAULT 0;
    UPDATE sessions SET target_wear_seconds = CAST(max_wear_seconds * 2 / 3 AS INTEGER);
    ALTER TABLE sessions RENAME COLUMN calculated_rest_seconds TO rest_seconds;
  `);
}
