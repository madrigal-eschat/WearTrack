import { dbExport } from '../index.js';

export default function runMigration002() {
  dbExport.exec(`UPDATE items SET color = 'oklch(0.55 0.15 240)';`);
}
