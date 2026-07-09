<template>
  <k-page style="padding-bottom: 56px">
    <PageHeader title="Settings" showBack @back="router.push('/')" />
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
import { kPage, kList, kListItem, kToggle } from 'konsta/vue';
import { useNotifications } from '../composables/useNotifications.js';
import PageHeader from '../components/PageHeader.vue';

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
