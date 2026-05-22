<template>
  <k-page class="pt-4" style="padding-bottom: 56px">
    <CategoriesSection />
    <ItemsSection />
  </k-page>
</template>

<script setup lang="ts">
import { kPage } from 'konsta/vue';
import CategoriesSection from '../components/CategoriesSection.vue';
import ItemsSection from '../components/ItemsSection.vue';
</script>
