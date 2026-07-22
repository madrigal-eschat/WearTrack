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
        :class="rowBg(entry)"
      >
        <template #title>
          <span
            v-if="entry.streak_count > 0"
            class="ml-1.5 text-xs text-orange-500 inline-flex items-center gap-0.5 align-middle"
            data-testid="streak-badge"
          >
            <Icon icon="ph:flame" class="w-3 h-3" />{{ entry.streak_count }}
          </span>
          <span v-if="entry.session && entry.item" class="ml-1.5 text-sm font-normal text-gray-500">{{ entry.item.name }}</span>
        </template>
        <template #media>
          <Icon
            v-if="entry.category.icon?.includes(':')"
            :icon="entry.category.icon"
            class="text-2xl w-8 h-8"
            :style="{ color: entry.session && entry.item ? entry.item.color : 'black' }"
          />
          <span v-else class="text-2xl">{{ entry.category.icon }}</span>
        </template>
        <template #inner>
          <template v-if="entry.session && entry.item">
            <div v-if="isOverdue(entry)" class="text-red-600 text-sm font-semibold mt-0.5">Stop wearing</div>
            <WearProgressBar
              class="mt-1"
              :fill-fraction="barFillFraction(entry)"
              :color="entry.item.color"
              :target-marker-fraction="targetMarkerFraction(entry)"
              :lap-count="lapCountFor(entry)"
            />
            <div class="flex flex-wrap gap-x-4 gap-y-0.5 mt-1 text-sm tabular-nums">
              <span class="text-gray-600"><span class="text-xs text-gray-400 uppercase tracking-wide mr-1">Worn</span>{{ elapsed(entry.session) }}</span>
              <span :class="isOverdue(entry) ? 'text-red-600 font-semibold' : 'text-gray-600'"><span class="text-xs text-gray-400 uppercase tracking-wide mr-1">Remaining</span>{{ remainingLabel(entry) }}</span>
              <span class="text-gray-600"><span class="text-xs text-gray-400 uppercase tracking-wide mr-1">Target</span>{{ targetLabel(entry) }}</span>
              <span v-if="entry.session.max_wear_seconds !== null" class="text-gray-600"><span class="text-xs text-gray-400 uppercase tracking-wide mr-1">Max</span>{{ maxWear(entry) }}</span>
            </div>
          </template>
          <template v-else>
            <!-- Row2: resting > decaying > default -->
            <template v-if="effectiveRestRemainingSeconds(entry) > 0">
              <div class="flex items-center gap-1.5 text-xs text-gray-500 mb-1">
                <Icon icon="ph:bed" class="w-3.5 h-3.5" />Rest
              </div>
              <WearProgressBar mode="rest" :fill-fraction="effectiveRestFillFraction(entry)" />
            </template>
            <template v-else-if="entry.decay_state !== 'none'">
              <div class="flex items-center gap-1.5 text-xs text-gray-500 mb-1">
                <Icon icon="ph:warning-circle" class="w-3.5 h-3.5" />Decay
              </div>
              <WearProgressBar mode="decay" :fill-fraction="decayFillFractionFor(entry)" />
              <div class="text-sm font-bold text-black mt-0.5">
                {{ entry.decay_state === 'fully_decayed' ? 'Target and max have fully decayed' : `Total decay in ${decayTimeLeftLabel(entry)}` }}
              </div>
            </template>
            <template v-else>
              <div class="text-xs text-gray-500 min-h-[22px] flex items-center">
                <span v-if="entry.decay_start_time !== null"><span class="text-xs text-gray-400 uppercase tracking-wide mr-1">Start before</span>{{ formatDecayDate(entry.decay_start_time) }}</span>
                <span v-else>Start your first session</span>
              </div>
            </template>

            <!-- Row3: rest stats replace Target/Max while resting -->
            <div v-if="effectiveRestRemainingSeconds(entry) > 0" class="flex flex-wrap gap-x-4 gap-y-0.5 mt-1 text-sm tabular-nums">
              <span class="text-gray-600"><span class="text-xs text-gray-400 uppercase tracking-wide mr-1">Remaining</span>{{ shortDuration(effectiveRestRemainingSeconds(entry)) }}</span>
              <span class="text-gray-600"><span class="text-xs text-gray-400 uppercase tracking-wide mr-1">Total</span>{{ shortDuration(effectiveRestTotalSeconds(entry)) }}</span>
            </div>
            <div v-else-if="selectedItemData(entry)" class="flex flex-wrap gap-x-4 gap-y-0.5 mt-1 text-sm tabular-nums">
              <span class="text-gray-600"><span class="text-xs text-gray-400 uppercase tracking-wide mr-1">Target</span>{{ idleTarget(entry) }}</span>
              <span v-if="idleMax(entry)" class="text-gray-600"><span class="text-xs text-gray-400 uppercase tracking-wide mr-1">Max</span>{{ idleMax(entry) }}</span>
            </div>
          </template>
        </template>
        <template #after>
          <CurrentSessionActions
            :entry="entry"
            :items="itemsForCategory(entry.category.id)"
            :selected-item-id="selectedItem[entry.category.id] ?? null"
            @update:selected-item-id="selectedItem[entry.category.id] = $event"
            :locked="isLocked(entry)"
            :forced-item-name="forcedItemName(entry)"
            :rest-remaining="effectiveRestRemainingSeconds(entry)"
            :item-rest-remaining="restRemainingSeconds(entry)"
            :item-rotation-available="(id: number) => itemRotationAvailable(entry, id)"
            @stop="onStop(entry)"
            @choose-something-else="chooseSomethingElse(entry)"
            @wear="onWearClick(entry)"
          />
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
        {{ shortDuration(restRemainingSeconds(restWarning.entry, dialogItemIdOverride(restWarning.entry))) }} of rest remaining.
        Starting early reduces your target to
        <strong>{{ idleTarget(restWarning.entry, dialogItemIdOverride(restWarning.entry)) }}</strong>.
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
import { kBlockTitle, kList, kListItem, kDialog, kDialogButton } from 'konsta/vue';
import WearProgressBar from './WearProgressBar.vue';
import CurrentSessionActions from './CurrentSessionActions.vue';
import { useWear, type CurrentEntry, type Session, type ItemWithLastSession } from '../composables/useWear.js';
import { useItems } from '../composables/useItems.js';
import { useNow } from '../composables/useNow.js';
import { useToast } from '../composables/useToast.js';
import { apiFetch } from '../utils/apiFetch.js';
import { formatDuration, shortDuration } from '../utils/formatDuration.js';
import { targetWearSeconds, maxWearSeconds, currentWear, remainingWearSeconds, lapCount, lapFillFraction, fillUpFraction, decayFillFraction, decayTimeLeft } from '../utils/wearCalculations.js';

