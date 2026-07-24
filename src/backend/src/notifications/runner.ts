import { eventBus, type EventName, type EventPayloads } from '../events/bus.js';
import { send, isConfigured } from './sender.js';
import { notificationStore } from './store.js';
import { formatDuration } from '../utils/time.js';

interface Copy {
  title: string;
  body: string;
}

function copyFor<E extends Exclude<EventName, 'poller_tick'>>(
  event: E,
  payload: EventPayloads[E],
): Copy | null {
  const categoryName = payload.category_name;
  switch (event) {
    case 'rest_end':
      return { title: `${categoryName} wearable`, body: 'Rest period is over' };
    case 'idle_halfway_reached': {
      const p = payload as EventPayloads['idle_halfway_reached'];
      const remaining = p.decay_start_time - p.timestamp;
      return {
        title: `Wear ${categoryName} soon`,
        body: `Durations start decaying in ${formatDuration(remaining)}`,
      };
    }
    case 'decay_soon':
      return {
        title: `Wear ${categoryName} now!`,
        body: 'Durations start decaying in 1 hour',
      };
    case 'target_met':
      return {
        title: `${categoryName} target reached!`,
        body: 'You can stop when ready',
      };
    case 'overtime_warning_30':
      return {
        title: `${categoryName}: 30 minutes left`,
        body: 'End your session before overtime',
      };
    case 'overtime_warning_5':
      return {
        title: `Stop wearing ${categoryName}`,
        body: '5 minutes until overtime',
      };
    case 'overtime':
      return {
        title: `Stop wearing ${categoryName} now!`,
        body: 'Your session is in overtime',
      };
    default:
      return null;
  }
}

const NOTIFICATION_EVENTS: Array<Exclude<EventName, 'poller_tick'>> = [
  'rest_end',
  'idle_halfway_reached',
  'decay_soon',
  'target_met',
  'overtime_warning_30',
  'overtime_warning_5',
  'overtime',
];

async function notify<E extends Exclude<EventName, 'poller_tick'>>(
  event: E,
  payload: EventPayloads[E],
): Promise<void> {
  const subscription = notificationStore.getSubscription();
  if (!subscription) {
    return;
  }
  const copy = copyFor(event, payload);
  if (!copy) {
    return;
  }
  try {
    await send(subscription, {
      title: copy.title,
      body: copy.body,
      tag: `category-${payload.category_id}`,
    });
  } catch (e: unknown) {
    const status = (e as { statusCode?: number }).statusCode;
    if (status === 410 || status === 404) {
      notificationStore.deleteSubscription();
      return;
    }
    console.error(
      `[notifications] Failed to send ${event} for category ` +
        `${payload.category_id}:`,
      e,
    );
  }
}

let started = false;

export function startScheduler(): void {
  if (!isConfigured) {
    console.warn(
      '[notifications] VAPID env vars not set — push notifications disabled',
    );
    return;
  }
  // Guard against double-registration: a second call would attach a
  // duplicate set of eventBus listeners and cause every notification to
  // be sent twice.
  if (started) {
    return;
  }
  started = true;
  for (const event of NOTIFICATION_EVENTS) {
    eventBus.on(event, (payload) => {
      void notify(event, payload);
    });
  }
}
