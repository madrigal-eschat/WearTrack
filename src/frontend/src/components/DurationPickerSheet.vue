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
        <SectionTitle variant="sheet">Duration</SectionTitle>
        <button
          type="button"
          class="absolute right-4 text-sm font-semibold text-blue-500"
          data-testid="duration-picker-done"
          @click="onDone"
        >Done</button>
      </div>
    </k-toolbar>

    <div
      class="
        relative flex h-[220px] items-stretch justify-center overflow-hidden
      "
    >
      <!-- Selection highlight bar sits at the vertical centre -->
      <div
        class="
          pointer-events-none absolute inset-x-0 h-[44px] border-y
          border-gray-200 bg-gray-100
        "
        style="top: calc(50% - 22px)"
      />

      <!-- Days column -->
      <div
        ref="daysEl"
        data-testid="days-col"
        class="
          relative w-24 overflow-y-scroll overscroll-none cursor-grab
          active:cursor-grabbing
        "
        style="scrollbar-width: none; -webkit-overflow-scrolling: touch;"
        @scroll="onScroll('days')"
        @mousedown="(e) => onColumnMouseDown('days', e)"
      >
        <div class="h-[88px] shrink-0" />
        <div
          v-for="item in tripledDays"
          :key="item.key"
          class="flex h-[44px] select-none items-center justify-center text-xl"
          @click="(e) => onItemClick('days', e)"
        >{{ item.value }}d</div>
        <div class="h-[88px] shrink-0" />
      </div>

      <!-- Hours column -->
      <div
        ref="hoursEl"
        data-testid="hours-col"
        class="
          relative w-24 overflow-y-scroll overscroll-none cursor-grab
          active:cursor-grabbing
        "
        style="scrollbar-width: none; -webkit-overflow-scrolling: touch;"
        @scroll="onScroll('hours')"
        @mousedown="(e) => onColumnMouseDown('hours', e)"
      >
        <div class="h-[88px] shrink-0" />
        <div
          v-for="item in tripledHours"
          :key="item.key"
          class="flex h-[44px] select-none items-center justify-center text-xl"
          @click="(e) => onItemClick('hours', e)"
        >{{ item.value }}h</div>
        <div class="h-[88px] shrink-0" />
      </div>

      <!-- Minutes column -->
      <div
        ref="minutesEl"
        data-testid="minutes-col"
        class="
          relative w-24 overflow-y-scroll overscroll-none cursor-grab
          active:cursor-grabbing
        "
        style="scrollbar-width: none; -webkit-overflow-scrolling: touch;"
        @scroll="onScroll('minutes')"
        @mousedown="(e) => onColumnMouseDown('minutes', e)"
      >
        <div class="h-[88px] shrink-0" />
        <div
          v-for="item in tripledMinutes"
          :key="item.key"
          class="flex h-[44px] select-none items-center justify-center text-xl"
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
import SectionTitle from './SectionTitle.vue';

const ITEM_H = 44;
const DAY_COUNT = 31;   // 0–30 d
const HOUR_COUNT = 24;
const MIN_COUNT = 60;

type Col = 'days' | 'hours' | 'minutes';

const props = defineProps<{ modelValue: number; open: boolean }>();
const emit = defineEmits<{
  'update:modelValue': [value: number];
  'update:open': [value: boolean];
}>();

const daysEl    = ref<HTMLElement | null>(null);
const hoursEl   = ref<HTMLElement | null>(null);
const minutesEl = ref<HTMLElement | null>(null);
const curDays    = ref(0);
const curHours   = ref(0);
const curMinutes = ref(0);
const scrollTimers: Record<string, ReturnType<typeof setTimeout>> = {};

// How far a release "flicks": projected scroll distance = velocity
// (px/ms) × this.
const MOMENTUM_MS = 140;

// Drag state — plain object, not reactive (no need to trigger renders)
const drag = {
  active: false,
  col: 'hours' as Col,
  startY: 0,
  startScrollTop: 0,
  moved: false,
  lastY: 0,
  lastT: 0,
  velocity: 0, // px/ms, +ve = scrolling down (scrollTop increasing)
};

function colEl(col: Col): HTMLElement | null {
  if (col === 'days')    {
    return daysEl.value;
  }
  if (col === 'hours')   {
    return hoursEl.value;
  }
  return minutesEl.value;
}

function colCount(col: Col): number {
  if (col === 'days')  {
    return DAY_COUNT;
  }
  if (col === 'hours') {
    return HOUR_COUNT;
  }
  return MIN_COUNT;
}

const tripledDays = computed(() =>
  Array.from({ length: DAY_COUNT * 3 }, (_, i) => ({
    key: i,
    value: i % DAY_COUNT,
  })),
);
const tripledHours = computed(() =>
  Array.from({ length: HOUR_COUNT * 3 }, (_, i) => ({
    key: i,
    value: i % HOUR_COUNT,
  })),
);
const tripledMinutes = computed(() =>
  Array.from({ length: MIN_COUNT * 3 }, (_, i) => ({
    key: i,
    value: i % MIN_COUNT,
  })),
);

function clearScrollTimers() {
  clearTimeout(scrollTimers['days']);
  clearTimeout(scrollTimers['hours']);
  clearTimeout(scrollTimers['minutes']);
}

