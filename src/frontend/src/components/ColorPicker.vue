<template>
  <div class="relative inline-block">
    <button
      data-testid="color-trigger"
      class="w-6 h-6 rounded-full border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
      :style="{ background: modelValue }"
      @click.stop="opened = !opened"
    />

    <!-- Backdrop -->
    <div v-if="opened" data-testid="color-backdrop" class="fixed inset-0 z-40" @click="opened = false" />

    <!-- Dropdown -->
    <div
      v-if="opened"
      class="absolute left-0 top-8 z-50 bg-white rounded-xl shadow-lg border border-gray-100 p-3 min-w-max"
    >
      <!-- Swatches row -->
      <div class="flex flex-wrap gap-2 mb-3">
        <button
          v-for="swatch in SWATCHES"
          :key="swatch"
          data-testid="color-swatch"
          class="w-7 h-7 rounded-full border-2 focus:outline-none"
          :class="swatch === modelValue ? 'border-gray-800' : 'border-transparent'"
          :style="{ background: swatch }"
          @click.stop="select(swatch)"
        />
      </div>

      <!-- Advanced toggle -->
      <button
        class="text-xs text-blue-500 mb-2 block"
        @click.stop="showAdvanced = !showAdvanced"
      >
        {{ showAdvanced ? 'Hide advanced' : 'Advanced' }}
      </button>

      <!-- Sliders -->
      <div v-if="showAdvanced" class="space-y-3 w-48">
        <div>
          <label class="text-xs text-gray-600 block mb-1">Hue: {{ hue }}</label>
          <input
            data-testid="hue-slider"
            type="range"
            min="0"
            max="360"
            step="1"
            class="w-full"
            :value="hue"
            @input="onHueInput"
          />
        </div>
        <div>
          <label class="text-xs text-gray-600 block mb-1">Chroma: {{ chroma }}</label>
          <input
            data-testid="chroma-slider"
            type="range"
            min="0"
            max="0.3"
            step="0.01"
            class="w-full"
            :value="chroma"
            @input="onChromaInput"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { SWATCHES, buildOklch } from '../utils/colors.js';

const props = defineProps<{ modelValue: string }>();
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();

const opened = ref(false);
const showAdvanced = ref(false);

const hue = ref(240);
const chroma = ref(0.15);

watch(
  () => props.modelValue,
  (val) => {
    const m = val.match(/oklch\([\d.]+ ([\d.]+) ([\d.]+)\)/);
    if (m) {
      chroma.value = parseFloat(m[1]);
      hue.value = parseFloat(m[2]);
    }
  },
  { immediate: true }
);

function select(color: string) {
  emit('update:modelValue', color);
  opened.value = false;
}

function onHueInput(e: Event) {
  hue.value = parseFloat((e.target as HTMLInputElement).value);
  emit('update:modelValue', buildOklch(chroma.value, hue.value));
}

function onChromaInput(e: Event) {
  chroma.value = parseFloat((e.target as HTMLInputElement).value);
  emit('update:modelValue', buildOklch(chroma.value, hue.value));
}
</script>
