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
          <span class="text-2xl">{{ entry.category.icon }}</span>
        </template>
        <template #after>
          <div class="flex gap-2 items-center">
            <!-- Active session: show elapsed + Stop -->
            <template v-if="entry.session !== null">
              <span class="text-sm text-gray-500 tabular-nums">{{ elapsed(entry.session) }}</span>
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
import { ref, reactive, onMounted } from 'vue';
import { kBlockTitle, kList, kListItem, kButton } from 'konsta/vue';
import { useWear, type CurrentEntry, type Session } from '../composables/useWear.js';
import { useItems } from '../composables/useItems.js';
import type { Item } from '../composables/useWear.js';
import { formatDuration } from '../utils/formatDuration.js';

const { currentSessions, startSession, endSession, currentWear, fetchCurrent } = useWear();
const { items, loadItems } = useItems();

const selectedItem = reactive<Record<number, number | null>>({});

onMounted(async () => {
  await loadItems();
  // Pre-select first item for each category
  for (const entry of currentSessions.value) {
    const first = itemsForCategory(entry.category.id)[0];
    selectedItem[entry.category.id] = first?.id ?? null;
  }
});

function itemsForCategory(categoryId: number): Item[] {
  return items.value.filter((i) => i.category_id === categoryId);
}

function subtitle(entry: CurrentEntry): string {
  if (entry.session !== null && entry.item !== null) {
    return entry.item.name;
  }
  return 'Idle';
}

function elapsed(session: Session): string {
  return formatDuration(currentWear(session));
}

async function onWear(entry: CurrentEntry) {
  const itemId = selectedItem[entry.category.id];
  if (!itemId) return;
  try {
    await startSession(itemId);
  } catch (e) {
    alert(String(e));
  }
}

async function onStop(entry: CurrentEntry) {
  if (!entry.session) return;
  try {
    await endSession(entry.session.id);
  } catch (e) {
    alert(String(e));
  }
}
</script>
