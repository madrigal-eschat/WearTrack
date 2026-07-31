import { dbExport } from '../index.js'

export default function runMigration013() {
  dbExport.exec('DROP TABLE IF EXISTS mqtt_config;')
}
