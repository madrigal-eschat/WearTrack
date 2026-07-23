<template>
  <k-page class="flex flex-col" style="padding-bottom: 56px">
    <PageHeader title="Home">
      <template #action>
        <button
          type="button"
          class="mr-2 text-gray-500"
          aria-label="Settings"
          @click="router.push('/settings')"
        >
          <Cog6ToothIcon class="w-6 h-6" />
        </button>
      </template>
    </PageHeader>
    <!-- Two-pane layout: actions (top) + calendar (bottom) -->
    <div class="flex flex-col flex-1 overflow-hidden">
      <div class="flex-1 overflow-y-auto min-h-0">
        <action-pane />
      </div>
      <div class="border-t" style="height: 200px; flex-shrink: 0">
        <calendar-pane />
      </div>
    </div>
  </k-page>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router';
import { kPage } from 'konsta/vue';
import { Cog6ToothIcon } from '@heroicons/vue/24/solid';
import PageHeader from '../components/PageHeader.vue';
import ActionPane from '../components/ActionPane.vue';
import CalendarPane from '../components/CalendarPane.vue';

const router = useRouter();
</script>
