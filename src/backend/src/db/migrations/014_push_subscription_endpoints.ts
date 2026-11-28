import { dbExport } from '../index.js'

export default function runMigration014() {
  dbExport.transaction(() => {
    dbExport.exec(`
      DELETE FROM push_subscriptions
      WHERE id NOT IN (
        SELECT MAX(id) FROM push_subscriptions
        GROUP BY json_extract(subscription_json, '$.endpoint')
      );

      CREATE UNIQUE INDEX IF NOT EXISTS push_subscriptions_endpoint
        ON push_subscriptions (json_extract(subscription_json, '$.endpoint'));
    `)
  })()
}