const { currentSessions, loaded, startSession, endSession } = useWear();
const { loadItems, itemsForCategory } = useItems();
const { showError } = useToast();
const now = useNow();

const selectedItem = reactive<Record<number, number | null>>({});
const recentSessionsByCategory = reactive<Record<number, { item_id: number }[]>>({});
const overrideLock = reactive<Record<number, boolean>>({});

async function loadRecentSessions(categoryId: number) {
  const res = await apiFetch(`/api/sessions?category_id=${categoryId}&limit=20`);
  if (!res.ok) return;
  const sessions: { item_id: number }[] = await res.json();
  recentSessionsByCategory[categoryId] = sessions; // already newest-first per session-store.findAll ORDER BY started_at DESC
}

/** Trailing run length of the most-recent item at the front of `sessions` (newest first). */
function trailingRunLength(sessions: { item_id: number }[]): number {
  if (sessions.length === 0) return 0;
  const mostRecent = sessions[0].item_id;
  let count = 0;
  for (const s of sessions) {
    if (s.item_id !== mostRecent) break;
    count++;
  }
  return count;
}

function forcedItemId(entry: CurrentEntry): number | null {
  if (entry.category.type !== 'rotation') return null;
  const sessions = recentSessionsByCategory[entry.category.id];
  if (!sessions || sessions.length === 0) return null;
  const mostRecent = sessions[0].item_id;
  const runLength = trailingRunLength(sessions);
  if (runLength < entry.category.consecutive_wear_days) return mostRecent;
  return null;
}

function isLocked(entry: CurrentEntry): boolean {
  return forcedItemId(entry) !== null && !overrideLock[entry.category.id];
}

