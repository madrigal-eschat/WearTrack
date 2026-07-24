<template>
  <div>
    <label
      v-if="label"
      :for="id"
      class="block text-sm font-medium text-gray-700 mb-1"
    >{{ label }}</label>
    <input
      :id="id"
      :value="modelValue"
      @input="
        $emit(
          'update:modelValue',
          ($event.target as HTMLInputElement).value,
        )
      "
      :type="type ?? 'text'"
      :placeholder="placeholder"
      class="
        w-full border border-gray-300 rounded-lg px-3 py-2 text-sm
        focus:outline-none focus:ring-2 focus:ring-blue-500
      "
    />
  </div>
</template>

<script setup lang="ts">
defineProps<{
  id?: string;
  label?: string;
  modelValue: string;
  placeholder?: string;
  type?: string;
}>()
defineEmits<{ 'update:modelValue': [value: string] }>()
</script>
