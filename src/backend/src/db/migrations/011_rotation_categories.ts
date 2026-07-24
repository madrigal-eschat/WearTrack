import { dbExport } from '../index.js'

export default function runMigration011() {
  dbExport.exec(`
    ALTER TABLE categories ADD COLUMN type TEXT NOT NULL DEFAULT 'duration';
    ALTER TABLE categories ADD COLUMN consecutive_wear_days
      INTEGER NOT NULL DEFAULT 1;
  `)
}
