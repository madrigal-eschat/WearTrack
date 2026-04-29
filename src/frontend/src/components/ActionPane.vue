<template>
  <div class="action-pane overflow-y-auto">
    <k-block-title>Currently Wearing</k-block-title>

    <div v-if="currentSessions.length === 0" class="px-4 py-8 text-center text-gray-400">
      Loading…
    </div>

    <k-list v-else>
      <k-list-item
        v-for="entry in currentSessions"
        :key="entry.category.id"
        :title="entry.category.name"
        :subtitle="subtitle(entry)"
      >
        <template #media>
          <Icon
            v-if="entry.category.icon?.includes(':')"
            :icon="entry.category.icon"
            class="text-2xl w-8 h-8"
            :style="{ color: entry.session && entry.item ? entry.item.color : 'black' }"
          />
          <span v-else class="text-2xl">{{ entry.category.icon }}</span>
        </template>
        <template v-if="entry.session && entry.item" #inner>
          <div class="h-1.5 rounded-full bg-gray-200 overflow-hidden mt-1">
            <div
              class="h-full rounded-full transition-all duration-1000"
              :style="{
                width: wearProgress(entry) + '%',
                background: entry.item.color,
              }"
            ></div>
          </div>
        </template>
        <template #after>
          <div class="flex gap-2 items-center">
            <!-- Active session: show elapsed + Stop -->
            <template v-if="entry.session !== null">
              <div class="text-right tabular-nums leading-snug whitespace-nowrap">
                <div class="text-sm text-gray-600"><span class="text-xs text-gray-400 uppercase tracking-wide mr-1">Worn</span>{{ elapsed(entry.session) }}</div>
                <div v-if="entry.item" class="text-sm text-gray-600 mt-0.5"><span class="text-xs text-gray-400 uppercase tracking-wide mr-1">Max</span>{{ maxWear(entry) }}</div>
              </div>
              <k-button
                small
                outline
                @click="onStop(entry)"
              >Stop</k-button>
            </template>
            <!-- No session: show item picker + Wear buttons -->
            <template v-else>
              <select
                v-if="itemsForCategory(entry.category.id).length > 0"
                v-model="selectedItem[entry.category.id]"
                class="text-sm border rounded px-1 py-0.5"
              >
                <option
                  v-for="item in itemsForCategory(entry.category.id)"
                  :key="item.id"
                  :value="item.id"
                >{{ item.name }}</option>
              </select>
              <span v-else class="text-sm text-gray-400 italic">No items</span>
              <k-button
                small
                :disabled="!selectedItem[entry.category.id]"
                @click="onWear(entry)"
              >Wear</k-button>
            </template>
          </div>
        </template>
      </k-list-item>
    </k-list>
  </div>
</template>

<script setup lang="ts">
import { reactive, onMounted } from 'vue';
import { Icon } from '@iconify/vue';
import { kBlockTitle, kList, kListItem, kButton } from 'konsta/vue';
import { useWear, type CurrentEntry, type Session } from '../composables/useWear.js';
import { useItems } from '../composables/useItems.js';
import { useToast } from '../composables/useToast.js';
import { formatDuration } from '../utils/formatDuration.js';

const { currentSessions, startSession, endSession, currentWear, fetchCurrent } = useWear();
const { loadItems, itemsForCategory } = useItems();
const { showError } = useToast();

const selectedItem = reactive<Record<number, number | null>>({});

onMounted(async () => {
  await loadItems();
  // Pre-select first item for each category
  for (const entry of currentSessions.value) {
    const first = itemsForCategory(entry.category.id)[0];
    selectedItem[entry.category.id] = first?.id ?? null;
  }
});

function subtitle(entry: CurrentEntry): string {
  if (entry.session !== null && entry.item !== null) {
    return entry.item.name;
  }
  return 'Idle';
}

function elapsed(session: Session): string {
  return formatDuration(currentWear(session));
}

function maxWear(entry: CurrentEntry): string {
  if (!entry.item) return '';
  const seconds = entry.category.initial_wear_duration_seconds * entry.item.difficulty_multiplier;
  return formatDuration(seconds);
}

function wearProgress(entry: CurrentEntry): number {
  if (!entry.session || !entry.item) return 0;
  const max = entry.category.initial_wear_duration_seconds * entry.item.difficulty_multiplier;
  if (max <= 0) return 0;
  return Math.min((currentWear(entry.session) / max) * 100, 100);
}

async function onWear(entry: CurrentEntry) {
  const itemId = selectedItem[entry.category.id];
  if (!itemId) return;
  try {
    await startSession(itemId);
  } catch (e) {
    showError(String(e));
  }
}

async function onStop(entry: CurrentEntry) {
  if (!entry.session) return;
  try {
    await endSession(entry.session.id);
  } catch (e) {
    showError(String(e));
  }
}
</script>
