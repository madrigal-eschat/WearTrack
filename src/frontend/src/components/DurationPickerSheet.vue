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
          data-testid="duration-picker-cancel"
          @click="$emit('update:open', false)"
        >Cancel</button>
        <span class="font-semibold text-sm">Duration</span>
        <button
          type="button"
          class="absolute right-4 text-sm font-semibold text-blue-500"
          data-testid="duration-picker-done"
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
        class="relative w-32 overflow-y-scroll overscroll-none cursor-grab active:cursor-grabbing"
        style="scroll-snap-type: y mandatory; scrollbar-width: none; -webkit-overflow-scrolling: touch;"
        @scroll="onScroll('hours')"
        @mousedown="(e) => onColumnMouseDown('hours', e)"
      >
        <div class="h-[88px] shrink-0" />
        <div
          v-for="item in tripledHours"
          :key="item.key"
          class="flex h-[44px] select-none items-center justify-center text-xl"
          style="scroll-snap-align: center;"
          @click="(e) => onItemClick('hours', e)"
        >{{ item.value }}h</div>
        <div class="h-[88px] shrink-0" />
      </div>

      <!-- Minutes column -->
      <div
        ref="minutesEl"
        data-testid="minutes-col"
        class="relative w-32 overflow-y-scroll overscroll-none cursor-grab active:cursor-grabbing"
        style="scroll-snap-type: y mandatory; scrollbar-width: none; -webkit-overflow-scrolling: touch;"
        @scroll="onScroll('minutes')"
        @mousedown="(e) => onColumnMouseDown('minutes', e)"
      >
        <div class="h-[88px] shrink-0" />
        <div
          v-for="item in tripledMinutes"
          :key="item.key"
          class="flex h-[44px] select-none items-center justify-center text-xl"
          style="scroll-snap-align: center;"
          @click="(e) => onItemClick('minutes', e)"
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

// Drag state — plain object, not reactive (no need to trigger renders)
const drag = {
  active: false,
  col: 'hours' as 'hours' | 'minutes',
  startY: 0,
  startScrollTop: 0,
  moved: false,
};

function colEl(col: 'hours' | 'minutes'): HTMLElement | null {
  return col === 'hours' ? hoursEl.value : minutesEl.value;
}

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
  const el = colEl(col);
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

// ── Mouse drag-to-scroll ──────────────────────────────────────────────────────

function onDragMove(e: MouseEvent) {
  if (!drag.active) return;
  const el = colEl(drag.col);
  if (!el) return;
  const dy = drag.startY - e.clientY;
  if (Math.abs(dy) > 3) drag.moved = true;
  el.scrollTop = drag.startScrollTop + dy;
  e.preventDefault();
}

function onDragEnd() {
  drag.active = false;
  document.removeEventListener('mousemove', onDragMove);
  document.removeEventListener('mouseup', onDragEnd);
  // Trigger snap-to-nearest-item after releasing
  onScroll(drag.col);
}

function onColumnMouseDown(col: 'hours' | 'minutes', e: MouseEvent) {
  const el = colEl(col);
  if (!el) return;
  drag.active = true;
  drag.col = col;
  drag.startY = e.clientY;
  drag.startScrollTop = el.scrollTop;
  drag.moved = false;
  document.addEventListener('mousemove', onDragMove, { passive: false } as AddEventListenerOptions);
  document.addEventListener('mouseup', onDragEnd);
}

// ── Click-to-select ───────────────────────────────────────────────────────────

function onItemClick(col: 'hours' | 'minutes', e: MouseEvent) {
  // If this click followed a drag, ignore it
  if (drag.moved) return;
  const el = colEl(col);
  if (!el) return;
  const item = e.currentTarget as HTMLElement;
  const containerRect = el.getBoundingClientRect();
  const itemRect = item.getBoundingClientRect();
  // Scroll so the clicked item's centre aligns with the container's centre
  const targetScrollTop =
    el.scrollTop + (itemRect.top + ITEM_H / 2 - (containerRect.top + el.clientHeight / 2));
  el.scrollTo({ top: targetScrollTop, behavior: 'smooth' });
}

// ── Done ─────────────────────────────────────────────────────────────────────

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

onUnmounted(() => {
  clearScrollTimers();
  document.removeEventListener('mousemove', onDragMove);
  document.removeEventListener('mouseup', onDragEnd);
});
</script>
