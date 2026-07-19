import { dbExport } from '../index.js';
import runMigration001 from './001_initial.js';
import runMigration002 from './002_oklch_colors.js';
import runMigration003 from './003_target_max_wear.js';
import runMigration004 from './004_drop_legacy_columns.js';
import runMigration005 from './005_push_notifications.js';
import runMigration006 from './006_fix_best_streak_count.js';
import runMigration007 from './007_nullable_max_wear.js';
import runMigration008 from './008_session_day_index.js';
import runMigration009 from './009_events_bus.js';
import runMigration010 from './010_mqtt_config.js';
import runMigration011 from './011_rotation_categories.js';

const migrations: Array<{ version: number; name: string; run: () => void }> = [
  { version: 1, name: '001_initial', run: runMigration001 },
  { version: 2, name: '002_oklch_colors', run: runMigration002 },
  { version: 3, name: '003_target_max_wear', run: runMigration003 },
  { version: 4, name: '004_drop_legacy_columns', run: runMigration004 },
  { version: 5, name: '005_push_notifications', run: runMigration005 },
  { version: 6, name: '006_fix_best_streak_count', run: runMigration006 },
  { version: 7, name: '007_nullable_max_wear', run: runMigration007 },
  { version: 8, name: '008_session_day_index', run: runMigration008 },
  { version: 9, name: '009_events_bus', run: runMigration009 },
  { version: 10, name: '010_mqtt_config', run: runMigration010 },
  { version: 11, name: '011_rotation_categories', run: runMigration011 },
];

export function runMigrations() {
  dbExport.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      schema_version INTEGER PRIMARY KEY,
      applied_at     TEXT NOT NULL,
      name           TEXT NOT NULL
    );
  `);

  const current = (
    dbExport.prepare('SELECT MAX(schema_version) as v FROM meta').get() as { v: number | null }
  ).v ?? 0;

  for (const migration of migrations) {
    if (migration.version > current) {
      migration.run();
      dbExport
        .prepare('INSERT OR REPLACE INTO meta (schema_version, applied_at, name) VALUES (?, ?, ?)')
        .run(migration.version, new Date().toISOString(), migration.name);
    }
  }
}

export default runMigrations;
