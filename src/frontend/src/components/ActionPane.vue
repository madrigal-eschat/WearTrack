<template>
  <div class="action-pane overflow-y-auto">
    <div class="flex items-center justify-between">
      <k-block-title>Currently Wearing</k-block-title>
    </div>

    <div v-if="!loaded" class="px-4 py-8 text-center text-gray-400">
      Loading…
    </div>
    <div v-else-if="currentSessions.length === 0" class="px-4 py-8 text-center text-gray-400">
      No active sessions
    </div>

    <k-list v-else>
      <k-list-item
        v-for="entry in currentSessions"
        :key="entry.category.id"
        :title="entry.category.name"
        :subtitle="subtitle(entry)"
        :class="rowBg(entry)"
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
          <div class="relative h-1.5 rounded-full bg-gray-200 overflow-hidden mt-1">
            <div class="h-full rounded-full transition-all duration-1000"
              :style="{ width: wearProgress(entry) + '%', background: entry.item.color }"></div>
            <div class="absolute top-0 bottom-0 w-0.5 bg-gray-600"
              :style="{ left: targetMarkerPercent(entry) + '%' }" data-testid="target-marker"></div>
          </div>
        </template>
        <template #after>
          <div class="flex gap-2 items-center">
            <!-- Active session: show elapsed + Stop -->
            <template v-if="entry.session !== null">
              <div class="text-right tabular-nums leading-snug whitespace-nowrap">
                <div class="flex gap-3 justify-end">
                  <span class="text-sm text-gray-600"><span class="text-xs text-gray-400 uppercase tracking-wide mr-1">Worn</span>{{ elapsed(entry.session) }}</span>
                  <span class="text-sm" :class="isOverdue(entry) ? 'text-red-600 font-semibold' : 'text-gray-600'"><span class="text-xs text-gray-400 uppercase tracking-wide mr-1">Remaining</span>{{ remainingLabel(entry) }}</span>
                </div>
                <div class="flex gap-3 justify-end mt-0.5">
                  <span class="text-sm text-gray-600"><span class="text-xs text-gray-400 uppercase tracking-wide mr-1">Target</span>{{ targetLabel(entry) }}</span>
                  <span v-if="entry.session.max_wear_seconds !== null" class="text-sm text-gray-600"><span class="text-xs text-gray-400 uppercase tracking-wide mr-1">Max</span>{{ maxWear(entry) }}</span>
                </div>
              </div>
              <k-button
                small
                outline
                @click="onStop(entry)"
              >Stop</k-button>
            </template>
            <!-- No session: show item picker + Wear button, with target/max tucked below on small screens -->
            <template v-else>
              <div class="flex flex-col items-end gap-1">
              <div class="flex flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-2">
                <!-- controls — first on mobile, second on wide (sm:order-2) -->
                <div class="flex gap-2 items-center sm:order-2">
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
                    :class="{ 'opacity-60': restRemainingSeconds(entry) > 0 }"
                    @click="restRemainingSeconds(entry) > 0 ? showRestWarning(entry) : onWear(entry)"
                  >Wear</k-button>
                </div>
                <!-- target/max — second on mobile (below), first on wide (sm:order-1) -->
                <div v-if="selectedItemData(entry)" class="text-right tabular-nums leading-snug whitespace-nowrap sm:order-1">
                  <div class="text-xs text-gray-600 sm:text-sm">
                    <span class="text-xs text-gray-400 uppercase tracking-wide mr-1">Target</span>{{ idleTarget(entry) }}
                    <template v-if="idleMax(entry)">
                      <span class="mx-1 text-gray-300 sm:hidden">·</span>
                      <span class="hidden sm:inline mx-1 text-gray-300">/</span>
                      <span class="text-xs text-gray-400 uppercase tracking-wide mr-1">Max</span>{{ idleMax(entry) }}
                    </template>
                  </div>
                </div>
                <!-- Decay info: "Start before" date + warning badge (category-level, always visible) -->
                <template v-if="entry.decay_start_time !== null">
                  <div class="text-right text-xs text-gray-500 mt-0.5 whitespace-nowrap sm:order-1">
                    <span class="text-xs text-gray-400 uppercase tracking-wide mr-1">Start before</span>{{ formatDecayDate(entry.decay_start_time) }}
                  </div>
                  <div v-if="entry.decay_state === 'decaying'" class="text-right text-xs text-orange-500 mt-0.5 sm:order-1">
                    <Icon icon="ph:warning" class="inline w-3 h-3 mr-0.5" />Durations are decaying
                  </div>
                  <div v-else-if="entry.decay_state === 'fully_decayed'" class="text-right text-xs text-red-500 mt-0.5 sm:order-1">
                    <Icon icon="ph:warning-circle" class="inline w-3 h-3 mr-0.5" />Target and max have returned to initial values
                  </div>
                </template>
              </div>
              <div v-if="restRemainingSeconds(entry) > 0" class="text-xs text-amber-600">
                <Icon icon="ph:bed" class="inline w-3 h-3 mr-0.5" />Rest {{ shortDuration(restRemainingSeconds(entry)) }} more
              </div>
              </div>
            </template>
          </div>
        </template>
      </k-list-item>
    </k-list>
  </div>

  <!-- Rest-period confirmation dialog -->
  <k-dialog
    :opened="restWarning.visible"
    @backdropclick="restWarning.visible = false"
  >
    <template #title>Start during rest?</template>
    <template #content>
      <template v-if="restWarning.entry">
        {{ shortDuration(restRemainingSeconds(restWarning.entry)) }} of rest remaining.
        Starting early reduces your target to
        <strong>{{ idleTarget(restWarning.entry) }}</strong>.
      </template>
    </template>
    <template #buttons>
      <k-dialog-button @click="restWarning.visible = false">Cancel</k-dialog-button>
      <k-dialog-button strong @click="onWearConfirmed">Start anyway</k-dialog-button>
    </template>
  </k-dialog>
