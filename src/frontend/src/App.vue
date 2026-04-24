<template>
  <k-app theme="ios" class="h-full">
    <Toast />
    <router-view />
    <k-toolbar bottom class="left-0 right-0 bottom-0 fixed z-30">
      <k-tabbar labels icons>
        <k-tabbar-link
          :active="route.path === '/'"
          label="Home"
          @click="router.push('/')"
        >
          <template #icon>
            <home-icon class="w-6 h-6" />
          </template>
        </k-tabbar-link>
        <k-tabbar-link
          :active="route.path === '/items'"
          label="Items"
          @click="router.push('/items')"
        >
          <template #icon>
            <ItemsIcon class="w-6 h-6" />
          </template>
        </k-tabbar-link>
        <k-tabbar-link
          :active="route.path === '/stats'"
          label="Stats"
          @click="router.push('/stats')"
        >
          <template #icon>
            <chart-bar-icon class="w-6 h-6" />
          </template>
        </k-tabbar-link>
      </k-tabbar>
    </k-toolbar>
  </k-app>
</template>

<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router';
import { kApp, kToolbar, kTabbar, kTabbarLink } from 'konsta/vue';
import { HomeIcon, Squares2X2Icon as ItemsIcon, ChartBarIcon } from '@heroicons/vue/24/solid';
import Toast from './components/Toast.vue';

const route = useRoute();
const router = useRouter();
</script>

<style>
* { box-sizing: border-box; }
html, body, #app { height: 100%; margin: 0; padding: 0; }
</style>
