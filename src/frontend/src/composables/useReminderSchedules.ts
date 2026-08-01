import { ref } from 'vue'
import { apiFetch } from '../utils/apiFetch.js'

export interface ReminderSchedule {
  id: number;
  category_id: number;
  remind_each_seconds: number;
  text: string;
}

export type ReminderScheduleCreate = Omit<ReminderSchedule, 'id'>;
export type ReminderScheduleUpdate = Partial<
  Omit<ReminderSchedule, 'id' | 'category_id'>
>;

// Module-level state shared across all component instances, keyed by
// category_id — mirrors how CategoriesSection needs a count per row.
const schedules = ref<Record<number, ReminderSchedule[]>>({})

async function loadSchedules(categoryId: number): Promise<void> {
  const res = await apiFetch(
    `/api/reminder-schedules?category_id=${categoryId}`,
  )
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`)
  }
  schedules.value[categoryId] = await res.json()
}

async function createSchedule(
  data: ReminderScheduleCreate,
): Promise<ReminderSchedule> {
  const res = await apiFetch('/api/reminder-schedules', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error ?? `HTTP ${res.status}`)
  }
  const created: ReminderSchedule = await res.json()
  const list = schedules.value[data.category_id] ?? []
  schedules.value[data.category_id] = [...list, created]
  return created
}

async function updateSchedule(
  id: number,
  data: ReminderScheduleUpdate,
): Promise<ReminderSchedule> {
  const res = await apiFetch(`/api/reminder-schedules/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error ?? `HTTP ${res.status}`)
  }
  const updated: ReminderSchedule = await res.json()
  const list = schedules.value[updated.category_id] ?? []
  schedules.value[updated.category_id] = list.map((s) =>
    s.id === id ? updated : s,
  )
  return updated
}

async function deleteSchedule(categoryId: number, id: number): Promise<void> {
  const res = await apiFetch(`/api/reminder-schedules/${id}`, {
    method: 'DELETE',
  })
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`)
  }
  const list = schedules.value[categoryId] ?? []
  schedules.value[categoryId] = list.filter((s) => s.id !== id)
}

export function useReminderSchedules() {
  return {
    schedules,
    loadSchedules,
    createSchedule,
    updateSchedule,
    deleteSchedule,
  }
}
