import db from '../db/index.js';

class NotificationStore {
  getSubscription(): string | null {
    const row = db.prepare('SELECT subscription_json FROM push_subscriptions LIMIT 1').get() as
      | { subscription_json: string }
      | undefined;
    return row?.subscription_json ?? null;
  }

  upsertSubscription(json: string): void {
    db.prepare('DELETE FROM push_subscriptions').run();
    db.prepare('INSERT INTO push_subscriptions (subscription_json, created_at) VALUES (?, ?)').run(
      json,
      Math.floor(Date.now() / 1000),
    );
  }

  deleteSubscription(): void {
    db.prepare('DELETE FROM push_subscriptions').run();
  }
}

export const notificationStore = new NotificationStore();
