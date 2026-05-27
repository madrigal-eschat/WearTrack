<template>
  <div>
    <FormSectionHeader
      title="Categories"
      :isOpen="showCatForm"
      :showToggle="true"
      @toggle="showCatForm = !showCatForm"
    />

    <div v-if="showCatForm" class="mx-4 mb-3 p-3 bg-white border border-gray-200 rounded-2xl space-y-2">
      <!-- Name -->
      <TextField id="cat-name" label="Name" v-model="catForm.name" />

      <!-- Icon + submit row -->
      <div class="flex gap-2 items-end">
        <div class="flex-1">
          <IconPickerTrigger label="Icon" :modelValue="catForm.icon" @click="showIconPicker = true" />
        </div>
        <k-button @click="onAddCategory" :disabled="!catForm.name || !catForm.icon">
          Add
        </k-button>
      </div>

      <!-- Initial wear + rest multiplier (same row) -->
      <div class="flex gap-4 flex-wrap items-end">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Initial wear</label>
          <button
            type="button"
            class="flex items-center gap-1 border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
            @click="openDurationPicker('initialWear')"
          >
            <span>{{ shortDuration(catForm.initialWearSeconds) }}</span>
            <span class="text-gray-400">▾</span>
          </button>
        </div>
        <div>
          <label for="cat-rest-mult" class="block text-sm font-medium text-gray-700 mb-1">Rest multiplier</label>
          <input
            id="cat-rest-mult"
            :value="catForm.restMultiplier"
            @input="catForm.restMultiplier = Number(($event.target as HTMLInputElement).value)"
            @blur="onRestMultiplierBlur"
            type="number"
            min="0"
            step="0.1"
            class="w-20 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>
      <p class="text-xs text-gray-400 -mt-1">
        <strong>Initial wear</strong> is the carry-over credit when starting a new session (or after a long break).
        <strong>Rest</strong> = multiplier × wear&thinsp;+&thinsp;24&thinsp;h.
      </p>

      <!-- Risk bands -->
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1">Risk bands</label>
        <p class="text-xs text-gray-400 mb-2">
          Bands are triggered by cumulative wear time. Tap a threshold (▾) to change where one band ends and the next begins.
        </p>
        <div class="space-y-1">
          <template v-for="(bandName, i) in bandNames" :key="i">
            <!-- Band row -->
            <div
              class="flex items-center justify-between rounded-lg px-3 py-2 text-sm font-medium"
              :class="bandColors[i]"
            >
              <span>{{ bandName }}</span>
              <!-- +/- controls sit on the last band row -->
              <div v-if="i === catForm.bandCount - 1" class="flex gap-1">
                <button
                  type="button"
                  class="w-7 h-7 rounded-full border border-gray-400 flex items-center justify-center text-gray-600 disabled:opacity-30"
                  :disabled="catForm.bandCount <= 1"
                  @click="removeBand"
                >−</button>
                <button
                  type="button"
                  class="w-7 h-7 rounded-full border border-gray-400 flex items-center justify-center text-gray-600 disabled:opacity-30"
                  :disabled="catForm.bandCount >= 5"
                  @click="addBand"
                >+</button>
              </div>
            </div>
            <!-- Crossover point (between bands) -->
            <button
              v-if="i < catForm.bandCount - 1"
              type="button"
              class="flex items-center gap-1 px-3 text-sm text-gray-500"
              @click="openDurationPicker(i)"
            >
              <span>{{ shortDuration(catForm.crossoverPoints[i]) }}</span>
              <span>▾</span>
            </button>
          </template>
        </div>
      </div>

      <IconPickerSheet
        v-model="catForm.icon"
        :open="showIconPicker"
        @update:open="showIconPicker = $event"
      />
    </div>

    <!-- Duration picker (shared for initial wear + crossover points) -->
    <DurationPickerSheet
      :modelValue="durationPickerValue"
      :open="showDurationPicker"
      @update:modelValue="onDurationPicked"
      @update:open="showDurationPicker = $event"
    />

    <div v-if="loading" class="text-center py-4 text-gray-400">Loading…</div>
    <template v-else>
      <k-list v-if="categories.length > 0" inset class="!my-2">
        <k-list-item
          v-for="cat in categories"
          :key="cat.id"
          :title="cat.name"
        >
          <template #media>
            <Icon v-if="cat.icon?.includes(':')" :icon="cat.icon" class="text-2xl w-8 h-8" />
            <span v-else class="text-2xl">{{ cat.icon }}</span>
          </template>
          <template #after>
            <k-button small outline type="button" @click="onDeleteCategory(cat.id)">Delete</k-button>
          </template>
        </k-list-item>
      </k-list>
      <k-block v-else>
        <p class="text-center text-gray-400 text-sm">No categories yet. Use "+ Add" above to create one.</p>
      </k-block>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue';
