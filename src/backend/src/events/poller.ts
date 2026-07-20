import { categoryStore } from '../db/stores/category-store.js';
import { sessionStore } from '../db/stores/session-store.js';
import { computeDecay } from '../db/calculations.js';
import { eventBus } from './bus.js';
import { eventPollerStore, type EventPollerRow } from './store.js';

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function defaultRow(categoryId: number): EventPollerRow {
  return {
    category_id: categoryId,
    decay_state: 'none',
    resting: 0,
    halfway_notified: 0,
    decay_soon_notified: 0,
    last_session_id: null,
    target_met_notified: 0,
    overtime_warning_30_notified: 0,
    overtime_warning_5_notified: 0,
    overtime_notified: 0,
  };
}

export function tick(now: number = nowSeconds()): void {
  const categories = categoryStore.findAll();
  const openSessions = sessionStore.findOpenWithItemData();
  const openByCategory = new Map(openSessions.map((s) => [s.category_id, s]));

  for (const category of categories) {
    const previous = sessionStore.findLastEndedInCategory(category.id) ?? null;
    const session = openByCategory.get(category.id) ?? null;
    const stored = eventPollerStore.get(category.id);
    const isFirstRun = stored === undefined;
    const row: EventPollerRow = stored ?? defaultRow(category.id);
    const shouldEmit = !isFirstRun;

    if (previous && !session) {
      const restEnd = previous.ended_at + previous.rest_seconds;
      const resting = now < restEnd ? 1 : 0;
      const decay = computeDecay(previous, category, now);

      if (shouldEmit && row.resting === 0 && resting === 1) {
        eventBus.emit('rest_start', {
          category_id: category.id,
          category_name: category.name,
          timestamp: now,
          rest_seconds: previous.rest_seconds,
        });
      }
      if (shouldEmit && row.resting === 1 && resting === 0) {
        eventBus.emit('rest_end', {
          category_id: category.id,
          category_name: category.name,
          timestamp: now,
          rest_seconds: previous.rest_seconds,
          elapsed_rest_seconds: now - previous.ended_at,
        });
      }
      if (resting === 1 && row.resting === 0) {
        row.halfway_notified = 0;
        row.decay_soon_notified = 0;
      }
      row.resting = resting;

      if (shouldEmit && row.decay_state === 'none' && decay.decay_state !== 'none') {
        eventBus.emit('decay_start', {
          category_id: category.id,
          category_name: category.name,
          timestamp: now,
          decay_state: decay.decay_state as 'decaying' | 'fully_decayed',
          decay_full_time: decay.decay_full_time!,
        });
      }
      if (shouldEmit && row.decay_state !== 'fully_decayed' && decay.decay_state === 'fully_decayed') {
        eventBus.emit('decay_finish', {
          category_id: category.id,
          category_name: category.name,
          timestamp: now,
          decay_state: 'fully_decayed',
        });
      }
      row.decay_state = decay.decay_state;

      const decayStart = decay.decay_start_time!;
      const halfway = Math.floor((restEnd + decayStart) / 2);
      const decaySoonFire = decayStart - 3600;
      const decaySoonSuppressed =
        decaySoonFire < restEnd + 3600 || Math.abs(decaySoonFire - halfway) < 1800;

      if (row.halfway_notified === 0 && now >= halfway) {
        if (shouldEmit) {
          eventBus.emit('halfway_reached', { category_id: category.id, category_name: category.name, timestamp: now });
        }
        row.halfway_notified = 1;
      }

      if (!decaySoonSuppressed && row.decay_soon_notified === 0 && now >= decaySoonFire) {
        if (shouldEmit) {
          eventBus.emit('decay_soon', { category_id: category.id, category_name: category.name, timestamp: now });
        }
        row.decay_soon_notified = 1;
      }
    }

    if (session) {
      if (row.last_session_id !== session.id) {
        row.last_session_id = session.id;
        row.target_met_notified = 0;
        row.overtime_warning_30_notified = 0;
        row.overtime_warning_5_notified = 0;
        row.overtime_notified = 0;
      }

      if (row.target_met_notified === 0 && now >= session.started_at + session.target_wear_seconds) {
        if (shouldEmit) {
          eventBus.emit('target_met', {
            category_id: category.id, category_name: category.name, timestamp: now, session_id: session.id,
          });
        }
        row.target_met_notified = 1;
      }

      if (session.max_wear_seconds !== null) {
        const fire30 = session.started_at + session.max_wear_seconds - 1800;
        const fire5 = session.started_at + session.max_wear_seconds - 300;
        const fireOvertime = session.started_at + session.max_wear_seconds;
        const suppressed30 = fire30 <= session.started_at + 300;
        const suppressed5 = fire5 <= session.started_at + 300;

        if (!suppressed30 && row.overtime_warning_30_notified === 0 && now >= fire30) {
          if (shouldEmit) {
            eventBus.emit('overtime_warning_30', {
              category_id: category.id, category_name: category.name, timestamp: now, session_id: session.id,
            });
          }
          row.overtime_warning_30_notified = 1;
        }
        if (!suppressed5 && row.overtime_warning_5_notified === 0 && now >= fire5) {
          if (shouldEmit) {
            eventBus.emit('overtime_warning_5', {
              category_id: category.id, category_name: category.name, timestamp: now, session_id: session.id,
            });
          }
          row.overtime_warning_5_notified = 1;
        }
        if (row.overtime_notified === 0 && now >= fireOvertime) {
          if (shouldEmit) {
            eventBus.emit('overtime', {
              category_id: category.id, category_name: category.name, timestamp: now, session_id: session.id,
            });
          }
          row.overtime_notified = 1;
        }
      }
    }

    eventPollerStore.upsert(row);
  }
}

export function startEventsPoller(): void {
  tick();
  if (process.env.NODE_ENV !== 'test') {
    setInterval(() => tick(), 30_000);
  }
}