function initScroll() {
  clearScrollTimers();
  const totalSeconds = props.modelValue;
  const d = Math.floor(totalSeconds / 86400) % DAY_COUNT;
  const h = Math.floor((totalSeconds % 86400) / 3600) % HOUR_COUNT;
  const m = Math.floor((totalSeconds % 3600) / 60) % MIN_COUNT;
  curDays.value    = d;
  curHours.value   = h;
  curMinutes.value = m;
  nextTick(() => {
    if (daysEl.value)    {
      daysEl.value.scrollTop    = (DAY_COUNT  + d) * ITEM_H;
    }
    if (hoursEl.value)   {
      hoursEl.value.scrollTop   = (HOUR_COUNT + h) * ITEM_H;
    }
    if (minutesEl.value) {
      minutesEl.value.scrollTop = (MIN_COUNT  + m) * ITEM_H;
    }
  });
}

function doWrap(col: Col) {
  const el = colEl(col);
  const count = colCount(col);
  if (!el) {
    return;
  }
  const index = Math.round(el.scrollTop / ITEM_H);
  const value = ((index % count) + count) % count;
  if (col === 'days')    {
    curDays.value    = value;
  } else if (col === 'hours')   {
    curHours.value   = value;
  } else                        {
    curMinutes.value = value;
  }
  if (index < count || index >= count * 2) {
    // Out of the middle third: jump by a whole period (instant, invisible —
    // the same value stays centred) to keep the infinite loop going.
    el.scrollTop = (count + value) * ITEM_H;
  } else {
    // In range: smoothly settle onto the centre of the nearest item. (CSS
    // scroll-snap no longer does this, so free-scroll glides and then
    // eases in.)
    const centered = index * ITEM_H;
    if (Math.abs(el.scrollTop - centered) > 0.5) {
      el.scrollTo({ top: centered, behavior: 'smooth' });
    }
  }
}

function onScroll(col: Col) {
  clearTimeout(scrollTimers[col]);
  scrollTimers[col] = setTimeout(() => doWrap(col), 150);
}

// ── Mouse drag-to-scroll ───────────────────────────────────────────────

function onDragMove(e: MouseEvent) {
  if (!drag.active) {
    return;
  }
  const el = colEl(drag.col);
  if (!el) {
    return;
  }
  const dy = drag.startY - e.clientY;
  if (Math.abs(dy) > 3) {
    drag.moved = true;
  }
  el.scrollTop = drag.startScrollTop + dy;
  // Track instantaneous velocity for the release flick.
  const now = performance.now();
  const dt = now - drag.lastT;
  if (dt > 0) {
    drag.velocity = (drag.lastY - e.clientY) / dt;
  }
  drag.lastY = e.clientY;
  drag.lastT = now;
  e.preventDefault();
}

function onDragEnd() {
  drag.active = false;
  document.removeEventListener('mousemove', onDragMove);
  document.removeEventListener('mouseup', onDragEnd);
  const el = colEl(drag.col);
  if (el) {
    // Flick: glide on past the release point proportional to velocity, then
    // settle on the nearest item. doWrap (on scroll-settle) handles the final
    // centering + infinite-loop reposition.
    const projected = el.scrollTop + drag.velocity * MOMENTUM_MS;
    const targetTop = Math.round(projected / ITEM_H) * ITEM_H;
    el.scrollTo({ top: targetTop, behavior: 'smooth' });
  }
  drag.velocity = 0;
  onScroll(drag.col);
}

function onColumnMouseDown(col: Col, e: MouseEvent) {
  const el = colEl(col);
  if (!el) {
    return;
  }
  drag.active = true;
  drag.col = col;
  drag.startY = e.clientY;
  drag.startScrollTop = el.scrollTop;
  drag.moved = false;
  drag.lastY = e.clientY;
  drag.lastT = performance.now();
  drag.velocity = 0;
  document.addEventListener(
    'mousemove',
    onDragMove,
    { passive: false } as AddEventListenerOptions,
  );
  document.addEventListener('mouseup', onDragEnd);
}

// ── Click-to-select ────────────────────────────────────────────────────

function onItemClick(col: Col, e: MouseEvent) {
  if (drag.moved) {
    return;
  }
  const el = colEl(col);
  if (!el) {
    return;
  }
  const item = e.currentTarget as HTMLElement;
  const containerRect = el.getBoundingClientRect();
  const itemRect = item.getBoundingClientRect();
  const targetScrollTop =
    el.scrollTop +
    (itemRect.top + ITEM_H / 2 - (containerRect.top + el.clientHeight / 2));
  el.scrollTo({ top: targetScrollTop, behavior: 'smooth' });
}

// ── Done ───────────────────────────────────────────────────────────────

function onDone() {
  if (daysEl.value) {
    const idx = Math.round(daysEl.value.scrollTop / ITEM_H);
    curDays.value = ((idx % DAY_COUNT) + DAY_COUNT) % DAY_COUNT;
  }
  if (hoursEl.value) {
    const idx = Math.round(hoursEl.value.scrollTop / ITEM_H);
    curHours.value = ((idx % HOUR_COUNT) + HOUR_COUNT) % HOUR_COUNT;
  }
  if (minutesEl.value) {
    const idx = Math.round(minutesEl.value.scrollTop / ITEM_H);
    curMinutes.value = ((idx % MIN_COUNT) + MIN_COUNT) % MIN_COUNT;
  }
  emit(
    'update:modelValue',
    curDays.value * 86400 + curHours.value * 3600 + curMinutes.value * 60,
  );
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
