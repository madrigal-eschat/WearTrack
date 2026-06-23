import { dbExport } from '../index.js';

export default function runMigration004() {
  dbExport.exec(`
    ALTER TABLE categories DROP COLUMN initial_wear_duration_seconds;
    ALTER TABLE categories DROP COLUMN rest_constant_seconds;
  `);
}
