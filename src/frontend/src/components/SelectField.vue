<template>
  <div>
    <label
      v-if="label"
      :for="id"
      class="block text-sm font-medium text-gray-700 mb-1"
    >{{ label }}</label>
    <select
      :id="id"
      :value="modelValue"
      @change="
        $emit(
          'update:modelValue',
          ($event.target as HTMLSelectElement).value,
        )
      "
      class="
        w-full border border-gray-300 rounded-lg px-3 py-2 text-sm
        focus:outline-none focus:ring-2 focus:ring-blue-500
      "
    >
      <slot />
    </select>
  </div>
</template>

<script setup lang="ts">
defineProps<{ id?: string; label?: string; modelValue: string }>();
defineEmits<{ 'update:modelValue': [value: string] }>();
</script>
