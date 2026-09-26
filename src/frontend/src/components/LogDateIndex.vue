<template>
  <div
    class="
      w-6 flex flex-col items-center justify-center gap-0.5
      overflow-y-auto shrink-0
    "
  >
    <button
      v-for="entry in entries"
      :key="entry.label"
      type="button"
      class="text-[9px] leading-tight text-blue-600"
      @click="$emit('jump', entry.cursor)"
    >{{ jumpLabel(entry) }}</button>
  </div>
</template>

<script setup lang="ts">
import type { DateIndexEntry } from '../utils/sessionDateIndex.js'

defineProps<{ entries: DateIndexEntry[] }>()
defineEmits<{ jump: [cursor: number] }>()

function jumpLabel(entry: DateIndexEntry): string {
  if (entry.granularity === 'day' || entry.granularity === 'week') {
    return entry.label.slice(8, 10)
  }
  if (entry.granularity === 'month') {
    return entry.label.slice(5, 7)
  }
  return entry.label.slice(2, 4)
}
</script>
