<template>
  <div
    data-testid="color-circle"
    class="w-3 h-3 rounded-full"
    :style="{ background: color }"
  />
</template>

<script setup lang="ts">
defineProps<{ color: string }>();
</script>
