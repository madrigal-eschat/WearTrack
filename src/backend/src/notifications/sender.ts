import webpush from 'web-push'

const vapidPublicKey = process.env.VAPID_PUBLIC_KEY ?? null
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY ?? null
const vapidSubject = process.env.VAPID_SUBJECT ?? null

export const isConfigured =
  vapidPublicKey !== null && vapidPrivateKey !== null && vapidSubject !== null

if (isConfigured) {
  webpush.setVapidDetails(vapidSubject!, vapidPublicKey!, vapidPrivateKey!)
}

export function getPublicKey(): string | null {
  return vapidPublicKey
}

export async function send(
  subscriptionJson: string,
  payload: { title: string; body: string; tag: string },
): Promise<void> {
  const subscription = JSON.parse(subscriptionJson) as webpush.PushSubscription
  await webpush.sendNotification(subscription, JSON.stringify(payload))
}
