<template>
  <div>
    <label class="block text-sm font-medium text-gray-700 mb-1">Icon</label>
    <button
      type="button"
      class="flex items-center gap-2 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-left"
      @click="$emit('click')"
    >
      <template v-if="modelValue">
        <Icon :icon="modelValue" class="text-xl shrink-0" />
        <span class="text-gray-700">{{ modelValue.replace('ph:', '') }}</span>
      </template>
      <template v-else>
        <Icon icon="ph:squares-four" class="text-xl shrink-0 text-gray-400" />
        <span class="text-gray-400">Choose icon…</span>
      </template>
    </button>
  </div>
</template>

<script setup lang="ts">
import { Icon } from '@iconify/vue';

defineProps<{ modelValue: string }>();
defineEmits<{ click: [] }>();
</script>
