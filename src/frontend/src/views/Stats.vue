<template>
  <k-page style="padding-bottom: 56px">
    <PageHeader title="Stats" />

    <SegmentedControl
      :options="LEADERBOARD_TYPES"
      :modelValue="activeType"
      @update:modelValue="loadLeaderboard"
    />

    <div v-if="loading" class="text-center py-8 text-gray-400">Loading…</div>
    <k-list v-else-if="leaderboard.length > 0" inset>
      <k-list-item
        v-for="(entry, idx) in leaderboard"
        :key="idx"
        :title="entryName(entry)"
        :subtitle="entrySubtitle(entry)"
      >
        <template #media>
          <div class="flex flex-col items-center gap-0.5 w-8">
            <Icon
              v-if="entryIcon(entry)?.includes(':')"
              :icon="entryIcon(entry)!"
              class="text-2xl w-6 h-6"
              :style="{ color: entryColor(entry) }"
            />
            <span
              v-else-if="entryIcon(entry)"
              class="text-xl leading-none"
            >{{ entryIcon(entry) }}</span>
            <span class="font-bold text-gray-400 text-xs">{{ idx + 1 }}</span>
          </div>
        </template>
        <template #after>
          <k-badge>{{ entryBadge(entry) }}</k-badge>
        </template>
      </k-list-item>
    </k-list>
    <k-block v-else>
      <p class="text-center text-gray-400">
        No data yet. Start some wear sessions!
      </p>
    </k-block>
  </k-page>
</template>

<script setup lang="ts">
import { onMounted, computed } from 'vue';
import { kPage, kList, kListItem, kBadge, kBlock } from 'konsta/vue';
import { Icon } from '@iconify/vue';
import { useStats } from '../composables/useStats.js';
import SegmentedControl from '../components/SegmentedControl.vue';
import PageHeader from '../components/PageHeader.vue';

const {
  leaderboard,
  activeType,
  loading,
  loadLeaderboard,
  LEADERBOARD_TYPES,
} = useStats();

onMounted(() => loadLeaderboard('longest-wear'));

const activeTypeObj = computed(() =>
  LEADERBOARD_TYPES.find((t) => t.value === activeType.value)
);

function entryName(entry: Record<string, unknown>): string {
  return (entry.item_name ?? entry.category_name ?? '—') as string;
}

function entrySubtitle(entry: Record<string, unknown>): string {
  if (entry.item_name && entry.category_name) {
    return `Category: ${entry.category_name}`;
  }
  return '';
}

function entryIcon(entry: Record<string, unknown>): string | null {
  return (entry.category_icon ?? null) as string | null;
}

function entryColor(entry: Record<string, unknown>): string {
  return (entry.item_color ?? 'currentColor') as string;
}

function entryBadge(entry: Record<string, unknown>): string {
  return activeTypeObj.value?.badge(entry) ?? '';
}
</script>
