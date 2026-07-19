import { describe, it, expect, beforeAll } from 'vitest';
import { dbExport } from '../../src/db/index.js';
import { runMigrations } from '../../src/db/migrations/index.js';

beforeAll(() => {
  runMigrations();
});

describe('migration 009', () => {
  it('creates event_poller_state table with all columns', () => {
    const cols = (
      dbExport.prepare('PRAGMA table_info(event_poller_state)').all() as Array<{ name: string }>
    ).map((r) => r.name);
    expect(cols).toEqual(
      expect.arrayContaining([
        'category_id',
        'decay_state',
        'resting',
        'halfway_notified',
        'decay_soon_notified',
        'last_session_id',
        'target_met_notified',
        'overtime_warning_30_notified',
        'overtime_warning_5_notified',
        'overtime_notified',
      ]),
    );
  });

  it('drops sent_notifications table', () => {
    const row = dbExport
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='sent_notifications'`)
      .get();
    expect(row).toBeUndefined();
  });

  it('cascades delete from categories to event_poller_state', () => {
    dbExport.exec(`
      INSERT INTO categories
        (name, icon, initial_target_wear_duration_seconds, initial_max_wear_duration_seconds,
         rest_multiplier, minimum_rest, risk_levels, break_decay_multiplier, break_grace_time)
      VALUES ('Cascade Test', 'icon', 900, 1800, 2, 86400, '[]', 0.91, 86400)
    `);
    const { id } = dbExport.prepare(`SELECT id FROM categories WHERE name = 'Cascade Test'`).get() as {
      id: number;
    };
    dbExport.prepare('INSERT INTO event_poller_state (category_id) VALUES (?)').run(id);
    dbExport.prepare('DELETE FROM categories WHERE id = ?').run(id);
    const row = dbExport.prepare('SELECT * FROM event_poller_state WHERE category_id = ?').get(id);
    expect(row).toBeUndefined();
  });
});
