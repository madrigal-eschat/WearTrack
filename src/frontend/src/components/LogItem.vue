<template>
  <k-list-item
    :title="entry.item_name"
    :subtitle="formatStart(entry.started_at)"
  >
    <template #media>
      <Icon
        v-if="entry.category_icon?.includes(':')"
        :icon="entry.category_icon"
        class="text-2xl w-8 h-8"
        :style="{ color: entry.item_color }"
      />
      <span v-else class="text-2xl">{{ entry.category_icon }}</span>
    </template>
    <template #after>
      <div class="flex items-center gap-2">
        <div class="text-right tabular-nums leading-snug whitespace-nowrap">
          <div class="text-sm text-gray-600">
            <span
              class="text-xs text-gray-400 uppercase tracking-wide mr-1"
            >Worn</span>{{ wornDuration }}
          </div>
          <div class="text-xs text-gray-500">
            <span
              class="text-xs text-gray-400 uppercase tracking-wide mr-1"
            >Target</span>{{ formatDuration(entry.target_wear_seconds) }}
            <template v-if="entry.max_wear_seconds !== null">
              <span class="mx-1 text-gray-300">/</span>
              <span
                class="text-xs text-gray-400 uppercase tracking-wide mr-1"
              >Max</span>{{ formatDuration(entry.max_wear_seconds) }}
            </template>
          </div>
        </div>
        <Icon
          v-if="entry.ended_in_injury"
          icon="ph:warning-circle"
          class="text-red-500 w-5 h-5"
        />
        <button
          type="button"
          aria-label="Session actions"
          class="text-gray-400 p-1"
          @click="$emit('open-actions')"
        >
          <EllipsisHorizontalIcon class="w-5 h-5" />
        </button>
      </div>
    </template>
  </k-list-item>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { Icon } from '@iconify/vue';
import { kListItem } from 'konsta/vue';
import { EllipsisHorizontalIcon } from '@heroicons/vue/24/solid';
import type { SessionLogEntry } from '../composables/useSessionLog.js';
import { formatDuration } from '../utils/formatDuration.js';

const props = defineProps<{ entry: SessionLogEntry }>();
defineEmits<{ 'open-actions': [] }>();

function formatStart(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

const wornDuration = computed(() =>
  props.entry.ended_at === null
    ? ''
    : formatDuration(props.entry.ended_at - props.entry.started_at),
);
</script>
