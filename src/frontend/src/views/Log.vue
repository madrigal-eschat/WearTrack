<!-- src/frontend/src/views/Log.vue -->
<template>
  <k-page class="flex flex-col">
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
            @open-actions="sessionActions?.open(entry)"
          />
        </k-list>
        <div ref="sentinel" class="h-4"></div>
      </div>

      <LogDateIndex :entries="dateIndex" @jump="jumpTo" />
    </div>

    <LogSessionActions ref="sessionActions" />
  </k-page>
</template>

<script setup lang="ts">
import {
  ref, computed, onMounted, onUnmounted, watch,
} from 'vue'
import { kPage, kBlock, kList } from 'konsta/vue'
import PageHeader from '../components/PageHeader.vue'
import LogItem from '../components/LogItem.vue'
import LogDateIndex from '../components/LogDateIndex.vue'
import LogSessionActions from '../components/LogSessionActions.vue'
import { useSessionLog } from '../composables/useSessionLog.js'
import { useLogDateIndex } from '../composables/useLogDateIndex.js'
import { useCategories } from '../composables/useCategories.js'
import { useItems } from '../composables/useItems.js'

const {
  sessions, loading, loadInitial, loadMore,
  categoryFilter, itemFilter, setCategoryFilter, setItemFilter, jumpTo,
} = useSessionLog()
const { dateIndex, refreshDateIndex } = useLogDateIndex(
  categoryFilter,
  itemFilter,
)

const { categories, loadCategories } = useCategories()
const { items, loadItems, itemsForCategory } = useItems()

const sessionActions = ref<InstanceType<typeof LogSessionActions> | null>(
  null,
)

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
