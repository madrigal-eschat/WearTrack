<template>
  <div class="flex items-center gap-2 px-2 py-2">
    <button
      v-if="showBack"
      type="button"
      aria-label="Back"
      class="text-gray-500 p-2"
      @click="$emit('back')"
    >
      <ChevronLeftIcon class="w-6 h-6" />
    </button>
    <SectionTitle variant="page">{{ title }}</SectionTitle>
    <div class="ml-auto"><slot name="action" /></div>
  </div>
</template>

<script setup lang="ts">
import { ChevronLeftIcon } from '@heroicons/vue/24/solid';
import SectionTitle from './SectionTitle.vue';

defineProps<{ title: string; showBack?: boolean }>();
defineEmits<{ back: [] }>();
</script>
