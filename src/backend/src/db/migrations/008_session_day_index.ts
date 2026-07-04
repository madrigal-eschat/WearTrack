import { dbExport } from '../index.js';

export default function runMigration008() {
  dbExport.exec(`
    CREATE TABLE session_day_index (
      day         TEXT NOT NULL,
      category_id INTEGER NOT NULL REFERENCES categories(id),
      item_id     INTEGER NOT NULL REFERENCES items(id),
      UNIQUE(day, category_id, item_id)
    );
  `);
}