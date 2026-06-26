import { ref } from 'vue';
import type { Item } from './useWear.js';
import { apiFetch } from '../utils/apiFetch.js';

export interface ItemStats {
  item_id: number;
  total_wear_seconds: number;
  session_count: number;
  max_single_session_wear_seconds: number;
}

export interface HistoryEntry {
  period: string;
  total_wear_seconds: number;
  session_count: number;
}

export type ItemCreate = { name: string; category_id: number; color: string; difficulty_multiplier?: number };
export type ItemUpdate = Partial<ItemCreate>;

// Module-level state shared across all component instances
const items = ref<Item[]>([]);

async function loadItems(categoryId?: number): Promise<void> {
  const url = categoryId !== undefined ? `/api/items?category_id=${categoryId}` : '/api/items';
  const res = await apiFetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  items.value = await res.json();
}

async function loadItemStats(id: number): Promise<ItemStats> {
  const res = await apiFetch(`/api/items/${id}/stats`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function loadHistory(id: number, unit: 'month' | 'week' = 'month'): Promise<HistoryEntry[]> {
  const res = await apiFetch(`/api/items/${id}/stats/history?unit=${unit}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function createItem(data: ItemCreate): Promise<Item> {
  const res = await apiFetch('/api/items', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  const item: Item = await res.json();
  items.value.push(item);
  return item;
}

async function updateItem(id: number, data: ItemUpdate): Promise<Item> {
  const res = await apiFetch(`/api/items/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  const updated: Item = await res.json();
  const idx = items.value.findIndex((i) => i.id === id);
  if (idx !== -1) items.value[idx] = updated;
  return updated;
}

async function deleteItem(id: number): Promise<void> {
  const res = await apiFetch(`/api/items/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  items.value = items.value.filter((i) => i.id !== id);
}

function itemsForCategory(categoryId: number): Item[] {
  return items.value.filter((i) => i.category_id === categoryId);
}

export function useItems() {
  return {
    items,
    loadItems,
    loadItemStats,
    loadHistory,
    createItem,
    updateItem,
    deleteItem,
    itemsForCategory,
  };
}
