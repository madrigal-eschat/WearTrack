<template>
  <k-dialog :opened="opened" @backdropclick="$emit('close')">
    <template #title>End session</template>
    <div v-if="entry?.session" class="flex flex-col gap-3">
      <label class="text-sm text-gray-500">
        Start time
        <input
          v-model="startedAt"
          type="datetime-local"
          step="1"
          class="w-full border rounded px-2 py-1 mt-1"
        />
      </label>
      <label class="text-sm text-gray-500">
        End time
        <input
          v-model="endedAt"
          type="datetime-local"
          step="1"
          class="w-full border rounded px-2 py-1 mt-1"
        />
      </label>
      <button
        v-if="canForget"
        type="button"
        class="text-left text-sm font-medium text-red-600 underline
          underline-offset-2"
        @click="$emit('forget')"
      >
        Forget session
      </button>
    </div>
    <template #buttons>
      <k-dialog-button @click="$emit('close')">Cancel</k-dialog-button>
      <k-dialog-button strong @click="onSave">Save</k-dialog-button>
    </template>
  </k-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { kDialog, kDialogButton } from 'konsta/vue'
import type { CurrentEntry } from '../composables/useWear.js'
import { useNow } from '../composables/useNow.js'
import { useToast } from '../composables/useToast.js'

const props = defineProps<{
  opened: boolean;
  entry: CurrentEntry | null;
}>()

const emit = defineEmits<{
  close: [];
  confirm: [startedAt: number, endedAt: number];
  forget: [];
}>()

const now = useNow()
const { showError } = useToast()

const startedAt = ref('')
const endedAt = ref('')
const canForget = ref(false)

function toDateTimeLocalValue(unixSeconds: number): string {
  const localDate = new Date(unixSeconds * 1000)
  const offset = localDate.getTimezoneOffset() * 60_000
  return new Date(localDate.getTime() - offset).toISOString().slice(0, 19)
}

function parseDateTimeLocalValue(value: string): number | null {
  if (!value) {
    return null
  }
  const time = new Date(value).getTime()
  if (Number.isNaN(time)) {
    return null
  }
  return Math.floor(time / 1000)
}

watch(
  () => [props.opened, props.entry] as const,
  ([opened, entry]) => {
    if (!opened || !entry?.session) {
      return
    }
    startedAt.value = toDateTimeLocalValue(entry.session.started_at)
    // `now` ticks once a second and can lag the server-stamped start.
    endedAt.value = toDateTimeLocalValue(
      Math.max(
        entry.session.ended_at ?? Math.floor(now.value / 1000),
        entry.session.started_at,
      ),
    )
    canForget.value =
      Math.floor(now.value / 1000) - entry.session.started_at < 300
  },
  { immediate: true },
)

function onSave(): void {
  const startedAtSeconds = parseDateTimeLocalValue(startedAt.value)
  const endedAtSeconds = parseDateTimeLocalValue(endedAt.value)
  if (startedAtSeconds === null || endedAtSeconds === null) {
    showError('Please enter valid start and end times.')
    return
  }
  if (endedAtSeconds < startedAtSeconds) {
    showError('End time must be after the start time.')
    return
  }
  emit('confirm', startedAtSeconds, endedAtSeconds)
}
</script>
