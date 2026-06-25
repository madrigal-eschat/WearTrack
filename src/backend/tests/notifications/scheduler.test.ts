// src/backend/tests/notifications/scheduler.test.ts
import { describe, it, expect } from 'vitest';
import { computeDueNotifications } from '../../src/notifications/scheduler.js';
import type { CategorySchedulerState } from '../../src/notifications/types.js';

function state(overrides: Partial<CategorySchedulerState> = {}): CategorySchedulerState {
  return {
    category_id: 1,
    category_name: 'Test',
    break_grace_time: 86400,
    previous: null,
    session: null,
    ...overrides,
  };
}

describe('computeDueNotifications', () => {
  it('returns empty array when no states', () => {
    expect(computeDueNotifications([], new Set(), 1000)).toEqual([]);
  });

  it('returns nothing for category with no history', () => {
    expect(computeDueNotifications([state()], new Set(), 1000)).toEqual([]);
  });

  describe('idle period', () => {
    it('fires rest_end when now >= rest_end', () => {
      const s = state({ previous: { id: 42, ended_at: 1000, rest_seconds: 3600 } });
      // rest_end = 4600
      const due = computeDueNotifications([s], new Set(), 4600);
      expect(due.map(d => d.type)).toContain('rest_end');
    });

    it('does not fire rest_end before rest_end time', () => {
      const s = state({ previous: { id: 42, ended_at: 1000, rest_seconds: 3600 } });
      const due = computeDueNotifications([s], new Set(), 4599);
      expect(due.map(d => d.type)).not.toContain('rest_end');
    });

    it('fires halfway at floor((rest_end + decay_start) / 2)', () => {
      // rest_end = 0, decay_start = 86400, halfway = 43200
      const s = state({ previous: { id: 42, ended_at: 0, rest_seconds: 0 }, break_grace_time: 86400 });
      const due = computeDueNotifications([s], new Set(), 43200);
      expect(due.map(d => d.type)).toContain('halfway');
    });

    it('does not fire halfway before halfway time', () => {
      const s = state({ previous: { id: 42, ended_at: 0, rest_seconds: 0 }, break_grace_time: 86400 });
      const due = computeDueNotifications([s], new Set(), 43199);
      expect(due.map(d => d.type)).not.toContain('halfway');
    });

    describe('decay_soon suppression', () => {
      it('fires normally for 24h break_grace_time', () => {
        // decay_start = 86400, fire_at = 82800; rest_end = 0
        // fire_at (82800) >= rest_end + 3600 (3600) ✓
        // |82800 - 43200| = 39600 >= 1800 ✓
        const s = state({ previous: { id: 42, ended_at: 0, rest_seconds: 0 }, break_grace_time: 86400 });
        const due = computeDueNotifications([s], new Set(), 82800);
        expect(due.map(d => d.type)).toContain('decay_soon');
      });

      it('suppressed when break_grace_time < 2h (fire_at < rest_end + 3600)', () => {
        // break_grace_time = 3600, decay_start = 3600, fire_at = 0 < rest_end (0) + 3600 = 3600
        const s = state({ previous: { id: 42, ended_at: 0, rest_seconds: 0 }, break_grace_time: 3600 });
        const due = computeDueNotifications([s], new Set(), 0);
        expect(due.map(d => d.type)).not.toContain('decay_soon');
      });

      it('suppressed when fire_at within 30 mins of halfway (2.5h grace)', () => {
        // break_grace_time = 9000, decay_start = 9000, halfway = 4500, fire_at = 5400
        // |5400 - 4500| = 900 < 1800 → suppressed
        const s = state({ previous: { id: 42, ended_at: 0, rest_seconds: 0 }, break_grace_time: 9000 });
        const due = computeDueNotifications([s], new Set(), 5400);
        expect(due.map(d => d.type)).not.toContain('decay_soon');
      });

      it('fires for exactly 3h grace time (boundary: |diff| == 1800, not suppressed)', () => {
        // break_grace_time = 10800, decay_start = 10800, halfway = 5400, fire_at = 7200
        // fire_at (7200) >= rest_end (0) + 3600 (3600) ✓
        // |7200 - 5400| = 1800 which is NOT < 1800 → not suppressed
        const s = state({ previous: { id: 42, ended_at: 0, rest_seconds: 0 }, break_grace_time: 10800 });
        const due = computeDueNotifications([s], new Set(), 7200);
        expect(due.map(d => d.type)).toContain('decay_soon');
      });
    });

    it('skips already-sent notifications', () => {
      const s = state({ previous: { id: 42, ended_at: 0, rest_seconds: 0 }, break_grace_time: 86400 });
      const alreadySent = new Set(['42:rest_end']);
      const due = computeDueNotifications([s], alreadySent, 0);
      expect(due.map(d => d.type)).not.toContain('rest_end');
    });

    it('sets correct text for rest_end', () => {
      const s = state({ category_id: 7, category_name: 'Footwear', previous: { id: 1, ended_at: 0, rest_seconds: 0 } });
      const due = computeDueNotifications([s], new Set(), 0);
      const n = due.find(d => d.type === 'rest_end')!;
      expect(n.title).toBe('Footwear wearable');
      expect(n.body).toBe('Rest period is over');
      expect(n.tag).toBe('category-7');
      expect(n.session_id).toBe(1);
    });

    it('sets correct text for halfway', () => {
      const s = state({ category_name: 'Test', previous: { id: 1, ended_at: 0, rest_seconds: 0 }, break_grace_time: 86400 });
      const due = computeDueNotifications([s], new Set(['1:rest_end']), 43200);
      const n = due.find(d => d.type === 'halfway')!;
      expect(n.title).toBe('Wear Test soon');
      expect(n.body).toBe('Your idle time is halfway up');
    });

    it('sets correct text for decay_soon', () => {
      const s = state({ category_name: 'Rings', previous: { id: 1, ended_at: 0, rest_seconds: 0 }, break_grace_time: 86400 });
      const alreadySent = new Set(['1:rest_end', '1:halfway']);
      const due = computeDueNotifications([s], alreadySent, 82800);
      const n = due.find(d => d.type === 'decay_soon')!;
      expect(n.title).toBe('Wear Rings now!');
      expect(n.body).toBe('Durations start decaying in 1 hour');
    });
  });

  describe('active session', () => {
    it('fires target_met when now >= started_at + target', () => {
      const s = state({ session: { id: 10, started_at: 1000, target_wear_seconds: 3600, max_wear_seconds: 7200 } });
      const due = computeDueNotifications([s], new Set(), 4600);
      expect(due.map(d => d.type)).toContain('target_met');
    });

    it('does not fire target_met before target time', () => {
      const s = state({ session: { id: 10, started_at: 1000, target_wear_seconds: 3600, max_wear_seconds: 7200 } });
      const due = computeDueNotifications([s], new Set(), 4599);
      expect(due.map(d => d.type)).not.toContain('target_met');
    });

    it('fires overtime_warning_30 when max > 35 mins', () => {
      // started_at=0, max=7200, fire_at=5400 > 0+300=300 ✓
      const s = state({ session: { id: 10, started_at: 0, target_wear_seconds: 3600, max_wear_seconds: 7200 } });
      const due = computeDueNotifications([s], new Set(), 5400);
      expect(due.map(d => d.type)).toContain('overtime_warning_30');
    });

    it('suppresses overtime_warning_30 when fire_at <= started_at + 300', () => {
      // started_at=0, max=2000, fire_at=200 <= 300 → suppressed
      const s = state({ session: { id: 10, started_at: 0, target_wear_seconds: 1000, max_wear_seconds: 2000 } });
      const due = computeDueNotifications([s], new Set(), 200);
      expect(due.map(d => d.type)).not.toContain('overtime_warning_30');
    });

    it('suppresses overtime_warning_30 when fire_at exactly equals started_at + 300', () => {
      // started_at=0, max=2100, fire_at=300 <= 300 → suppressed
      const s = state({ session: { id: 10, started_at: 0, target_wear_seconds: 1000, max_wear_seconds: 2100 } });
      const due = computeDueNotifications([s], new Set(), 300);
      expect(due.map(d => d.type)).not.toContain('overtime_warning_30');
    });

    it('fires overtime_warning_30 when fire_at = started_at + 301', () => {
      // started_at=0, max=2101, fire_at=301 > 300 ✓
      const s = state({ session: { id: 10, started_at: 0, target_wear_seconds: 1000, max_wear_seconds: 2101 } });
      const due = computeDueNotifications([s], new Set(), 301);
      expect(due.map(d => d.type)).toContain('overtime_warning_30');
    });

    it('suppresses overtime_warning_5 when max <= 10 mins', () => {
      // started_at=0, max=600, fire_at=300 <= 300 → suppressed
      const s = state({ session: { id: 10, started_at: 0, target_wear_seconds: 300, max_wear_seconds: 600 } });
      const due = computeDueNotifications([s], new Set(), 300);
      expect(due.map(d => d.type)).not.toContain('overtime_warning_5');
    });

    it('fires overtime when now >= started_at + max', () => {
      const s = state({ session: { id: 10, started_at: 0, target_wear_seconds: 3600, max_wear_seconds: 7200 } });
      const due = computeDueNotifications([s], new Set(), 7200);
      expect(due.map(d => d.type)).toContain('overtime');
    });

    it('does not fire any overtime notifications when max is null', () => {
      const s = state({ session: { id: 10, started_at: 0, target_wear_seconds: 3600, max_wear_seconds: null } });
      const due = computeDueNotifications([s], new Set(), 100000);
      const types = due.map(d => d.type);
      expect(types).not.toContain('overtime_warning_30');
      expect(types).not.toContain('overtime_warning_5');
      expect(types).not.toContain('overtime');
    });

    it('skips idle notifications when session is active', () => {
      // Both previous and session exist — session wins
      const s = state({
        previous: { id: 1, ended_at: 0, rest_seconds: 0 },
        session: { id: 10, started_at: 0, target_wear_seconds: 3600, max_wear_seconds: null },
      });
      const due = computeDueNotifications([s], new Set(), 0);
      expect(due.map(d => d.type)).not.toContain('rest_end');
    });

    it('uses active session id as session_id', () => {
      const s = state({ session: { id: 99, started_at: 0, target_wear_seconds: 100, max_wear_seconds: null } });
      const due = computeDueNotifications([s], new Set(), 100);
      expect(due[0].session_id).toBe(99);
    });

    it('sets correct text for active session notifications', () => {
      const s = state({
        category_id: 3,
        category_name: 'Rings',
        session: { id: 5, started_at: 0, target_wear_seconds: 100, max_wear_seconds: 7200 },
      });
      const due = computeDueNotifications([s], new Set(), 100000);
      const target = due.find(d => d.type === 'target_met')!;
      expect(target.title).toBe('Rings target reached!');
      expect(target.body).toBe('You can stop when ready');
      expect(target.tag).toBe('category-3');

      const ot30 = due.find(d => d.type === 'overtime_warning_30')!;
      expect(ot30.title).toBe('Rings: 30 minutes left');
      expect(ot30.body).toBe('End your session before overtime');

      const ot5 = due.find(d => d.type === 'overtime_warning_5')!;
      expect(ot5.title).toBe('Stop wearing Rings');
      expect(ot5.body).toBe('5 minutes until overtime');

      const ot = due.find(d => d.type === 'overtime')!;
      expect(ot.title).toBe('Stop wearing Rings now!');
      expect(ot.body).toBe('Your session is in overtime');
    });
  });

  it('handles multiple categories independently', () => {
    const states = [
      state({ category_id: 1, session: { id: 1, started_at: 0, target_wear_seconds: 100, max_wear_seconds: null } }),
      state({ category_id: 2, previous: { id: 2, ended_at: 0, rest_seconds: 0 }, break_grace_time: 86400 }),
    ];
    const due = computeDueNotifications(states, new Set(), 100);
    const types = due.map(d => d.type);
    expect(types).toContain('target_met');
    expect(types).toContain('rest_end');
  });
});
