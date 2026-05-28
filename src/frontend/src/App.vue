<template>
  <k-app theme="ios" class="h-full">
    <Toast />
    <div data-testid="main-content">
      <router-view />
    </div>
    <SettingsDrawer :open="settingsOpen" @close="settingsOpen = false" />
    <k-tabbar bottom labels icons class="left-0 right-0 bottom-0 fixed z-30 !bg-white border-t border-gray-200">
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
        <k-tabbar-link
          :active="settingsOpen"
          label="Settings"
          @click="settingsOpen = true"
        >
          <template #icon>
            <cog-6-tooth-icon class="w-6 h-6" />
          </template>
        </k-tabbar-link>
    </k-tabbar>
  </k-app>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { kApp, kTabbar, kTabbarLink } from 'konsta/vue';
import { HomeIcon, Squares2X2Icon as ItemsIcon, ChartBarIcon, Cog6ToothIcon } from '@heroicons/vue/24/solid';
import Toast from './components/Toast.vue';
import SettingsDrawer from './components/SettingsDrawer.vue';

const route = useRoute();
const router = useRouter();
const settingsOpen = ref(false);
</script>

<style>
* { box-sizing: border-box; }
html, body, #app { height: 100%; margin: 0; padding: 0; }
</style>
