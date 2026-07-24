<template>
  <k-sheet
    v-if="open"
    :opened="open"
    @backdropclick="close"
    class="
      pb-safe bg-white dark:bg-gray-900 flex flex-col overflow-hidden
      h-[85vh]
    "
  >
    <!-- Header -->
    <k-toolbar innerClass="!h-6 !w-full">
      <div class="relative flex w-full items-center justify-center">
        <button
          type="button"
          class="
            absolute left-0 flex items-center justify-center w-8 h-full
            text-primary text-xl
          "
          @click="close"
        >✕</button>
        <SectionTitle variant="sheet">Choose Icon</SectionTitle>
      </div>
    </k-toolbar>

    <!-- Search -->
    <div class="px-4 py-2 shrink-0">
      <input
        v-model="query"
        type="search"
        placeholder="Search icons…"
        class="
          w-full border border-gray-300 rounded-lg px-3 py-2 text-sm
          focus:outline-none focus:ring-2 focus:ring-blue-500
        "
      />
    </div>

    <!-- Category shortcut pills (hidden while searching) -->
    <div
      v-if="!query.trim()"
      class="flex gap-2 overflow-x-auto px-4 pb-2 shrink-0"
      style="scrollbar-width: none; -webkit-overflow-scrolling: touch"
    >
      <button
        v-for="cat in categoryNames"
        :key="cat"
        :ref="(el) => setPillRef(cat, el)"
        type="button"
        class="
          shrink-0 px-3 py-1 rounded-full text-xs border transition-colors
          whitespace-nowrap
        "
        :class="
          activeCategory === cat
            ? 'bg-blue-500 text-white border-blue-500'
            : 'bg-white text-gray-600 border-gray-300'
        "
        @click="scrollToCategory(cat)"
      >
        {{ cat }}
      </button>
    </div>

    <!-- Scrollable icon grid -->
    <div ref="gridEl" class="overflow-y-auto flex-1 px-4 pb-8">

      <!-- Search mode: flat deduplicated grid -->
      <template v-if="query.trim()">
        <p
          v-if="searchResults.length === 0"
          class="text-center py-8 text-gray-400 text-sm"
        >
          No icons found
        </p>
        <IconGrid
          v-else
          :entries="searchResults"
          :selected-id="modelValue"
          @select="select"
        />
      </template>

      <!-- Categorised mode: sections with headings -->
      <template v-else>
        <div v-for="cat in categoryNames" :key="cat">
          <h3
            :ref="(el) => setHeadingRef(cat, el)"
            :data-category="cat"
            class="mt-4 mb-2"
          >
            <SectionTitle variant="group">{{ cat }}</SectionTitle>
          </h3>
          <IconGrid
            :entries="(categoriesData as PhCategories)[cat]"
            :selected-id="modelValue"
            @select="select"
          />
        </div>
      </template>

    </div>
  </k-sheet>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onUnmounted } from 'vue';
import { kSheet, kToolbar } from 'konsta/vue';
import SectionTitle from './SectionTitle.vue';
import IconGrid from './IconGrid.vue';
import type { PhCategories } from '../utils/phCategories.js';
import { filterIcons } from '../utils/phCategories.js';
import categoriesData from '../generated/ph-categories.json';

const props = defineProps<{ modelValue: string; open: boolean }>();
const emit = defineEmits<{
  'update:modelValue': [value: string];
  'update:open': [value: boolean];
}>();

const query = ref('');
const activeCategory = ref('');
const gridEl = ref<HTMLElement | null>(null);

// Non-reactive element maps — Vue doesn't need to track individual el
// references
const headingEls: Record<string, HTMLElement | null> = {};
const pillEls: Record<string, HTMLElement | null> = {};

let observer: IntersectionObserver | null = null;

const categoryNames = computed(() =>
  Object.keys(categoriesData as PhCategories),
);

const searchResults = computed(() =>
  filterIcons(categoriesData as PhCategories, query.value),
);

function setHeadingRef(cat: string, el: unknown) {
  headingEls[cat] = el as HTMLElement | null;
}

function setPillRef(cat: string, el: unknown) {
  pillEls[cat] = el as HTMLElement | null;
}

function select(id: string) {
  emit('update:modelValue', id);
  emit('update:open', false);
}

function close() {
  emit('update:open', false);
}

function scrollToCategory(cat: string) {
  headingEls[cat]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function setupObserver() {
  observer?.disconnect();
  if (!gridEl.value) {
    return;
  }
  observer = new IntersectionObserver(
    (entries) => {
      const visible = entries.filter((e) => e.isIntersecting);
      if (!visible.length) {
        return;
      }
      visible.sort(
        (a, b) => a.boundingClientRect.top - b.boundingClientRect.top,
      );
      const cat = (visible[0].target as HTMLElement).dataset.category ?? '';
      activeCategory.value = cat;
      pillEls[cat]?.scrollIntoView({
        behavior: 'smooth',
        inline: 'nearest',
        block: 'nearest',
      });
    },
    {
      root: gridEl.value,
      threshold: 0.1,
    },
  );
  for (const el of Object.values(headingEls)) {
    if (el) {
      observer.observe(el);
    }
  }
}

watch(
  () => props.open,
  (val) => {
    if (!val) {
      query.value = '';
      activeCategory.value = '';
      observer?.disconnect();
      observer = null;
      // Clear element maps — pills may not fire null-ref callbacks if
      // hidden when sheet closes
      for (const key of Object.keys(headingEls)) {
        headingEls[key] = null;
      }
      for (const key of Object.keys(pillEls)) {
        pillEls[key] = null;
      }
    } else {
      nextTick(() => setupObserver());
    }
  },
);

// Guard against navigating away while the picker is open (watch won't
// fire in that case)
onUnmounted(() => {
  observer?.disconnect();
  observer = null;
});
</script>