import { Icon } from '@iconify/vue';
import { kList, kListItem, kButton, kBlock } from 'konsta/vue';
import { useCategories } from '../composables/useCategories.js';
import { useItems } from '../composables/useItems.js';
import { useToast } from '../composables/useToast.js';
import { DEFAULT_CATEGORY_FIELDS } from '../utils/categoryDefaults.js';
import { bandNamesForCount, buildRiskLevels, bandColorsForCount } from '../utils/riskLevels.js';
import { shortDuration } from '../utils/formatDuration.js';
import TextField from './TextField.vue';
import FormSectionHeader from './FormSectionHeader.vue';
import IconPickerTrigger from './IconPickerTrigger.vue';
import IconPickerSheet from './IconPickerSheet.vue';
import DurationPickerSheet from './DurationPickerSheet.vue';

const { categories, loadCategories, createCategory, deleteCategory } = useCategories();
const { loadItems } = useItems();
const { showError } = useToast();

const loading = ref(true);
const showCatForm = ref(false);
const showIconPicker = ref(false);
const showDurationPicker = ref(false);
const durationPickerTarget = ref<'initialWear' | number>('initialWear');
const durationPickerValue = ref(0);

const catForm = reactive({
  name: '',
  icon: '',
  initialWearSeconds: 900,
  restMultiplier: 2,
  bandCount: 3,
  crossoverPoints: [3600, 7200] as number[],
});

const bandNames = computed(() => bandNamesForCount(catForm.bandCount));
const bandColors = computed(() => bandColorsForCount(catForm.bandCount));

onMounted(async () => {
  try {
    await loadCategories();
  } finally {
    loading.value = false;
  }
});

function openDurationPicker(target: 'initialWear' | number) {
  durationPickerTarget.value = target;
  durationPickerValue.value =
    target === 'initialWear' ? catForm.initialWearSeconds : catForm.crossoverPoints[target as number];
  showDurationPicker.value = true;
}

function onDurationPicked(seconds: number) {
  const target = durationPickerTarget.value;
  if (target === 'initialWear') {
    catForm.initialWearSeconds = seconds;
    return;
  }
  const idx = target as number;
  const prev = idx > 0 ? catForm.crossoverPoints[idx - 1] : 0;
  const next =
    idx < catForm.crossoverPoints.length - 1 ? catForm.crossoverPoints[idx + 1] : Infinity;
  catForm.crossoverPoints[idx] = Math.max(prev + 60, Math.min(next - 60, seconds));
}

function onRestMultiplierBlur(e: Event) {
  const val = Number((e.target as HTMLInputElement).value);
  if (isNaN(val) || (e.target as HTMLInputElement).value === '') {
    catForm.restMultiplier = 2;
  } else {
    catForm.restMultiplier = Math.max(0, val);
  }
}

function addBand() {
  if (catForm.bandCount >= 5) return;
  const last = catForm.crossoverPoints[catForm.crossoverPoints.length - 1] ?? 0;
  catForm.crossoverPoints.push(last + 3600);
  catForm.bandCount++;
}

function removeBand() {
  if (catForm.bandCount <= 1) return;
  catForm.crossoverPoints.pop();
  catForm.bandCount--;
}

function resetForm() {
  catForm.name = '';
  catForm.icon = '';
  catForm.initialWearSeconds = 900;
  catForm.restMultiplier = 2;
  catForm.bandCount = 3;
  catForm.crossoverPoints = [3600, 7200];
}

async function onAddCategory() {
  if (!catForm.name || !catForm.icon) return;
  try {
    await createCategory({
      name: catForm.name,
      icon: catForm.icon,
      initial_wear_duration_seconds: catForm.initialWearSeconds,
      rest_multiplier: catForm.restMultiplier,
      rest_constant_seconds: DEFAULT_CATEGORY_FIELDS.rest_constant_seconds,
      risk_levels: buildRiskLevels(catForm.bandCount, catForm.crossoverPoints),
      break_decay_multiplier: DEFAULT_CATEGORY_FIELDS.break_decay_multiplier,
      break_starts_after_seconds: DEFAULT_CATEGORY_FIELDS.break_starts_after_seconds,
    });
    resetForm();
    showCatForm.value = false;
    showIconPicker.value = false;
  } catch (e) {
    showError(String(e));
  }
}

async function onDeleteCategory(id: number) {
  if (!confirm('Delete this category and all its items?')) return;
  try {
    await deleteCategory(id);
  } catch (e) {
    showError(String(e));
    return;
  }
  await loadItems().catch(() => {});
}
</script>
