<template>
  <k-page class="flex flex-col pt-4" style="padding-bottom: 56px">
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
import { kPage } from 'konsta/vue';
import ActionPane from '../components/ActionPane.vue';
import CalendarPane from '../components/CalendarPane.vue';
</script>
