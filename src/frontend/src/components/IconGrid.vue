<template>
  <div class="grid gap-1" style="grid-template-columns: repeat(8, minmax(0, 1fr))">
    <button
      v-for="entry in entries"
      :key="entry.id"
      type="button"
      class="flex items-center justify-center w-10 h-10 rounded-lg"
      :class="entry.id === selectedId ? 'ring-2 ring-blue-500 bg-blue-50' : 'hover:bg-gray-100'"
      :title="entry.id.slice(3)"
      @click="$emit('select', entry.id)"
    >
      <Icon :icon="entry.id" class="text-2xl" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { Icon } from '@iconify/vue';

defineProps<{ entries: { id: string }[]; selectedId: string }>();
defineEmits<{ select: [id: string] }>();
</script>
