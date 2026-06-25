import { notificationStore } from './store.js';
import { computeDueNotifications } from './scheduler.js';
import { send, isConfigured } from './sender.js';

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export async function tick(): Promise<void> {
  const subscription = notificationStore.getSubscription();
  if (!subscription) return;

  const states = notificationStore.getSchedulerState();
  const sessionIds = states.flatMap(s =>
    [s.previous?.id, s.session?.id].filter((id): id is number => id !== undefined),
  );
  const alreadySent = notificationStore.getSentForSessions(sessionIds);
  const due = computeDueNotifications(states, alreadySent, nowSeconds());

  for (const notification of due) {
    const inserted = notificationStore.tryMarkSent(notification.session_id, notification.type, nowSeconds());
    if (!inserted) continue;
    try {
      await send(subscription, { title: notification.title, body: notification.body, tag: notification.tag });
    } catch (e: unknown) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 410 || status === 404) {
        notificationStore.deleteSubscription();
        return;
      }
      console.error(`[notifications] Failed to send ${notification.type} for session ${notification.session_id}:`, e);
    }
  }
}

export function startScheduler(): void {
  if (!isConfigured) {
    console.warn('[notifications] VAPID env vars not set — push notifications disabled');
    return;
  }
  void tick();
  setInterval(() => void tick(), 30_000);
}
