<template>
  <k-page style="padding-bottom: 56px">
    <k-navbar title="Welcome to Weartrack" />
    <k-block>
      <p class="text-gray-600 text-center mb-6">
        Track your wearable items — shoes, braces, retainers, anything you wear on a schedule.
      </p>
      <p class="text-gray-500 text-sm text-center mb-8">
        Start by adding a category (e.g. "Footwear") and your first item from the Home screen.
      </p>
      <k-button large @click="router.push('/')">Get Started</k-button>
    </k-block>
  </k-page>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router';
import { kPage, kNavbar, kBlock, kButton } from 'konsta/vue';

const router = useRouter();
</script>
