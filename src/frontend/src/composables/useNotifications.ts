import { ref, onMounted } from 'vue';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

const isSupported =
  typeof window !== 'undefined' && 'Notification' in window && 'PushManager' in window;

export function useNotifications() {
  const isConfigured = ref(false);
  const permission = ref<NotificationPermission>('default');
  const isSubscribed = ref(false);
  let cachedPublicKey: string | null = null;

  async function init() {
    if (!isSupported) return;
    permission.value = Notification.permission;
    const res = await fetch('/api/notifications/vapid-public-key');
    if (!res.ok) return;
    const { publicKey } = (await res.json()) as { publicKey: string | null };
    if (!publicKey) return;
    cachedPublicKey = publicKey;
    isConfigured.value = true;
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    isSubscribed.value = sub !== null;
  }

  async function enable(): Promise<void> {
    if (!isSupported || !isConfigured.value || !cachedPublicKey) return;
    const perm = await Notification.requestPermission();
    permission.value = perm;
    if (perm !== 'granted') return;
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(cachedPublicKey),
    });
    const res = await fetch('/api/notifications/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sub.toJSON()),
    });
    if (res.ok) isSubscribed.value = true;
  }

  async function disable(): Promise<void> {
    if (!isSupported) return;
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) await sub.unsubscribe();
    } catch {
      // Proceed to delete server-side subscription regardless
    }
    await fetch('/api/notifications/subscribe', { method: 'DELETE' });
    isSubscribed.value = false;
  }

  onMounted(() => { void init(); });

  return { isSupported, isConfigured, permission, isSubscribed, enable, disable };
}
