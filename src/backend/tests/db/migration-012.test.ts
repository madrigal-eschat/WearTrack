import { describe, it, expect, beforeAll } from 'vitest'
import { dbExport } from '../../src/db/index.js'
import { runMigrations } from '../../src/db/migrations/index.js'

beforeAll(() => {
  runMigrations()
})

describe('migration 012', () => {
  it('drops the mqtt_config table', () => {
    const row = dbExport
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND " +
          "name = 'mqtt_config'",
      )
      .get()
    expect(row).toBeUndefined()
  })
})
