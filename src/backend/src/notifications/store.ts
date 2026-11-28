import db from '../db/index.js'

export interface StoredSubscription {
  id: number;
  subscription_json: string;
}

class NotificationStore {
  getSubscriptions(): StoredSubscription[] {
    return db.prepare('SELECT id, subscription_json FROM push_subscriptions')
      .all() as StoredSubscription[]
  }

  upsertSubscription(json: string): void {
    db.prepare(`
      INSERT INTO push_subscriptions (subscription_json, created_at)
      VALUES (?, ?)
      ON CONFLICT (json_extract(subscription_json, '$.endpoint'))
      DO UPDATE SET subscription_json = excluded.subscription_json
    `).run(json, Math.floor(Date.now() / 1000))
  }

  deleteSubscription(endpoint: string): void {
    db.prepare(`
      DELETE FROM push_subscriptions
      WHERE json_extract(subscription_json, '$.endpoint') = ?
    `).run(endpoint)
  }

  deleteExpiredSubscription(subscription: StoredSubscription): void {
    db.prepare(`
      DELETE FROM push_subscriptions WHERE id = ? AND subscription_json = ?
    `).run(subscription.id, subscription.subscription_json)
  }
}

export const notificationStore = new NotificationStore()
