<template>
  <div class="calendar-pane flex flex-col">
    <div class="flex items-center justify-between px-4 py-2">
      <button @click="prevWeek" class="border border-gray-300 rounded-lg px-4 py-1 text-gray-600 text-sm">‹</button>
      <span class="text-sm font-medium whitespace-nowrap min-w-[8rem] text-center">{{ formatWeekRange() }}</span>
      <button @click="nextWeek" class="border border-gray-300 rounded-lg px-4 py-1 text-gray-600 text-sm">›</button>
    </div>

    <div class="grid grid-cols-7 gap-1 px-2 pb-2 flex-1">
      <div
        v-for="day in weekDays"
        :key="day.label"
        class="flex flex-col items-center rounded-lg py-2"
        :class="day.isToday ? 'bg-blue-50' : ''"
      >
        <span class="text-xs text-gray-500">{{ day.label }}</span>
        <span
          class="text-sm font-semibold mt-0.5"
          :class="day.isToday ? 'text-blue-600' : 'text-gray-800'"
        >{{ day.dayNum }}</span>

        <div v-if="day.totalWearSeconds > 0" class="mt-1 flex flex-col items-center">
          <div class="flex flex-wrap justify-center items-center gap-0.5">
            <template v-for="badge in dayBadges(day)" :key="badge.categoryId">
              <Icon
                v-if="badge.icon?.includes(':')"
                :icon="badge.icon"
                class="w-5 h-5"
                :style="{ color: badge.color }"
              />
              <span v-else-if="badge.icon" class="text-base leading-none">{{ badge.icon }}</span>
              <div v-else class="w-2 h-2 rounded-full self-center" :style="{ background: badge.color }"></div>
            </template>
          </div>
          <span class="text-xs text-gray-500 leading-tight">{{ shortDuration(day.totalWearSeconds) }}</span>
        </div>
        <div v-else class="mt-1 w-2 h-2 rounded-full bg-gray-200"></div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { Icon } from '@iconify/vue';
import { useCalendar, type DayEntry } from '../composables/useCalendar.js';
import { useItems } from '../composables/useItems.js';
import { useCategories } from '../composables/useCategories.js';
import { shortDuration } from '../utils/formatDuration.js';

const { weekDays, loadWeekSessions, prevWeek, nextWeek, formatWeekRange } = useCalendar();
const { items, loadItems } = useItems();
const { categories, loadCategories } = useCategories();

onMounted(async () => {
  await Promise.all([loadWeekSessions(), loadItems(), loadCategories()]);
});

interface DayBadge { categoryId: number; icon: string | undefined; color: string; }

function dayBadges(day: DayEntry): DayBadge[] {
  const seen = new Set<number>();
  const badges: DayBadge[] = [];
  for (const session of day.sessions) {
    const item = items.value.find((i) => i.id === session.item_id);
    if (!item) continue;
    if (seen.has(item.category_id)) continue;
    seen.add(item.category_id);
    const category = categories.value.find((c) => c.id === item.category_id);
    badges.push({ categoryId: item.category_id, icon: category?.icon, color: item.color });
  }
  return badges;
}
</script>
