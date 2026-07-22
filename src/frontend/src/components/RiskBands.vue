<template>
  <div>
    <label class="block text-sm font-medium text-gray-700 mb-1">Risk bands</label>
    <p class="text-xs text-gray-400 mb-2">
      Bands are triggered by cumulative wear time. Tap a threshold (▾) to change where one band ends and the next begins.
    </p>
    <div class="space-y-1">
      <template v-for="(bandName, i) in bandNames" :key="i">
        <div
          class="flex items-center justify-between rounded-lg px-3 py-2 text-sm font-medium"
          :class="bandColors[i]"
        >
          <span>{{ bandName }}</span>
          <div v-if="i === bandCount - 1" class="flex gap-1">
            <button
              type="button"
              class="w-7 h-7 rounded-full border border-gray-400 flex items-center justify-center text-gray-600 disabled:opacity-30"
              :disabled="bandCount <= 1"
              @click="$emit('remove-band')"
            >−</button>
            <button
              type="button"
              data-testid="add-band"
              class="w-7 h-7 rounded-full border border-gray-400 flex items-center justify-center text-gray-600 disabled:opacity-30"
              :disabled="bandCount >= 5"
              @click="$emit('add-band')"
            >+</button>
          </div>
        </div>
        <button
          v-if="i < bandCount - 1"
          type="button"
          class="flex items-center gap-1 px-3 text-sm text-gray-500"
          @click="$emit('edit-crossover', i)"
        >
          <span>{{ shortDuration(crossoverPoints[i]) }}</span>
          <span>▾</span>
        </button>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { bandNamesForCount, bandColorsForCount } from '../utils/riskLevels.js';
import { shortDuration } from '../utils/formatDuration.js';

const props = defineProps<{ bandCount: number; crossoverPoints: number[] }>();
defineEmits<{ 'add-band': []; 'remove-band': []; 'edit-crossover': [index: number] }>();

const bandNames = computed(() => bandNamesForCount(props.bandCount));
const bandColors = computed(() => bandColorsForCount(props.bandCount));
</script>
