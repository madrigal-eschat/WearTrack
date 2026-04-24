<template>
  <div class="calendar-pane flex flex-col">
    <div class="flex items-center justify-between px-4 py-2">
      <k-button small outline @click="prevWeek">‹</k-button>
      <span class="text-sm font-medium">{{ formatWeekRange() }}</span>
      <k-button small outline @click="nextWeek">›</k-button>
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
          <div class="w-2 h-2 rounded-full bg-blue-400 mb-0.5"></div>
          <span class="text-xs text-gray-500">{{ shortDuration(day.totalWearSeconds) }}</span>
        </div>
        <div v-else class="mt-1 w-2 h-2 rounded-full bg-gray-200"></div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import { kButton } from 'konsta/vue';
import { useCalendar } from '../composables/useCalendar.js';
import { shortDuration } from '../utils/formatDuration.js';

const { weekDays, loadWeekSessions, prevWeek, nextWeek, formatWeekRange } = useCalendar();

onMounted(loadWeekSessions);
</script>
