<template>
  <k-sheet
    v-if="open"
    :opened="open"
    @backdropclick="close"
    class="pb-safe bg-white dark:bg-gray-900 flex flex-col"
    style="height: 85vh"
  >
    <!-- Header -->
    <k-toolbar>
      <div class="flex w-full items-center justify-between px-4">
        <span class="font-semibold">Choose Icon</span>
        <k-button clear @click="close">✕</k-button>
      </div>
    </k-toolbar>

    <!-- Search -->
    <div class="px-4 py-2 shrink-0">
      <input
        v-model="query"
        type="search"
        placeholder="Search icons…"
        class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
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
        class="shrink-0 px-3 py-1 rounded-full text-xs border transition-colors whitespace-nowrap"
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
        <p v-if="searchResults.length === 0" class="text-center py-8 text-gray-400 text-sm">
          No icons found
        </p>
        <div v-else class="grid gap-1" style="grid-template-columns: repeat(8, minmax(0, 1fr))">
          <button
            v-for="entry in searchResults"
            :key="entry.id"
            type="button"
            class="flex items-center justify-center w-10 h-10 rounded-lg"
            :class="entry.id === modelValue ? 'ring-2 ring-blue-500 bg-blue-50' : 'hover:bg-gray-100'"
            :title="entry.id.slice(3)"
            @click="select(entry.id)"
          >
            <Icon :icon="entry.id" class="text-2xl" />
          </button>
        </div>
      </template>

      <!-- Categorised mode: sections with headings -->
      <template v-else>
        <div v-for="cat in categoryNames" :key="cat">
          <h3
            :ref="(el) => setHeadingRef(cat, el)"
            :data-category="cat"
            class="text-xs font-semibold text-gray-500 uppercase tracking-wide mt-4 mb-2"
          >
            {{ cat }}
          </h3>
          <div class="grid gap-1" style="grid-template-columns: repeat(8, minmax(0, 1fr))">
            <button
              v-for="entry in (categoriesData as PhCategories)[cat]"
              :key="entry.id"
              type="button"
              class="flex items-center justify-center w-10 h-10 rounded-lg"
              :class="entry.id === modelValue ? 'ring-2 ring-blue-500 bg-blue-50' : 'hover:bg-gray-100'"
              :title="entry.id.slice(3)"
              @click="select(entry.id)"
            >
              <Icon :icon="entry.id" class="text-2xl" />
            </button>
          </div>
        </div>
      </template>

    </div>
  </k-sheet>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import { Icon } from '@iconify/vue';
import { kSheet, kToolbar, kButton } from 'konsta/vue';
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

// Non-reactive element maps — Vue doesn't need to track individual el references
const headingEls: Record<string, HTMLElement | null> = {};
const pillEls: Record<string, HTMLElement | null> = {};

let observer: IntersectionObserver | null = null;

const categoryNames = computed(() => Object.keys(categoriesData as PhCategories));

const searchResults = computed(() =>
  filterIcons(categoriesData as PhCategories, query.value)
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
  if (!gridEl.value) return;
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          const cat = (entry.target as HTMLElement).dataset.category ?? '';
          activeCategory.value = cat;
          pillEls[cat]?.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
          break;
        }
      }
    },
    {
      root: gridEl.value,
      threshold: 0.1,
    }
  );
  for (const el of Object.values(headingEls)) {
    if (el) observer.observe(el);
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
    } else {
      nextTick(() => setupObserver());
    }
  }
);
</script>
