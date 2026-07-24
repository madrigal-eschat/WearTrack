<!-- src/frontend/src/views/Log.vue -->
<template>
  <k-page class="flex flex-col" style="padding-bottom: 56px">
    <PageHeader title="Log" />
    <k-block class="flex gap-2 pb-2">
      <select
        v-model.number="categoryFilter"
        class="text-sm border rounded px-2 py-1 flex-1"
      >
        <option :value="null">All categories</option>
        <option
          v-for="cat in categories"
          :key="cat.id"
          :value="cat.id"
        >{{ cat.name }}</option>
      </select>
      <select
        v-model.number="itemFilter"
        class="text-sm border rounded px-2 py-1 flex-1"
      >
        <option :value="null">All items</option>
        <option
          v-for="item in filterableItems"
          :key="item.id"
          :value="item.id"
        >{{ item.name }}</option>
      </select>
    </k-block>

    <div class="flex flex-1 overflow-hidden">
      <div class="flex-1 overflow-y-auto">
        <div
          v-if="sessions.length === 0 && !loading"
          class="px-4 py-8 text-center text-gray-400"
        >
          No sessions
        </div>
        <k-list v-else>
          <LogItem
            v-for="entry in sessions"
            :key="entry.id"
            :entry="entry"
            @open-actions="openActions(entry)"
          />
        </k-list>
        <div ref="sentinel" class="h-4"></div>
      </div>

      <div
        class="
          w-6 flex flex-col items-center justify-center gap-0.5
          overflow-y-auto shrink-0
        "
      >
        <button
          v-for="entry in dateIndex"
          :key="entry.label"
          type="button"
          class="text-[9px] leading-tight text-blue-600"
          @click="jumpTo(entry.cursor)"
        >{{ jumpLabel(entry) }}</button>
      </div>
    </div>

    <!-- Kebab action sheet -->
    <Actions :opened="actionsOpen" @backdropclick="actionsOpen = false">
      <ActionsGroup>
        <ActionsButton @click="startEdit()">Edit</ActionsButton>
        <DeleteButton
          title="Delete session?"
          message="This cannot be undone."
          @confirm="performDelete"
        >
          <template #trigger="{ open }">
            <ActionsButton
              class="text-red-600"
              @click="actionsOpen = false; open()"
            >Delete</ActionsButton>
          </template>
        </DeleteButton>
      </ActionsGroup>
      <ActionsGroup>
        <ActionsButton bold @click="actionsOpen = false">Cancel</ActionsButton>
      </ActionsGroup>
    </Actions>

    <EditSessionDialog
      v-if="editTarget"
      :open="editOpen"
      @update:open="editOpen = $event"
      :duration-minutes="editDurationMinutes"
      @update:duration-minutes="editDurationMinutes = $event"
      :max-minutes="Math.ceil((editRange.max - editRange.min) / 60)"
      @save="saveEdit"
    />
  </k-page>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import {
  kPage, kBlock, kList, Actions, ActionsGroup, ActionsButton,
} from 'konsta/vue'
import PageHeader from '../components/PageHeader.vue'
import DeleteButton from '../components/DeleteButton.vue'
import LogItem from '../components/LogItem.vue'
import EditSessionDialog from '../components/EditSessionDialog.vue'
import {
  useSessionLog, type SessionLogEntry,
} from '../composables/useSessionLog.js'
import { useCategories } from '../composables/useCategories.js'
import { useItems } from '../composables/useItems.js'
import {
  buildDateIndex, type DateIndexEntry,
} from '../utils/sessionDateIndex.js'
import { apiFetch } from '../utils/apiFetch.js'

const {
  sessions, loading, loadInitial, loadMore,
  categoryFilter, itemFilter, setCategoryFilter, setItemFilter, jumpTo,
  editableRangeFor, editSession, deleteSession,
} = useSessionLog()

const { categories, loadCategories } = useCategories()
const { items, loadItems, itemsForCategory } = useItems()

const dateIndex = ref<DateIndexEntry[]>([])

const filterableItems = computed(() => (
  categoryFilter.value !== null
    ? itemsForCategory(categoryFilter.value)
    : items.value
))

watch(categoryFilter, async (id) => {
  const stillValid = filterableItems.value.some(
    (i) => i.id === itemFilter.value,
  )
  if (itemFilter.value !== null && !stillValid) {
    itemFilter.value = null
  }
  await setCategoryFilter(id)
  await refreshDateIndex()
})

watch(itemFilter, async (id) => {
  await setItemFilter(id)
  await refreshDateIndex()
})

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

function jumpLabel(entry: DateIndexEntry): string {
  if (entry.granularity === 'day') {
    return entry.label.slice(8, 10)
  }
  if (entry.granularity === 'week') {
    return entry.label.slice(8, 10)
  }
  if (entry.granularity === 'month') {
    return entry.label.slice(5, 7)
  }
  return entry.label.slice(2, 4)
}

const actionsOpen = ref(false)
const activeEntry = ref<SessionLogEntry | null>(null)

function openActions(entry: SessionLogEntry): void {
  activeEntry.value = entry
  actionsOpen.value = true
}

const editOpen = ref(false)
const editDurationMinutes = ref(0)
const editTarget = computed(() => activeEntry.value)
const editRange = computed(() => (
  editTarget.value
    ? editableRangeFor(editTarget.value)
    : { min: 0, max: 0 }
))

function startEdit(): void {
  actionsOpen.value = false
  if (!editTarget.value || editTarget.value.ended_at === null) {
    return
  }
  editDurationMinutes.value = Math.round(
    (editTarget.value.ended_at - editTarget.value.started_at) / 60,
  )
  editOpen.value = true
}

async function saveEdit(): Promise<void> {
  if (!editTarget.value) {
    return
  }
  const newEndedAt = editTarget.value.started_at
    + editDurationMinutes.value * 60
  const clamped = Math.min(
    Math.max(newEndedAt, editRange.value.min + 1),
    editRange.value.max,
  )
  await editSession(editTarget.value, clamped)
  editOpen.value = false
}

async function performDelete(): Promise<void> {
  if (activeEntry.value) {
    await deleteSession(activeEntry.value)
  }
}

const sentinel = ref<HTMLElement | null>(null)
let observer: IntersectionObserver | null = null

onMounted(async () => {
  await loadCategories()
  await loadItems()
  await loadInitial()
  await refreshDateIndex()

  observer = new IntersectionObserver((entries) => {
    if (entries[0]?.isIntersecting) {
      void loadMore()
    }
  })
  if (sentinel.value) {
    observer.observe(sentinel.value)
  }
})

onUnmounted(() => {
  observer?.disconnect()
})
</script>
