import { ref, onMounted, onUnmounted } from 'vue';

export interface Category {
  id: number;
  name: string;
  icon: string;
  initial_wear_duration_seconds: number;
  rest_multiplier: number;
  rest_constant_seconds: number;
  risk_levels: Array<{ lower: number | null; upper: number | null; text: string; severity: number }>;
  break_decay_multiplier: number;
  break_starts_after_seconds: number;
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
  calculated_wear_seconds: number;
  calculated_rest_seconds: number | null;
  ended_in_injury: number;
}

export interface CurrentEntry {
  category: Category;
  item: Item | null;
  session: Session | null;
}

const currentSessions = ref<CurrentEntry[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
let pollTimer: ReturnType<typeof setInterval> | null = null;

async function fetchCurrent() {
  try {
    const res = await fetch('/api/sessions/current');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    currentSessions.value = await res.json();
  } catch (e) {
    error.value = String(e);
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

/** Elapsed wear seconds for an active session (calculated_wear_seconds + time since start). */
function currentWear(session: Session): number {
  if (session.ended_at !== null) return session.calculated_wear_seconds;
  return session.calculated_wear_seconds + (Math.floor(Date.now() / 1000) - session.started_at);
}

export function useWear() {
  onMounted(() => {
    fetchCurrent();
    // Poll every 30s to keep elapsed times / rest countdowns fresh
    pollTimer = setInterval(fetchCurrent, 30_000);
  });
  onUnmounted(() => {
    if (pollTimer !== null) clearInterval(pollTimer);
  });

  return {
    currentSessions,
    loading,
    error,
    fetchCurrent,
    startSession,
    endSession,
    reportInjury,
    currentWear,
  };
}
