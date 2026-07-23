<template>
  <div>
    <label
      v-if="label"
      :for="id"
      class="block text-sm font-medium text-gray-700 mb-1"
    >{{ label }}</label>
    <input
      :id="id"
      :value="modelValue"
      @input="
        $emit(
          'update:modelValue',
          Number(($event.target as HTMLInputElement).value),
        )
      "
      @blur="onBlur"
      type="number"
      :min="min"
      :max="max"
      :step="step ?? 1"
      class="
        w-20 border border-gray-300 rounded-lg px-3 py-2 text-sm
        focus:outline-none focus:ring-2 focus:ring-blue-500
      "
    />
  </div>
</template>

<script setup lang="ts">
import { clampNumber } from '../utils/clampNumber.js';

const props = defineProps<{
  id?: string;
  label?: string;
  modelValue: number;
  min?: number;
  max?: number;
  default: number;
  step?: number;
}>();
const emit = defineEmits<{ 'update:modelValue': [value: number] }>();

function onBlur(e: Event) {
  const raw = (e.target as HTMLInputElement).value;
  emit(
    'update:modelValue',
    clampNumber(raw, {
      min: props.min,
      max: props.max,
      default: props.default,
    }),
  );
}
</script>
