<template>
  <Transition name="toast">
    <div
      v-if="message"
      class="
        fixed top-4 left-4 right-4 z-50 bg-red-500 text-white px-4 py-3
        rounded-lg shadow-lg flex justify-between items-center
      "
    >
      <span class="text-sm">{{ message }}</span>
      <button
        class="ml-3 opacity-75 hover:opacity-100 text-white"
        @click="dismiss"
      >✕</button>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { useToast } from '../composables/useToast.js'
const { message, dismiss } = useToast()
</script>

<style scoped>
.toast-enter-active, .toast-leave-active {
  transition: opacity 0.2s, transform 0.2s;
}
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateY(-8px); }
</style>
