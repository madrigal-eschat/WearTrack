<template>
  <div class="flex justify-between items-center px-4 mt-6 mb-2">
    <SectionTitle variant="section">{{ title }}</SectionTitle>
    <button v-if="showToggle" type="button" class="text-blue-500 text-sm font-normal" @click="$emit('toggle')">
      {{ isOpen ? 'Cancel' : '+ Add' }}
    </button>
  </div>
</template>

<script setup lang="ts">
import SectionTitle from './SectionTitle.vue';

defineProps<{ title: string; isOpen: boolean; showToggle?: boolean }>();
defineEmits<{ toggle: [] }>();
</script>
