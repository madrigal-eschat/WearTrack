<template>
  <div class="mx-4 mb-3 p-3 bg-white border border-gray-200 rounded-2xl space-y-2">
    <!-- Name -->
    <TextField id="cat-name" label="Name" v-model="catForm.name" />

    <!-- Icon + submit row -->
    <div class="flex gap-2 items-end">
      <div class="flex-1">
        <IconPickerTrigger label="Icon" :modelValue="catForm.icon" @click="showIconPicker = true" />
      </div>
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

    <!-- Save / Cancel -->
    <div class="flex gap-2 pt-1">
      <k-button @click="onSubmit" :disabled="!catForm.name || !catForm.icon">
        {{ submitLabel ?? 'Save' }}
      </k-button>
      <k-button outline @click="$emit('cancel')">
        Cancel
      </k-button>
    </div>

    <IconPickerSheet
      v-model="catForm.icon"
      :open="showIconPicker"
      @update:open="showIconPicker = $event"
    />

    <!-- Duration picker (shared for initial wear + crossover points) -->
    <DurationPickerSheet
      :modelValue="durationPickerValue"
      :open="showDurationPicker"
      @update:modelValue="onDurationPicked"
      @update:open="showDurationPicker = $event"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed } from 'vue';
import { kButton } from 'konsta/vue';
import { bandNamesForCount, bandColorsForCount } from '../utils/riskLevels.js';
import { shortDuration } from '../utils/formatDuration.js';
import TextField from './TextField.vue';
import IconPickerTrigger from './IconPickerTrigger.vue';
import IconPickerSheet from './IconPickerSheet.vue';
import DurationPickerSheet from './DurationPickerSheet.vue';

export interface CategoryFormState {
  name: string;
  icon: string;
  initialWearSeconds: number;
  restMultiplier: number;
  bandCount: number;
  crossoverPoints: number[];
}

const DEFAULT_STATE: CategoryFormState = {
  name: '',
  icon: '',
  initialWearSeconds: 900,
  restMultiplier: 2,
  bandCount: 3,
  crossoverPoints: [3600, 7200],
};

const props = defineProps<{
  initialValues?: Partial<CategoryFormState>;
  submitLabel?: string;
}>();

const emit = defineEmits<{
  submit: [data: CategoryFormState];
  cancel: [];
}>();

const catForm = reactive<CategoryFormState>({
  ...DEFAULT_STATE,
  ...props.initialValues,
  crossoverPoints: props.initialValues?.crossoverPoints
    ? [...props.initialValues.crossoverPoints]
    : [...DEFAULT_STATE.crossoverPoints],
});

const showIconPicker = ref(false);
const showDurationPicker = ref(false);
const durationPickerTarget = ref<'initialWear' | number>('initialWear');
const durationPickerValue = ref(0);

const bandNames = computed(() => bandNamesForCount(catForm.bandCount));
const bandColors = computed(() => bandColorsForCount(catForm.bandCount));

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

function onSubmit() {
  if (!catForm.name || !catForm.icon) return;
  emit('submit', {
    name: catForm.name,
    icon: catForm.icon,
    initialWearSeconds: catForm.initialWearSeconds,
    restMultiplier: catForm.restMultiplier,
    bandCount: catForm.bandCount,
    crossoverPoints: [...catForm.crossoverPoints],
  });
}
</script>
