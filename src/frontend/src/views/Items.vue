<template>
  <k-page style="padding-bottom: 56px">
    <PageHeader title="Items" />
    <CategoriesSection />
    <ItemsSection />
  </k-page>
</template>

<script setup lang="ts">
import { kPage } from 'konsta/vue'
import PageHeader from '../components/PageHeader.vue'
import CategoriesSection from '../components/CategoriesSection.vue'
import ItemsSection from '../components/ItemsSection.vue'
</script>
