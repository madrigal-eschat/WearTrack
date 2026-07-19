<template>
  <FormCard>
    <!-- Icon (left) + Name (right) on same row -->
    <div class="flex gap-2 items-end">
      <IconPickerTrigger label="Icon" :modelValue="catForm.icon" @click="showIconPicker = true" />
      <div class="flex-1">
        <TextField id="cat-name" label="Name" v-model="catForm.name" />
      </div>
    </div>

    <div class="flex gap-4 flex-wrap items-end">
      <DurationTrigger
        label="Target wear"
        :displayValue="shortDuration(catForm.initialWearTargetSeconds)"
        @click="openDurationPicker('target')"
      />
      <DurationTrigger
        label="Maximum wear"
        :displayValue="catForm.initialWearMaxSeconds === null ? 'None' : shortDuration(catForm.initialWearMaxSeconds)"
        :clearable="catForm.initialWearMaxSeconds !== null"
        clearTestid="clear-max"
        @click="openDurationPicker('max')"
        @clear="catForm.initialWearMaxSeconds = null"
      />
      <NumberField
        id="cat-rest-mult"
        label="Rest multiplier"
        v-model="catForm.restMultiplier"
        :min="0"
        :default="2"
        :step="0.1"
      />
    </div>

    <div class="flex gap-4 flex-wrap items-end">
      <DurationTrigger
        label="Minimum rest period"
        :displayValue="shortDuration(catForm.minimumRestSeconds)"
        :disabled="catForm.initialWearMaxSeconds === null"
        testid="min-rest"
        @click="openDurationPicker('minRest')"
      />
      <DurationTrigger
        label="Break grace time"
        :displayValue="shortDuration(catForm.breakGraceSeconds)"
        @click="openDurationPicker('grace')"
      />
      <NumberField
        id="cat-decay"
        label="Break half-life (days)"
        v-model="catForm.breakDecayHalfLifeDays"
        :min="0.1"
        :default="DEFAULT_HALF_LIFE_DAYS"
        :step="0.1"
      />
    </div>
    <p class="text-xs text-gray-400 -mt-1">
      <strong>Target</strong> is the goal duration; <strong>Maximum</strong> (optional) is the hard ceiling.
      Minimum rest only applies when a maximum is set.
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
                data-testid="add-band"
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
      <button
        type="button"
        data-testid="category-form-submit"
        class="px-4 py-2 rounded-lg text-sm font-medium bg-blue-500 text-white disabled:opacity-40"
        :disabled="!catForm.name || !catForm.icon"
        @click="onSubmit"
      >{{ submitLabel ?? 'Save' }}</button>
      <button
        type="button"
        data-testid="category-form-cancel"
        class="px-4 py-2 rounded-lg text-sm font-medium border border-gray-300 text-gray-700 bg-white"
        @click="$emit('cancel')"
      >Cancel</button>
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
  </FormCard>
</template>

<script setup lang="ts">
import { ref, reactive, computed } from 'vue';
import { bandNamesForCount, bandColorsForCount } from '../utils/riskLevels.js';
import { shortDuration } from '../utils/formatDuration.js';
import FormCard from './FormCard.vue';
import TextField from './TextField.vue';
import IconPickerTrigger from './IconPickerTrigger.vue';
import IconPickerSheet from './IconPickerSheet.vue';
import DurationPickerSheet from './DurationPickerSheet.vue';
import NumberField from './NumberField.vue';
import DurationTrigger from './DurationTrigger.vue';
import { multiplierToHalfLifeDays } from '../utils/categoryForm.js';

export interface CategoryFormState {
  name: string;
  icon: string;
  initialWearTargetSeconds: number;
  initialWearMaxSeconds: number | null;
  minimumRestSeconds: number;
  breakGraceSeconds: number;
  breakDecayHalfLifeDays: number;
  restMultiplier: number;
  bandCount: number;
  crossoverPoints: number[];
  type: 'duration' | 'rotation';
  consecutiveWearDays: number;
}

const DEFAULT_HALF_LIFE_DAYS = multiplierToHalfLifeDays(0.91);

const DEFAULT_STATE: CategoryFormState = {
  name: '',
  icon: '',
  initialWearTargetSeconds: 900,
  initialWearMaxSeconds: 1350,
  minimumRestSeconds: 86400,
  breakGraceSeconds: 86400,
  breakDecayHalfLifeDays: DEFAULT_HALF_LIFE_DAYS,
  restMultiplier: 2,
  bandCount: 3,
  crossoverPoints: [3600, 7200],
  type: 'duration',
  consecutiveWearDays: 1,
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
const durationPickerTarget = ref<'target' | 'max' | 'minRest' | 'grace' | number>('target');
const durationPickerValue = ref(0);

const bandNames = computed(() => bandNamesForCount(catForm.bandCount));
const bandColors = computed(() => bandColorsForCount(catForm.bandCount));

function openDurationPicker(target: 'target' | 'max' | 'minRest' | 'grace' | number) {
  durationPickerTarget.value = target;
  if (target === 'target') durationPickerValue.value = catForm.initialWearTargetSeconds;
  else if (target === 'max') durationPickerValue.value = catForm.initialWearMaxSeconds ?? catForm.initialWearTargetSeconds;
  else if (target === 'minRest') durationPickerValue.value = catForm.minimumRestSeconds;
  else if (target === 'grace') durationPickerValue.value = catForm.breakGraceSeconds;
  else durationPickerValue.value = catForm.crossoverPoints[target as number];
  showDurationPicker.value = true;
}

function onDurationPicked(seconds: number) {
  const target = durationPickerTarget.value;
  if (target === 'target') { catForm.initialWearTargetSeconds = seconds; return; }
  if (target === 'max') { catForm.initialWearMaxSeconds = seconds; return; }
  if (target === 'minRest') { catForm.minimumRestSeconds = seconds; return; }
  if (target === 'grace') { catForm.breakGraceSeconds = seconds; return; }
  const idx = target as number;
  const prev = idx > 0 ? catForm.crossoverPoints[idx - 1] : 0;
  const next = idx < catForm.crossoverPoints.length - 1 ? catForm.crossoverPoints[idx + 1] : Infinity;
  catForm.crossoverPoints[idx] = Math.max(prev + 60, Math.min(next - 60, seconds));
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
    initialWearTargetSeconds: catForm.initialWearTargetSeconds,
    initialWearMaxSeconds: catForm.initialWearMaxSeconds,
    minimumRestSeconds: catForm.minimumRestSeconds,
    breakGraceSeconds: catForm.breakGraceSeconds,
    breakDecayHalfLifeDays: catForm.breakDecayHalfLifeDays,
    restMultiplier: catForm.restMultiplier,
    bandCount: catForm.bandCount,
    crossoverPoints: [...catForm.crossoverPoints],
    type: catForm.type,
    consecutiveWearDays: catForm.consecutiveWearDays,
  });
}
</script>
