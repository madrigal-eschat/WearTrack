import { describe, it, expect, beforeAll } from 'vitest'
import { dbExport } from '../../src/db/index.js'
import { runMigrations } from '../../src/db/migrations/index.js'

beforeAll(() => {
  runMigrations()
})

describe('migration 010', () => {
  it('creates mqtt_config table with all columns', () => {
    const cols = (
      dbExport.prepare('PRAGMA table_info(mqtt_config)').all() as Array<{
        name: string;
      }>
    ).map((r) => r.name)
    expect(cols).toEqual(
      expect.arrayContaining([
        'id',
        'enabled',
        'host',
        'port',
        'username',
        'password',
        'topic_prefix',
        'ha_discovery_enabled',
      ]),
    )
  })

  it('only allows a single row (id = 1)', () => {
    dbExport
      .prepare(
        `INSERT INTO mqtt_config
         (id, enabled, host, port, username, password,
          topic_prefix, ha_discovery_enabled)
       VALUES (1, 0, NULL, 1883, NULL, NULL, 'weartrack', 0)`,
      )
      .run()
    expect(() =>
      dbExport
        .prepare(
          `INSERT INTO mqtt_config
           (id, enabled, host, port, username, password,
            topic_prefix, ha_discovery_enabled)
         VALUES (2, 0, NULL, 1883, NULL, NULL, 'weartrack', 0)`,
        )
        .run(),
    ).toThrow()
  })
})
