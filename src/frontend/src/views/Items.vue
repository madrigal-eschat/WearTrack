<template>
  <k-page style="padding-bottom: 56px">
    <k-navbar title="Items" />
    <CategoriesSection />
    <ItemsSection />
  </k-page>
</template>

<script setup lang="ts">
import { kPage, kNavbar } from 'konsta/vue';
import CategoriesSection from '../components/CategoriesSection.vue';
import ItemsSection from '../components/ItemsSection.vue';
</script>
