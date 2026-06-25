<template>
  <!-- Sheet slides up from bottom; v-if removes it from DOM when closed to prevent pointer-event blocking -->
  <k-sheet
    v-if="open"
    :opened="open"
    @backdropclick="$emit('close')"
    class="pb-safe bg-white dark:bg-gray-900"
  >
    <k-toolbar innerClass="!h-6">
      <div class="flex w-full items-center justify-between">
        <span class="font-semibold text-sm">Settings</span>
        <k-button clear @click="$emit('close')">Done</k-button>
      </div>
    </k-toolbar>

    <div class="overflow-y-auto px-4 py-4" style="max-height: 60vh">
      <p class="text-sm text-gray-500 text-center">
        Manage categories and items from the <strong>Items</strong> tab.
      </p>

      <div class="mt-4">
        <p v-if="!isSupported" class="text-sm text-gray-400 text-center">
          Push notifications are not supported in this browser.
        </p>
        <p v-else-if="!isConfigured" class="text-sm text-amber-600 text-center">
          Push notifications are not configured on the server.
        </p>
        <k-list v-else>
          <k-list-item
            title="Push notifications"
            :after="isSubscribed ? 'On' : 'Off'"
          >
            <template #after>
              <k-toggle :checked="isSubscribed" @change="onToggle" />
            </template>
          </k-list-item>
        </k-list>
      </div>
    </div>
  </k-sheet>
</template>

<script setup lang="ts">
import { kSheet, kToolbar, kButton, kList, kListItem, kToggle } from 'konsta/vue';
import { useNotifications } from '../composables/useNotifications.js';

defineProps<{ open: boolean }>();
defineEmits<{ close: [] }>();

const { isSupported, isConfigured, isSubscribed, enable, disable } = useNotifications();

async function onToggle() {
  if (isSubscribed.value) {
    await disable();
  } else {
    await enable();
  }
}
</script>
