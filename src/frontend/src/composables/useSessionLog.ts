import { ref } from 'vue';
import { apiFetch } from '../utils/apiFetch.js';
import type { Session } from './useWear.js';
import { computeEditableRange, type LastEdited } from '../utils/sessionEditPolicy.js';

export interface SessionLogEntry extends Session {
  category_id: number;
  item_name: string;
  item_color: string;
  category_name: string;
  category_icon: string;
}

const LIMIT = 100;

// Module-level state shared across all component instances
const sessions = ref<SessionLogEntry[]>([]);
const categoryFilter = ref<number | null>(null);
const itemFilter = ref<number | null>(null);
const hasMore = ref(true);
const loading = ref(false);
const lastEdited = ref<LastEdited | null>(null);

function buildQuery(before?: number): string {
  const params = new URLSearchParams();
  if (categoryFilter.value !== null) params.set('category_id', String(categoryFilter.value));
  if (itemFilter.value !== null) params.set('item_id', String(itemFilter.value));
  if (before !== undefined) params.set('before', String(before));
  params.set('limit', String(LIMIT));
  return params.toString();
}

async function fetchPage(before?: number): Promise<SessionLogEntry[]> {
  const res = await apiFetch(`/api/sessions?${buildQuery(before)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function loadInitial(before?: number): Promise<void> {
  loading.value = true;
  try {
    const page = await fetchPage(before);
    sessions.value = page;
    hasMore.value = page.length === LIMIT;
  } finally {
    loading.value = false;
  }
}

async function loadMore(): Promise<void> {
  if (!hasMore.value || loading.value || sessions.value.length === 0) return;
  loading.value = true;
  try {
    const last = sessions.value.at(-1)!;
    const page = await fetchPage(last.started_at);
    sessions.value = [...sessions.value, ...page];
    hasMore.value = page.length === LIMIT;
  } finally {
    loading.value = false;
  }
}

async function setCategoryFilter(id: number | null): Promise<void> {
  categoryFilter.value = id;
  await loadInitial();
}

async function setItemFilter(id: number | null): Promise<void> {
  itemFilter.value = id;
  await loadInitial();
}

async function jumpTo(cursor: number): Promise<void> {
  await loadInitial(cursor);
}

function editableRangeFor(session: SessionLogEntry): { min: number; max: number } {
  if (session.ended_at === null) return { min: session.started_at, max: session.started_at };
  return computeEditableRange({ id: session.id, started_at: session.started_at, ended_at: session.ended_at }, lastEdited.value);
}

async function editSession(session: SessionLogEntry, newEndedAt: number): Promise<void> {
  const res = await apiFetch(`/api/sessions/${session.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ended_at: newEndedAt }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  const updated: SessionLogEntry = await res.json();

  if (lastEdited.value?.sessionId !== session.id && session.ended_at !== null) {
    lastEdited.value = { sessionId: session.id, originalEndedAt: session.ended_at };
  }

  const idx = sessions.value.findIndex((s) => s.id === session.id);
  if (idx !== -1) sessions.value[idx] = { ...sessions.value[idx], ...updated };
}

async function deleteSession(session: SessionLogEntry): Promise<void> {
  const res = await apiFetch(`/api/sessions/${session.id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  sessions.value = sessions.value.filter((s) => s.id !== session.id);
  if (lastEdited.value?.sessionId === session.id) lastEdited.value = null;
}

export function useSessionLog() {
  return {
    sessions,
    categoryFilter,
    itemFilter,
    hasMore,
    loading,
    loadInitial,
    loadMore,
    setCategoryFilter,
    setItemFilter,
    jumpTo,
    editableRangeFor,
    editSession,
    deleteSession,
  };
}
