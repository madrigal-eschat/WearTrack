import { describe, it, expect, beforeAll } from 'vitest';
import { dbExport } from '../../src/db/index.js';
import runMigration001 from '../../src/db/migrations/001_initial.js';
import runMigration005 from '../../src/db/migrations/005_push_notifications.js';

beforeAll(() => {
  runMigration001();
  runMigration005();
});

describe('migration 005', () => {
  it('creates push_subscriptions table', () => {
    const row = dbExport
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type='table' AND name='push_subscriptions'`,
      )
      .get();
    expect(row).toBeDefined();
  });

  it('push_subscriptions has subscription_json and created_at', () => {
    const cols = (
      dbExport.prepare('PRAGMA table_info(push_subscriptions)').all() as Array<{
        name: string;
      }>
    ).map((r) => r.name);
    expect(cols).toContain('subscription_json');
    expect(cols).toContain('created_at');
  });

  it('creates sent_notifications table', () => {
    const row = dbExport
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type='table' AND name='sent_notifications'`,
      )
      .get();
    expect(row).toBeDefined();
  });

  it('sent_notifications has session_id, type, sent_at', () => {
    const cols = (
      dbExport.prepare('PRAGMA table_info(sent_notifications)').all() as Array<{
        name: string;
      }>
    ).map((r) => r.name);
    expect(cols).toContain('session_id');
    expect(cols).toContain('type');
    expect(cols).toContain('sent_at');
  });

  it('sent_notifications enforces unique (session_id, type)', () => {
    dbExport
      .prepare(
        'INSERT INTO sent_notifications (session_id, type, sent_at) ' +
          "VALUES (1, 'rest_end', 100)",
      )
      .run();
    expect(() =>
      dbExport
        .prepare(
          'INSERT INTO sent_notifications (session_id, type, sent_at) ' +
            "VALUES (1, 'rest_end', 200)",
        )
        .run(),
    ).toThrow();
  });
});
