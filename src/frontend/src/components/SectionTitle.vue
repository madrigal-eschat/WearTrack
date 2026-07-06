<template>
  <span :class="classes"><slot /></span>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{ variant: 'page' | 'section' | 'sheet' | 'group' }>();

const classes = computed(() => ({
  page: 'text-title-page font-semibold',
  section: 'text-title-section font-semibold text-black/60 dark:text-white/60',
  sheet: 'text-title-sheet font-semibold',
  group: 'text-title-group font-semibold text-gray-500 uppercase tracking-wide',
}[props.variant]));
</script>
