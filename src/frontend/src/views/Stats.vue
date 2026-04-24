<template>
  <k-page style="padding-bottom: 56px">
    <k-navbar title="Stats" />

    <!-- Leaderboard type selector -->
    <div class="flex gap-2 overflow-x-auto px-4 py-3 no-scrollbar">
      <button
        v-for="t in LEADERBOARD_TYPES"
        :key="t.value"
        class="flex-shrink-0 px-3 py-1 rounded-full text-sm border transition-colors"
        :class="activeType === t.value
          ? 'bg-blue-500 text-white border-blue-500'
          : 'bg-white text-gray-700 border-gray-300'"
        @click="loadLeaderboard(t.value)"
      >
        {{ t.label }}
      </button>
    </div>

    <div v-if="loading" class="text-center py-8 text-gray-400">Loading…</div>
    <k-list v-else-if="leaderboard.length > 0" inset>
      <k-list-item
        v-for="(entry, idx) in leaderboard"
        :key="idx"
        :title="entryName(entry)"
        :subtitle="entrySubtitle(entry)"
      >
        <template #media>
          <span class="font-bold text-gray-500">{{ idx + 1 }}</span>
        </template>
        <template #after>
          <k-badge>{{ entryBadge(entry) }}</k-badge>
        </template>
      </k-list-item>
    </k-list>
    <k-block v-else>
      <p class="text-center text-gray-400">No data yet. Start some wear sessions!</p>
    </k-block>
  </k-page>
</template>

<script setup lang="ts">
import { onMounted, computed } from 'vue';
import { kPage, kNavbar, kList, kListItem, kBadge, kBlock } from 'konsta/vue';
import { useStats } from '../composables/useStats.js';

const { leaderboard, activeType, loading, loadLeaderboard, LEADERBOARD_TYPES } = useStats();

onMounted(() => loadLeaderboard('longest-wear'));

const activeTypeObj = computed(() =>
  LEADERBOARD_TYPES.find((t) => t.value === activeType.value)
);

function entryName(entry: Record<string, unknown>): string {
  return (entry.name ?? entry.category_name ?? '—') as string;
}

function entrySubtitle(entry: Record<string, unknown>): string {
  if (entry.category_name) return `Category: ${entry.category_name}`;
  if (entry.category) return String(entry.category);
  return '';
}

function entryBadge(entry: Record<string, unknown>): string {
  return activeTypeObj.value?.badge(entry) ?? '';
}
</script>

<style scoped>
.no-scrollbar::-webkit-scrollbar { display: none; }
.no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
</style>
