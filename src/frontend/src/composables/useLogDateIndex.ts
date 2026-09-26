import { ref, type Ref } from 'vue'
import { apiFetch } from '../utils/apiFetch.js'
import {
  buildDateIndex, type DateIndexEntry,
} from '../utils/sessionDateIndex.js'

/** Jump-rail index of days that have sessions, scoped to the log filters. */
export function useLogDateIndex(
  categoryFilter: Ref<number | null>,
  itemFilter: Ref<number | null>,
) {
  const dateIndex = ref<DateIndexEntry[]>([])

  async function refreshDateIndex(): Promise<void> {
    const params = new URLSearchParams()
    if (categoryFilter.value !== null) {
      params.set('category_id', String(categoryFilter.value))
    }
    if (itemFilter.value !== null) {
      params.set('item_id', String(itemFilter.value))
    }
    const res = await apiFetch(`/api/sessions/dates?${params.toString()}`)
    const days: string[] = res.ok ? await res.json() : []
    dateIndex.value = buildDateIndex(days)
  }

  return { dateIndex, refreshDateIndex }
}
