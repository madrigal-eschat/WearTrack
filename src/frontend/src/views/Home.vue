<template>
  <k-page class="flex flex-col" style="padding-bottom: 56px">
    <k-navbar title="Weartrack">
      <template #right>
        <k-link navbar @click="settingsOpen = true">
          <cog-6-tooth-icon class="w-5 h-5" />
        </k-link>
      </template>
    </k-navbar>

    <!-- Two-pane layout: actions (top) + calendar (bottom) -->
    <div class="flex flex-col flex-1 overflow-hidden">
      <div class="flex-1 overflow-y-auto min-h-0">
        <action-pane />
      </div>
      <div class="border-t" style="height: 200px; flex-shrink: 0">
        <calendar-pane />
      </div>
    </div>

    <settings-drawer :open="settingsOpen" @close="settingsOpen = false" />
  </k-page>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { kPage, kNavbar, kLink } from 'konsta/vue';
import { Cog6ToothIcon } from '@heroicons/vue/24/solid';
import ActionPane from '../components/ActionPane.vue';
import CalendarPane from '../components/CalendarPane.vue';
import SettingsDrawer from '../components/SettingsDrawer.vue';

const settingsOpen = ref(false);
</script>
