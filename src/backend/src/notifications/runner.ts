import { eventBus, type EventName } from '../events/bus.js';
import { send, isConfigured } from './sender.js';
import { notificationStore } from './store.js';

interface Copy {
  title: string;
  body: string;
}

function copyFor(event: EventName, categoryName: string): Copy | null {
  switch (event) {
    case 'rest_end':
      return { title: `${categoryName} wearable`, body: 'Rest period is over' };
    case 'halfway_reached':
      return { title: `Wear ${categoryName} soon`, body: 'Your idle time is halfway up' };
    case 'decay_soon':
      return { title: `Wear ${categoryName} now!`, body: 'Durations start decaying in 1 hour' };
    case 'target_met':
      return { title: `${categoryName} target reached!`, body: 'You can stop when ready' };
    case 'overtime_warning_30':
      return { title: `${categoryName}: 30 minutes left`, body: 'End your session before overtime' };
    case 'overtime_warning_5':
      return { title: `Stop wearing ${categoryName}`, body: '5 minutes until overtime' };
    case 'overtime':
      return { title: `Stop wearing ${categoryName} now!`, body: 'Your session is in overtime' };
    default:
      return null;
  }
}

const NOTIFICATION_EVENTS: EventName[] = [
  'rest_end',
  'halfway_reached',
  'decay_soon',
  'target_met',
  'overtime_warning_30',
  'overtime_warning_5',
  'overtime',
];

async function notify(event: EventName, categoryId: number, categoryName: string): Promise<void> {
  const subscription = notificationStore.getSubscription();
  if (!subscription) return;
  const copy = copyFor(event, categoryName);
  if (!copy) return;
  try {
    await send(subscription, { title: copy.title, body: copy.body, tag: `category-${categoryId}` });
  } catch (e: unknown) {
    const status = (e as { statusCode?: number }).statusCode;
    if (status === 410 || status === 404) {
      notificationStore.deleteSubscription();
      return;
    }
    console.error(`[notifications] Failed to send ${event} for category ${categoryId}:`, e);
  }
}

export function startScheduler(): void {
  if (!isConfigured) {
    console.warn('[notifications] VAPID env vars not set — push notifications disabled');
    return;
  }
  for (const event of NOTIFICATION_EVENTS) {
    eventBus.on(event, (payload) => {
      void notify(event, payload.category_id, payload.category_name);
    });
  }
}
