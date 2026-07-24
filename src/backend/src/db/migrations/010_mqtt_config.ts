import { dbExport } from '../index.js'

export default function runMigration010() {
  dbExport.exec(`
    CREATE TABLE mqtt_config (
      id                   INTEGER PRIMARY KEY CHECK (id = 1),
      enabled              INTEGER NOT NULL DEFAULT 0,
      host                 TEXT,
      port                 INTEGER NOT NULL DEFAULT 1883,
      username             TEXT,
      password             TEXT,
      topic_prefix         TEXT NOT NULL DEFAULT 'weartrack',
      ha_discovery_enabled INTEGER NOT NULL DEFAULT 0
    );
  `)
}
