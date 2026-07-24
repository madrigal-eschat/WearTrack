<template>
  <FormCard>
    <!-- Icon (left) + Name (right) on same row -->
    <div class="flex gap-2 items-end">
      <IconPickerTrigger
        label="Icon"
        :modelValue="catForm.icon"
        @click="showIconPicker = true"
      />
      <div class="flex-1">
        <TextField id="cat-name" label="Name" v-model="catForm.name" />
      </div>
    </div>

    <SegmentedControl
      :modelValue="catForm.type"
      :options="[
        { value: 'duration', label: 'Duration' },
        { value: 'rotation', label: 'Rotation' },
      ]"
      @update:modelValue="catForm.type = $event"
    />

    <div class="flex gap-4 flex-wrap items-end">
      <DurationTrigger
        label="Target wear"
        :displayValue="shortDuration(catForm.initialWearTargetSeconds)"
        @click="openDurationPicker('target')"
      />
      <NumberField
        v-if="catForm.type === 'rotation'"
        id="cat-consecutive-days"
        label="Consecutive wear days"
        v-model="catForm.consecutiveWearDays"
        :min="1"
        :default="1"
        :step="1"
      />
      <template v-if="catForm.type === 'duration'">
        <DurationTrigger
          label="Maximum wear"
          :displayValue="
            catForm.initialWearMaxSeconds === null
              ? 'None'
              : shortDuration(catForm.initialWearMaxSeconds)
          "
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
      </template>
    </div>

    <template v-if="catForm.type === 'duration'">
      <DurationCategoryFields
        :has-max-wear="catForm.initialWearMaxSeconds !== null"
        :minimum-rest-display="shortDuration(catForm.minimumRestSeconds)"
        :break-grace-display="shortDuration(catForm.breakGraceSeconds)"
        :break-decay-half-life-days="catForm.breakDecayHalfLifeDays"
        @update:break-decay-half-life-days="
          catForm.breakDecayHalfLifeDays = $event
        "
        :default-half-life-days="DEFAULT_HALF_LIFE_DAYS"
        :band-count="catForm.bandCount"
        :crossover-points="catForm.crossoverPoints"
        @open-duration-picker="openDurationPicker"
        @add-band="addBand"
        @remove-band="removeBand"
      />
    </template>

    <!-- Save / Cancel -->
    <div class="flex gap-2 pt-1">
      <button
        type="button"
        data-testid="category-form-submit"
        class="
          px-4 py-2 rounded-lg text-sm font-medium bg-blue-500 text-white
          disabled:opacity-40
        "
        :disabled="!catForm.name || !catForm.icon"
        @click="onSubmit"
      >{{ submitLabel ?? 'Save' }}</button>
      <button
        type="button"
        data-testid="category-form-cancel"
        class="
          px-4 py-2 rounded-lg text-sm font-medium border border-gray-300
          text-gray-700 bg-white
        "
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
import { ref, reactive } from 'vue'
import { shortDuration } from '../utils/formatDuration.js'
import FormCard from './FormCard.vue'
import TextField from './TextField.vue'
import IconPickerTrigger from './IconPickerTrigger.vue'
import IconPickerSheet from './IconPickerSheet.vue'
import DurationPickerSheet from './DurationPickerSheet.vue'
import NumberField from './NumberField.vue'
import DurationTrigger from './DurationTrigger.vue'
import { multiplierToHalfLifeDays } from '../utils/categoryForm.js'
import SegmentedControl from './SegmentedControl.vue'
import DurationCategoryFields from './DurationCategoryFields.vue'

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

const DEFAULT_HALF_LIFE_DAYS = multiplierToHalfLifeDays(0.91)

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
}

const props = defineProps<{
  initialValues?: Partial<CategoryFormState>;
  submitLabel?: string;
}>()

const emit = defineEmits<{
  submit: [data: CategoryFormState];
  cancel: [];
}>()

const catForm = reactive<CategoryFormState>({
  ...DEFAULT_STATE,
  ...props.initialValues,
  crossoverPoints: props.initialValues?.crossoverPoints
    ? [...props.initialValues.crossoverPoints]
    : [...DEFAULT_STATE.crossoverPoints],
})

type DurationTarget = 'target' | 'max' | 'minRest' | 'grace' | number;

const showIconPicker = ref(false)
const showDurationPicker = ref(false)
const durationPickerTarget = ref<DurationTarget>('target')
const durationPickerValue = ref(0)

function openDurationPicker(target: DurationTarget) {
  durationPickerTarget.value = target
  if (target === 'target') {
    durationPickerValue.value = catForm.initialWearTargetSeconds
  } else if (target === 'max') {
    durationPickerValue.value =
      catForm.initialWearMaxSeconds ?? catForm.initialWearTargetSeconds
  } else if (target === 'minRest') {
    durationPickerValue.value = catForm.minimumRestSeconds
  } else if (target === 'grace') {
    durationPickerValue.value = catForm.breakGraceSeconds
  } else {
    durationPickerValue.value = catForm.crossoverPoints[target as number]
  }
  showDurationPicker.value = true
}

function onDurationPicked(seconds: number) {
  const target = durationPickerTarget.value
  if (target === 'target') {
    catForm.initialWearTargetSeconds = seconds
    return
  }
  if (target === 'max') {
    catForm.initialWearMaxSeconds = seconds
    return
  }
  if (target === 'minRest') {
    catForm.minimumRestSeconds = seconds
    return
  }
  if (target === 'grace') {
    catForm.breakGraceSeconds = seconds
    return
  }
  const idx = target as number
  const prev = idx > 0 ? catForm.crossoverPoints[idx - 1] : 0
  const next =
    idx < catForm.crossoverPoints.length - 1
      ? catForm.crossoverPoints[idx + 1]
      : Infinity
  catForm.crossoverPoints[idx] = Math.max(
    prev + 60,
    Math.min(next - 60, seconds),
  )
}

function addBand() {
  if (catForm.bandCount >= 5) {
    return
  }
  const last =
    catForm.crossoverPoints[catForm.crossoverPoints.length - 1] ?? 0
  catForm.crossoverPoints.push(last + 3600)
  catForm.bandCount++
}

function removeBand() {
  if (catForm.bandCount <= 1) {
    return
  }
  catForm.crossoverPoints.pop()
  catForm.bandCount--
}

function onSubmit() {
  if (!catForm.name || !catForm.icon) {
    return
  }
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
  })
}
</script>
