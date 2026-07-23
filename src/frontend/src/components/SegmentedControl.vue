<template>
  <div class="flex gap-2 overflow-x-auto px-4 py-3 no-scrollbar">
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      class="
        flex-shrink-0 px-3 py-1 rounded-full text-sm border transition-colors
      "
      :class="modelValue === option.value
        ? 'bg-blue-500 text-white border-blue-500'
        : 'bg-white text-gray-700 border-gray-300'"
      @click="$emit('update:modelValue', option.value)"
    >
      {{ option.label }}
    </button>
  </div>
</template>

<script setup lang="ts" generic="T extends string">
defineProps<{
  options: ReadonlyArray<{ value: T; label: string }>;
  modelValue: T;
}>();
defineEmits<{ 'update:modelValue': [value: T] }>();
</script>

<style scoped>
.no-scrollbar::-webkit-scrollbar { display: none; }
.no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
</style>
