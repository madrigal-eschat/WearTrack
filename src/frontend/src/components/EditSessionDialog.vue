<template>
  <k-dialog :opened="open" @backdropclick="$emit('update:open', false)">
    <template #title>Edit session</template>
    <div class="flex flex-col gap-3">
      <k-list class="!m-0">
        <k-list-input
          label="Start"
          type="datetime-local"
          :value="toLocalInput(startedAt)"
          @input="onInput($event, (ts) => emit('update:startedAt', ts))"
        />
        <k-list-input
          label="End"
          type="datetime-local"
          :value="toLocalInput(endedAt)"
          @input="onInput($event, (ts) => emit('update:endedAt', ts))"
        />
      </k-list>
      <p
        class="text-sm"
        :class="valid ? 'text-gray-500' : 'text-red-600'"
      >
        {{ durationLabel }}
      </p>
      <p v-if="error" class="text-sm text-red-600">{{ error }}</p>
    </div>
    <template #buttons>
      <k-dialog-button @click="$emit('update:open', false)">
        Cancel
      </k-dialog-button>
      <k-dialog-button strong :disabled="!valid" @click="$emit('save')">
        Save
      </k-dialog-button>
    </template>
  </k-dialog>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import {
  kDialog, kDialogButton, kList, kListInput,
} from 'konsta/vue'
import { formatDuration } from '../utils/formatDuration.js'
import { fromLocalInput, toLocalInput } from '../utils/datetimeLocal.js'

const props = defineProps<{
  open: boolean;
  startedAt: number;
  endedAt: number;
  error?: string | null;
}>()
const emit = defineEmits<{
  'update:open': [value: boolean];
  'update:startedAt': [value: number];
  'update:endedAt': [value: number];
  save: [];
}>()

const valid = computed(() => props.endedAt > props.startedAt)
const durationLabel = computed(() => (
  valid.value
    ? `Duration: ${formatDuration(props.endedAt - props.startedAt)}`
    : 'End must be after start'
))

function onInput(event: Event, apply: (ts: number) => void): void {
  const ts = fromLocalInput((event.target as HTMLInputElement).value)
  if (ts !== null) {
    apply(ts)
  }
}
</script>
