import { ref, onMounted, onUnmounted } from 'vue';
import { currentWear } from '../utils/wearCalculations.js';

export interface Category {
  id: number;
  name: string;
  icon: string;
  initial_target_wear_duration_seconds: number;
  initial_max_wear_duration_seconds: number | null;
  rest_multiplier: number;
  minimum_rest: number;
  risk_levels: Array<{ lower: number | null; upper: number | null; text: string; severity: number }>;
  break_decay_multiplier: number;
  break_grace_time: number;
}

export interface Item {
  id: number;
  category_id: number;
  name: string;
  color: string;
  difficulty_multiplier: number;
}

export interface Session {
  id: number;
  item_id: number;
  started_at: number;
  ended_at: number | null;
  target_wear_seconds: number;
  max_wear_seconds: number | null;
  rest_seconds: number | null;
  ended_in_injury: number;
}

export interface ItemWithLastSession {
  item_id: number;
  category_id: number;
  name: string;
  color: string;
  difficulty_multiplier: number;
  ended_at: number | null;
  started_at: number | null;
  target_wear_seconds: number | null;
  max_wear_seconds: number | null;
  rest_seconds: number | null;
  expected_target: number;
  expected_max: number | null;
}

export interface CurrentEntry {
  category: Category;
  item: Item | null;
  session: Session | null;
  items: ItemWithLastSession[];
  decay_start_time: number | null;
  decay_state: 'none' | 'decaying' | 'fully_decayed';
}

const currentSessions = ref<CurrentEntry[]>([]);
const loading = ref(false);
const loaded = ref(false);
const error = ref<string | null>(null);
let pollTimer: ReturnType<typeof setInterval> | null = null;

async function fetchCurrent() {
  loading.value = true;
  try {
    const res = await fetch('/api/sessions/current');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    currentSessions.value = await res.json();
  } catch (e) {
    error.value = String(e);
  } finally {
    loading.value = false;
    loaded.value = true;
  }
}

async function startSession(itemId: number): Promise<Session> {
  const res = await fetch('/api/sessions/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ item_id: itemId }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  const session: Session = await res.json();
  await fetchCurrent();
  return session;
}

async function endSession(sessionId: number): Promise<Session> {
  const res = await fetch(`/api/sessions/${sessionId}/end`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  const session: Session = await res.json();
  await fetchCurrent();
  return session;
}

async function reportInjury(itemId: number, wearSeconds?: number): Promise<void> {
  const body: Record<string, unknown> = { item_id: itemId };
  if (wearSeconds !== undefined) body.wear_seconds = wearSeconds;
  const res = await fetch('/api/injuries', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const resBody = await res.json().catch(() => ({}));
    throw new Error(resBody.error ?? `HTTP ${res.status}`);
  }
  await fetchCurrent();
}

export function useWear() {
  onMounted(() => {
    fetchCurrent();
    // Poll every 60s to keep elapsed times / rest countdowns fresh
    pollTimer = setInterval(fetchCurrent, 60_000);
  });
  onUnmounted(() => {
    if (pollTimer !== null) clearInterval(pollTimer);
  });

  return {
    currentSessions,
    loading,
    loaded,
    error,
    fetchCurrent,
    startSession,
    endSession,
    reportInjury,
    currentWear,
  };
}
