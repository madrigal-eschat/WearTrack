import { dbExport } from '../index.js'

export default function runMigration012() {
  dbExport.exec('DROP TABLE IF EXISTS mqtt_config;')
}
