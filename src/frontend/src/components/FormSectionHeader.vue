<template>
  <div class="flex justify-between items-center px-4 mt-6 mb-2">
    <span class="font-semibold text-[17px] text-black/60 dark:text-white/60">{{ title }}</span>
    <button v-if="showToggle" type="button" class="text-blue-500 text-sm font-normal" @click="$emit('toggle')">
      {{ isOpen ? 'Cancel' : '+ Add' }}
    </button>
  </div>
</template>

<script setup lang="ts">
defineProps<{ title: string; isOpen: boolean; showToggle?: boolean }>();
defineEmits<{ toggle: [] }>();
</script>
