<template>
  <div class="flex gap-4 flex-wrap items-end">
    <DurationTrigger
      label="Minimum rest period"
      :displayValue="minimumRestDisplay"
      :disabled="!hasMaxWear"
      testid="min-rest"
      @click="$emit('open-duration-picker', 'minRest')"
    />
    <DurationTrigger
      label="Break grace time"
      :displayValue="breakGraceDisplay"
      @click="$emit('open-duration-picker', 'grace')"
    />
    <NumberField
      id="cat-decay"
      label="Break half-life (days)"
      :modelValue="breakDecayHalfLifeDays"
      @update:modelValue="$emit('update:breakDecayHalfLifeDays', $event)"
      :min="0.1"
      :default="defaultHalfLifeDays"
      :step="0.1"
    />
  </div>
  <p class="text-xs text-gray-400 -mt-1">
    <strong>Target</strong> is the goal duration; <strong>Maximum</strong> (optional) is the hard ceiling.
    Minimum rest only applies when a maximum is set.
  </p>
  <RiskBands
    :band-count="bandCount"
    :crossover-points="crossoverPoints"
    @add-band="$emit('add-band')"
    @remove-band="$emit('remove-band')"
    @edit-crossover="(i) => $emit('open-duration-picker', i)"
  />
</template>

<script setup lang="ts">
import DurationTrigger from './DurationTrigger.vue';
import NumberField from './NumberField.vue';
import RiskBands from './RiskBands.vue';

defineProps<{
  hasMaxWear: boolean;
  minimumRestDisplay: string;
  breakGraceDisplay: string;
  breakDecayHalfLifeDays: number;
  defaultHalfLifeDays: number;
  bandCount: number;
  crossoverPoints: number[];
}>();
defineEmits<{
  'update:breakDecayHalfLifeDays': [value: number];
  'open-duration-picker': [target: 'minRest' | 'grace' | number];
  'add-band': [];
  'remove-band': [];
}>();
</script>