function forcedItemName(entry: CurrentEntry): string {
  const id = forcedItemId(entry);
  if (id === null) return '';
  return itemsForCategory(entry.category.id).find((i) => i.id === id)?.name ?? '';
}

function itemRotationAvailable(entry: CurrentEntry, itemId: number): boolean {
  return entry.items.find((i) => i.item_id === itemId)?.rotation_available ?? true;
}

/** First item in the category that's actually pickable right now (falls back to the first item at all if none are marked available). */
function firstAvailableItemId(entry: CurrentEntry): number | null {
  const items = itemsForCategory(entry.category.id);
  const available = items.find((i) => itemRotationAvailable(entry, i.id));
  return available?.id ?? items[0]?.id ?? null;
}

function chooseSomethingElse(entry: CurrentEntry) {
  overrideLock[entry.category.id] = true;
  selectedItem[entry.category.id] = firstAvailableItemId(entry);
}

const restWarning = reactive<{
  visible: boolean;
  entry: CurrentEntry | null;
}>({ visible: false, entry: null });

function showRestWarning(entry: CurrentEntry) {
  restWarning.entry = entry;
  restWarning.visible = true;
}

/**
 * Which item id the rest dialog (and its confirm action) should act on:
 * the forced item when the entry is still locked (label path), or `undefined`
 * to fall back to whatever's selected in the dropdown (override/unlocked path).
 */
function dialogItemIdOverride(entry: CurrentEntry): number | undefined {
  return isLocked(entry) ? forcedItemId(entry) ?? undefined : undefined;
}

async function onWearConfirmed() {
  restWarning.visible = false;
  if (restWarning.entry) await onWear(restWarning.entry, dialogItemIdOverride(restWarning.entry));
}

function onWearClick(entry: CurrentEntry) {
  if (isLocked(entry)) {
    if (restRemainingSeconds(entry, forcedItemId(entry)) > 0) showRestWarning(entry);
    else onWear(entry, forcedItemId(entry) ?? undefined);
    return;
  }
  if (restRemainingSeconds(entry) > 0) showRestWarning(entry);
  else onWear(entry);
}

onMounted(async () => {
  await loadItems();
  for (const entry of currentSessions.value) {
    if (entry.category.type === 'rotation') await loadRecentSessions(entry.category.id);
  }
  for (const entry of currentSessions.value) {
    selectedItem[entry.category.id] = firstAvailableItemId(entry);
  }
});

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
  if (remaining !== null) return formatDuration(remaining);
  return maxWearSeconds(entry.session) === null ? 'Target reached' : 'Overdue';
}

function isOverdue(entry: CurrentEntry): boolean {
  if (!entry.session) return false;
  const max = maxWearSeconds(entry.session);
  if (max === null) return false;
  return sessionSeconds(entry.session) >= max;
}

/** Bar fill fraction (0-1): fraction of max if set, else wraps every `target` seconds (lap mechanic). */
function barFillFraction(entry: CurrentEntry): number {
  if (!entry.session) return 0;
  const max = maxWearSeconds(entry.session);
  const target = targetWearSeconds(entry.session);
  const elapsed = sessionSeconds(entry.session);
  if (max === null) return lapFillFraction(elapsed, target);
  if (max <= 0) return 0;
  return Math.min(elapsed / max, 1);
}

/** Target marker position as a fraction of the bar. Null when max is unset (wrap mode has no fixed marker). */
function targetMarkerFraction(entry: CurrentEntry): number | null {
  if (!entry.session) return null;
  const max = maxWearSeconds(entry.session);
  if (max === null || max <= 0) return null;
  return Math.min(targetWearSeconds(entry.session) / max, 1);
}

/** Completed laps this session (null-max categories only; 0 otherwise). */
function lapCountFor(entry: CurrentEntry): number {
  if (!entry.session) return 0;
  if (maxWearSeconds(entry.session) !== null) return 0;
  return lapCount(sessionSeconds(entry.session), targetWearSeconds(entry.session));
}

