<template>
  <!-- Sheet slides up from bottom -->
  <k-sheet
    :opened="open"
    @backdropclick="$emit('close')"
    class="pb-safe"
  >
    <k-toolbar>
      <div class="flex w-full items-center justify-between px-4">
        <span class="font-semibold">Settings</span>
        <k-button clear @click="$emit('close')">Done</k-button>
      </div>
    </k-toolbar>

    <div class="overflow-y-auto px-4 py-4" style="max-height: 60vh">
      <p class="text-sm text-gray-500 text-center">
        Manage categories and items from the <strong>Items</strong> tab.
      </p>
    </div>
  </k-sheet>
</template>

<script setup lang="ts">
import { kSheet, kToolbar, kButton } from 'konsta/vue';

defineProps<{ open: boolean }>();
defineEmits<{ close: [] }>();
</script>
