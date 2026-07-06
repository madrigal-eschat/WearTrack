<template>
  <k-page style="padding-bottom: 56px">
    <div class="flex items-center gap-2 px-2 py-2">
      <button type="button" aria-label="Back" class="text-gray-500 p-2" @click="router.push('/')">
        <ChevronLeftIcon class="w-6 h-6" />
      </button>
      <SectionTitle variant="page">Settings</SectionTitle>
    </div>
    <div class="px-4 py-4">
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
  </k-page>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router';
import { ChevronLeftIcon } from '@heroicons/vue/24/solid';
import { kPage, kList, kListItem, kToggle } from 'konsta/vue';
import { useNotifications } from '../composables/useNotifications.js';
import SectionTitle from '../components/SectionTitle.vue';

const router = useRouter();
const { isSupported, isConfigured, isSubscribed, enable, disable } = useNotifications();

async function onToggle() {
  if (isSubscribed.value) {
    await disable();
  } else {
    await enable();
  }
}
</script>