function rowBg(entry: CurrentEntry): string {
  if (!entry.session) return '';
  const max = maxWearSeconds(entry.session);
  if (max === null) return '';
  const ceiling = barCeiling(entry);
  if (ceiling <= 0) return '';
  const remaining = 1 - sessionSeconds(entry.session) / ceiling;
  if (remaining <= 0) return 'bg-red-100';
  if (remaining <= 0.05) return 'bg-orange-100';
  if (remaining <= 0.10) return 'bg-yellow-100';
  return '';
}

/**
 * Data for a specific item id, or (when `itemIdOverride` is omitted/null) for
 * whatever's currently selected in the dropdown for this category.
 */
function selectedItemData(entry: CurrentEntry, itemIdOverride?: number | null): ItemWithLastSession | null {
  const id = itemIdOverride ?? selectedItem[entry.category.id];
  if (!id) return null;
  return entry.items.find((i) => i.item_id === id) ?? null;
}

function idleTarget(entry: CurrentEntry, itemIdOverride?: number | null): string {
  const item = selectedItemData(entry, itemIdOverride);
  return item ? formatDuration(item.expected_target) : '';
}

function idleMax(entry: CurrentEntry, itemIdOverride?: number | null): string {
  const item = selectedItemData(entry, itemIdOverride);
  if (!item || item.expected_max === null) return '';
  return formatDuration(item.expected_max);
}

function restRemainingSeconds(entry: CurrentEntry, itemIdOverride?: number | null): number {
  const item = selectedItemData(entry, itemIdOverride);
  if (!item || item.ended_at === null || item.rest_seconds === null) return 0;
  return Math.max(0, Math.ceil(item.ended_at + item.rest_seconds - now.value / 1000));
}

function restTotalSeconds(entry: CurrentEntry): number {
  const item = selectedItemData(entry);
  return item?.rest_seconds ?? 0;
}

function dailyRestRemainingSeconds(entry: CurrentEntry): number {
  if (entry.resting_until === null) return 0;
  return Math.max(0, entry.resting_until - Math.floor(now.value / 1000));
}

function dailyRestTotalSeconds(entry: CurrentEntry): number {
  if (entry.resting_until === null) return 0;
  const sessionStart = entry.items[0]?.started_at;
  if (sessionStart === null || sessionStart === undefined) return 0;
  return Math.max(0, entry.resting_until - sessionStart);
}

/** Rest-remaining for whichever rest mechanic applies to this category: the duration formula's rest period, or the rotation daily cap. */
function effectiveRestRemainingSeconds(entry: CurrentEntry): number {
  return entry.category.type === 'rotation' ? dailyRestRemainingSeconds(entry) : restRemainingSeconds(entry);
}

/** Rest-total counterpart to `effectiveRestRemainingSeconds`. */
function effectiveRestTotalSeconds(entry: CurrentEntry): number {
  return entry.category.type === 'rotation' ? dailyRestTotalSeconds(entry) : restTotalSeconds(entry);
}

function effectiveRestFillFraction(entry: CurrentEntry): number {
  return fillUpFraction(effectiveRestRemainingSeconds(entry), effectiveRestTotalSeconds(entry));
}

function decayFillFractionFor(entry: CurrentEntry): number {
  if (entry.decay_start_time === null || entry.decay_full_time === null) return 0;
  return decayFillFraction(Math.floor(now.value / 1000), entry.decay_start_time, entry.decay_full_time);
}

function decayTimeLeftLabel(entry: CurrentEntry): string {
  if (entry.decay_full_time === null) return '';
  return shortDuration(decayTimeLeft(Math.floor(now.value / 1000), entry.decay_full_time));
}

function formatDecayDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

async function onWear(entry: CurrentEntry, itemIdOverride?: number) {
  const itemId = itemIdOverride ?? selectedItem[entry.category.id];
  if (!itemId) return;
  try {
    await startSession(itemId);
    if (entry.category.type === 'rotation') {
      overrideLock[entry.category.id] = false;
      await loadRecentSessions(entry.category.id);
    }
  } catch (e) {
    showError(String(e));
  }
}

async function onStop(entry: CurrentEntry) {
  if (!entry.session) return;
  try {
    await endSession(entry.session.id);
    if (entry.category.type === 'rotation') {
      overrideLock[entry.category.id] = false;
      await loadRecentSessions(entry.category.id);
    }
  } catch (e) {
    showError(String(e));
  }
}
</script>
