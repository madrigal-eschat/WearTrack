import { ref } from 'vue';
import type { Category } from './useWear.js';

export interface CategoryStats {
  category_id: number;
  total_wear_seconds: number;
  session_count: number;
  max_single_session_wear_seconds: number;
  streak_wear_seconds: number;
  streak_count: number;
  best_streak_wear_seconds: number;
  best_streak_count: number;
  item_count: number;
}

export type CategoryCreate = Omit<Category, 'id'>;
export type CategoryUpdate = Partial<CategoryCreate>;

const categories = ref<Category[]>([]);

async function loadCategories(): Promise<void> {
  const res = await fetch('/api/categories');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  categories.value = await res.json();
}

async function loadCategoryStats(id: number): Promise<CategoryStats> {
  const res = await fetch(`/api/categories/${id}/stats`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function createCategory(data: CategoryCreate): Promise<Category> {
  const res = await fetch('/api/categories', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  const category: Category = await res.json();
  categories.value.push(category);
  return category;
}

async function updateCategory(id: number, data: CategoryUpdate): Promise<Category> {
  const res = await fetch(`/api/categories/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  const updated: Category = await res.json();
  const idx = categories.value.findIndex((c) => c.id === id);
  if (idx !== -1) categories.value[idx] = updated;
  return updated;
}

async function deleteCategory(id: number): Promise<void> {
  const res = await fetch(`/api/categories/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  categories.value = categories.value.filter((c) => c.id !== id);
}

export function useCategories() {
  return {
    categories,
    loadCategories,
    loadCategoryStats,
    createCategory,
    updateCategory,
    deleteCategory,
  };
}
