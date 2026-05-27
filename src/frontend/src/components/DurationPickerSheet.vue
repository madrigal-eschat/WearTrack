<template>
  <k-sheet
    v-if="open"
    :opened="open"
    @backdropclick="$emit('update:open', false)"
    class="pb-safe bg-white dark:bg-gray-900"
  >
    <k-toolbar innerClass="!h-10 !w-full">
      <div class="relative flex w-full items-center justify-center">
        <button
          type="button"
          class="absolute left-4 text-sm text-blue-500"
          @click="$emit('update:open', false)"
        >Cancel</button>
        <span class="font-semibold text-sm">Duration</span>
        <button
          type="button"
          class="absolute right-4 text-sm font-semibold text-blue-500"
          @click="onDone"
        >Done</button>
      </div>
    </k-toolbar>

    <div class="relative flex h-[220px] items-stretch justify-center overflow-hidden">
      <!-- Selection highlight bar sits at the vertical centre -->
      <div
        class="pointer-events-none absolute inset-x-0 h-[44px] border-y border-gray-200 bg-gray-100"
        style="top: calc(50% - 22px)"
      />

      <!-- Hours column -->
      <div
        ref="hoursEl"
        data-testid="hours-col"
        class="w-32 overflow-y-scroll overscroll-none"
        style="scroll-snap-type: y mandatory; scrollbar-width: none; -webkit-overflow-scrolling: touch;"
        @scroll="onScroll('hours')"
      >
        <div class="h-[88px] shrink-0" />
        <div
          v-for="item in tripledHours"
          :key="item.key"
          class="flex h-[44px] select-none items-center justify-center text-xl"
          style="scroll-snap-align: center;"
        >{{ item.value }}h</div>
        <div class="h-[88px] shrink-0" />
      </div>

      <!-- Minutes column -->
      <div
        ref="minutesEl"
        data-testid="minutes-col"
        class="w-32 overflow-y-scroll overscroll-none"
        style="scroll-snap-type: y mandatory; scrollbar-width: none; -webkit-overflow-scrolling: touch;"
        @scroll="onScroll('minutes')"
      >
        <div class="h-[88px] shrink-0" />
        <div
          v-for="item in tripledMinutes"
          :key="item.key"
          class="flex h-[44px] select-none items-center justify-center text-xl"
          style="scroll-snap-align: center;"
        >{{ String(item.value).padStart(2, '0') }}m</div>
        <div class="h-[88px] shrink-0" />
      </div>
    </div>
  </k-sheet>
</template>

<script setup lang="ts">
import { ref, computed, watch, onUnmounted, nextTick } from 'vue';
import { kSheet, kToolbar } from 'konsta/vue';

const ITEM_H = 44;
const HOUR_COUNT = 24;
const MIN_COUNT = 60;

const props = defineProps<{ modelValue: number; open: boolean }>();
const emit = defineEmits<{
  'update:modelValue': [value: number];
  'update:open': [value: boolean];
}>();

const hoursEl = ref<HTMLElement | null>(null);
const minutesEl = ref<HTMLElement | null>(null);
const curHours = ref(0);
const curMinutes = ref(0);
const scrollTimers: Record<string, ReturnType<typeof setTimeout>> = {};

const tripledHours = computed(() =>
  Array.from({ length: HOUR_COUNT * 3 }, (_, i) => ({ key: i, value: i % HOUR_COUNT }))
);
const tripledMinutes = computed(() =>
  Array.from({ length: MIN_COUNT * 3 }, (_, i) => ({ key: i, value: i % MIN_COUNT }))
);

function clearScrollTimers() {
  clearTimeout(scrollTimers['hours']);
  clearTimeout(scrollTimers['minutes']);
}

function initScroll() {
  clearScrollTimers();
  const h = Math.floor(props.modelValue / 3600) % HOUR_COUNT;
  const m = Math.floor((props.modelValue % 3600) / 60) % MIN_COUNT;
  curHours.value = h;
  curMinutes.value = m;
  nextTick(() => {
    if (hoursEl.value) hoursEl.value.scrollTop = (HOUR_COUNT + h) * ITEM_H;
    if (minutesEl.value) minutesEl.value.scrollTop = (MIN_COUNT + m) * ITEM_H;
  });
}

function doWrap(col: 'hours' | 'minutes') {
  const el = col === 'hours' ? hoursEl.value : minutesEl.value;
  const count = col === 'hours' ? HOUR_COUNT : MIN_COUNT;
  if (!el) return;
  const index = Math.round(el.scrollTop / ITEM_H);
  const value = ((index % count) + count) % count;
  if (col === 'hours') curHours.value = value;
  else curMinutes.value = value;
  if (index < count || index >= count * 2) {
    el.scrollTop = (count + value) * ITEM_H;
  }
}

function onScroll(col: 'hours' | 'minutes') {
  clearTimeout(scrollTimers[col]);
  scrollTimers[col] = setTimeout(() => doWrap(col), 150);
}

function onDone() {
  // Read scroll positions directly in case the debounce hasn't fired yet
  if (hoursEl.value) {
    const idx = Math.round(hoursEl.value.scrollTop / ITEM_H);
    curHours.value = ((idx % HOUR_COUNT) + HOUR_COUNT) % HOUR_COUNT;
  }
  if (minutesEl.value) {
    const idx = Math.round(minutesEl.value.scrollTop / ITEM_H);
    curMinutes.value = ((idx % MIN_COUNT) + MIN_COUNT) % MIN_COUNT;
  }
  emit('update:modelValue', curHours.value * 3600 + curMinutes.value * 60);
  emit('update:open', false);
}

watch(
  () => props.open,
  (val) => {
    if (val) {
      clearScrollTimers();
      initScroll();
    } else {
      clearScrollTimers();
    }
  },
);

onUnmounted(clearScrollTimers);
</script>
