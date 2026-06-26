import { ref, onMounted, onUnmounted } from 'vue';
import type { Ref } from 'vue';
import { apiFetch } from '../utils/apiFetch.js';

export async function fetchVersion(): Promise<string | null> {
  try {
    const res = await apiFetch('/api/version');
    if (!res.ok) return null;
    const { version } = await res.json() as { version: string };
    return version;
  } catch {
    return null;
  }
}

export function useVersionCheck(): { needsRefresh: Ref<boolean> } {
  const needsRefresh = ref(false);
  let initialVersion: string | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  async function check(): Promise<void> {
    const version = await fetchVersion();
    if (version === null) return;
    if (initialVersion === null) {
      initialVersion = version;
    } else if (version !== initialVersion) {
      needsRefresh.value = true;
    }
  }

  function startPolling(): void {
    if (pollTimer !== null) return;
    pollTimer = setInterval(() => { void check(); }, 30_000);
  }

  function stopPolling(): void {
    if (pollTimer !== null) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function onVisibilityChange(): void {
    if (document.visibilityState === 'visible') {
      void check();
      startPolling();
    } else {
      stopPolling();
    }
  }

  onMounted(() => {
    void check();
    if (document.visibilityState === 'visible') {
      startPolling();
    }
    document.addEventListener('visibilitychange', onVisibilityChange);
  });

  onUnmounted(() => {
    stopPolling();
    document.removeEventListener('visibilitychange', onVisibilityChange);
  });

  return { needsRefresh };
}
