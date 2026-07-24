import db from '../db/index.js'
import type { DecayState } from '../db/calculations.js'

export interface EventPollerRow {
  category_id: number;
  decay_state: DecayState;
  resting: number;
  halfway_notified: number;
  decay_soon_notified: number;
  last_session_id: number | null;
  target_met_notified: number;
  overtime_warning_30_notified: number;
  overtime_warning_5_notified: number;
  overtime_notified: number;
}

class EventPollerStore {
  get(categoryId: number): EventPollerRow | undefined {
    return db
      .prepare('SELECT * FROM event_poller_state WHERE category_id = ?')
      .get(categoryId) as EventPollerRow | undefined
  }

  upsert(row: EventPollerRow): void {
    db.prepare(
      `INSERT INTO event_poller_state
         (category_id, decay_state, resting, halfway_notified,
          decay_soon_notified, last_session_id, target_met_notified,
          overtime_warning_30_notified, overtime_warning_5_notified,
          overtime_notified)
       VALUES (@category_id, @decay_state, @resting, @halfway_notified,
               @decay_soon_notified, @last_session_id,
               @target_met_notified, @overtime_warning_30_notified,
               @overtime_warning_5_notified, @overtime_notified)
       ON CONFLICT (category_id) DO UPDATE SET
         decay_state = excluded.decay_state,
         resting = excluded.resting,
         halfway_notified = excluded.halfway_notified,
         decay_soon_notified = excluded.decay_soon_notified,
         last_session_id = excluded.last_session_id,
         target_met_notified = excluded.target_met_notified,
         overtime_warning_30_notified = excluded.overtime_warning_30_notified,
         overtime_warning_5_notified = excluded.overtime_warning_5_notified,
         overtime_notified = excluded.overtime_notified`,
    ).run(row)
  }
}

export const eventPollerStore = new EventPollerStore()
