<template>
  <div>
    <label
      v-if="label"
      :for="id"
      class="block text-sm font-medium text-gray-700 mb-1"
    >{{ label }}</label>
    <div class="flex items-center gap-1">
      <button
        :id="id"
        type="button"
        :disabled="disabled"
        :data-testid="testid"
        class="
          flex items-center gap-1 border border-gray-300 rounded-lg px-3 py-2
          text-sm bg-white disabled:opacity-40
        "
        @click="$emit('click')"
      >
        <span>{{ displayValue }}</span><span class="text-gray-400">▾</span>
      </button>
      <button
        v-if="clearable"
        type="button"
        :data-testid="clearTestid"
        class="text-xs text-gray-400 underline"
        @click="$emit('clear')"
      >clear</button>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  id?: string;
  label?: string;
  displayValue: string;
  disabled?: boolean;
  clearable?: boolean;
  testid?: string;
  clearTestid?: string;
}>();
defineEmits<{ click: []; clear: [] }>();
</script>
