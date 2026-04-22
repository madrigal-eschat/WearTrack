import { dbExport } from '../index.js';
import runMigration001 from './001_initial.js';

const migrations: Array<{ version: number; name: string; run: () => void }> = [
  { version: 1, name: '001_initial', run: runMigration001 },
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