</template>

<script setup lang="ts">
import { reactive, onMounted } from 'vue';
import { Icon } from '@iconify/vue';
import { kBlockTitle, kList, kListItem, kButton, kDialog, kDialogButton } from 'konsta/vue';
import { useWear, type CurrentEntry, type Session, type ItemWithLastSession } from '../composables/useWear.js';
import { useItems } from '../composables/useItems.js';
import { useNow } from '../composables/useNow.js';
import { useToast } from '../composables/useToast.js';
import { formatDuration, shortDuration } from '../utils/formatDuration.js';
import { targetWearSeconds, maxWearSeconds, currentWear, remainingWearSeconds } from '../utils/wearCalculations.js';

const { currentSessions, loaded, startSession, endSession } = useWear();
const { loadItems, itemsForCategory } = useItems();
const { showError } = useToast();
const now = useNow();

const selectedItem = reactive<Record<number, number | null>>({});

const restWarning = reactive<{
  visible: boolean;
  entry: CurrentEntry | null;
}>({ visible: false, entry: null });

function showRestWarning(entry: CurrentEntry) {
  restWarning.entry = entry;
  restWarning.visible = true;
}

async function onWearConfirmed() {
  restWarning.visible = false;
  if (restWarning.entry) await onWear(restWarning.entry);
}

onMounted(async () => {
  await loadItems();
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

function sessionSeconds(session: Session): number {
  return currentWear(session, Math.floor(now.value / 1000));
}

function elapsed(session: Session): string {
  return formatDuration(sessionSeconds(session));
}

/** Denominator for the bar: max when set, else target. */
function barCeiling(entry: CurrentEntry): number {
  if (!entry.session) return 0;
  const max = maxWearSeconds(entry.session);
  return max ?? targetWearSeconds(entry.session);
}

function maxWear(entry: CurrentEntry): string {
  if (!entry.session) return '';
  const max = maxWearSeconds(entry.session);
  return max === null ? '—' : formatDuration(max);
}

function targetLabel(entry: CurrentEntry): string {
  if (!entry.session) return '';
  return formatDuration(targetWearSeconds(entry.session));
}

function remainingSecondsFor(session: Session): number | null {
  return remainingWearSeconds(session, Math.floor(now.value / 1000));
}

function remainingLabel(entry: CurrentEntry): string {
  if (!entry.session) return '';
  const remaining = remainingSecondsFor(entry.session);
  return remaining === null ? 'Stop wearing' : formatDuration(remaining);
}

function isOverdue(entry: CurrentEntry): boolean {
  if (!entry.session) return false;
  return remainingSecondsFor(entry.session) === null;
}

function wearProgress(entry: CurrentEntry): number {
  const ceiling = barCeiling(entry);
  if (!entry.session || ceiling <= 0) return 0;
  return Math.min((sessionSeconds(entry.session) / ceiling) * 100, 100);
}

/** Target marker position as a percentage of the bar ceiling. */
function targetMarkerPercent(entry: CurrentEntry): number {
  const ceiling = barCeiling(entry);
  if (!entry.session || ceiling <= 0) return 100;
  return Math.min((targetWearSeconds(entry.session) / ceiling) * 100, 100);
}

function rowBg(entry: CurrentEntry): string {
  const ceiling = barCeiling(entry);
  if (!entry.session || ceiling <= 0) return '';
  const remaining = 1 - sessionSeconds(entry.session) / ceiling;
  if (remaining <= 0) return 'bg-red-100';
  if (remaining <= 0.05) return 'bg-orange-100';
  if (remaining <= 0.10) return 'bg-yellow-100';
  return '';
}

function selectedItemData(entry: CurrentEntry): ItemWithLastSession | null {
  const id = selectedItem[entry.category.id];
  if (!id) return null;
  return entry.items.find((i) => i.item_id === id) ?? null;
}

function idleTarget(entry: CurrentEntry): string {
  const item = selectedItemData(entry);
  return item ? formatDuration(item.expected_target) : '';
}

function idleMax(entry: CurrentEntry): string {
  const item = selectedItemData(entry);
  if (!item || item.expected_max === null) return '';
  return formatDuration(item.expected_max);
}

function restRemainingSeconds(entry: CurrentEntry): number {
  const item = selectedItemData(entry);
  if (!item || item.ended_at === null || item.rest_seconds === null) return 0;
  return Math.max(0, Math.ceil(item.ended_at + item.rest_seconds - now.value / 1000));
}

function formatDecayDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
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
