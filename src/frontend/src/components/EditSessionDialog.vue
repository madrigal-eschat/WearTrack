<template>
  <k-dialog :opened="open" @backdropclick="$emit('update:open', false)">
    <template #title>Edit session</template>
    <template #content>
      <div class="flex flex-col gap-2">
        <label class="text-sm text-gray-500">
          Duration (minutes)
          <input
            :value="durationMinutes"
            @input="$emit('update:durationMinutes', Number(($event.target as HTMLInputElement).value))"
            type="number"
            class="w-full border rounded px-2 py-1 mt-1"
            :min="1"
            :max="maxMinutes"
          />
        </label>
        <p class="text-xs text-gray-400">
          Allowed: {{ formatDuration(1) }} to {{ formatDuration(maxMinutes * 60) }}
        </p>
      </div>
    </template>
    <template #buttons>
      <k-dialog-button @click="$emit('update:open', false)">Cancel</k-dialog-button>
      <k-dialog-button strong @click="$emit('save')">Save</k-dialog-button>
    </template>
  </k-dialog>
</template>

<script setup lang="ts">
import { kDialog, kDialogButton } from 'konsta/vue';
import { formatDuration } from '../utils/formatDuration.js';

defineProps<{ open: boolean; durationMinutes: number; maxMinutes: number }>();
defineEmits<{ 'update:open': [value: boolean]; 'update:durationMinutes': [value: number]; save: [] }>();
</script>
