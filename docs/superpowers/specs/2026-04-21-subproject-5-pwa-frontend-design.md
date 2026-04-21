# Sub-Project 5: PWA Frontend — Design

**Date**: 2026-04-21  
**Status**: Approved

## Goal

Build Vue 3 PWA frontend with Konsta UI, using two-pane layout (actions + calendar) as per main design.

**Stack**: Vue 3, Vite, Konsta UI, vite-plugin-pwa

## Application Structure

```
src/frontend/
├── index.html
├── src/
│   ├── assets/
│   ├── App.vue
│   ├── components/
│   │   ├── ActionPane.vue          # Top pane: actions + current session
│   │   ├── CalendarPane.vue        # Bottom pane: calendar view
│   │   ├── StatsPane.vue           # Stats view
│   │   ├── ItemsPane.vue           # Items config
│   │   ├── SettingsDrawer.vue      # Slide-over settings
│   │   └── CategoryList.vue         # Category/item list components
│   ├── composables/
│   │   ├── useItems.ts              # Fetch items, actions
│   │   ├── useWear.ts               # Wear session actions
│   │   ├── useCalendar.ts           # Calendar navigation
│   │   ├── useStats.ts              # Stats aggregation
│   │   └── useCategories.ts         # Category CRUD
│   ├── router/
│   │   └── index.ts                 # Vue router config
│   ├── views/
│   │   ├── Home.vue                 # Two-pane default view
│   │   ├── Items.vue                # Items list
│   │   ├── Stats.vue                # Stats view
│   │   └── Setup.vue                # Onboarding
│   └── main.ts
```

## Routing

```javascript
// src/router/index.ts
const routes = [
  {
    path: '/',
    component: Home,
    children: [
      {
        index: true,
        component: (): () => import('../views/Home.vue')
      },
      {
        path: 'items',
        component: (): () => import('../views/Items.vue')
      },
      {
        path: 'stats',
        component: (): () => import('../views/Stats.vue')
      },
    ]
  }
];

export default createRouter({
  history: createWebHistory(),
  routes
});
```

**Routes**:
- `/` → Home (two-pane: actions + calendar)
- `/items` → Items list (add/edit items)
- `/stats` → Stats leaderboard
- `/setup` → Onboarding (empty state)

## Home View (Two-Pane Layout)

```vue
<!-- src/views/Home.vue -->
<template>
  <div class="home">
    <!-- Top Pane: Actions -->
    <div class="pane actions">
      <CategoryList />
    </div>

    <!-- Bottom Pane: Calendar -->
    <div class="pane calendar">
      <CalendarPane />
    </div>
  </div>
</template>

<script setup>
// Use composables for reactivity
const { currentSession, wearAction } = useItems();
const { navigateDay } = useCalendar();
const { loadStats } = useStats();
</script>
```

## Action Pane Components

### Category List

Displays active/inactive categories with action buttons:

```vue
<!-- src/components/CategoryList.vue -->
<template>
  <div>
    <ListItem
      v-for="item in items"
      :key="item.id"
      :title="item.name"
      :subtitle="formatTime(item.status)"
      :color="item.color"
      :icon="item.icon"
    >
      <template #actions>
        <ActionButton
          v-if="item.status === 'rest'"
          @click="wearItem(item)"
          label="Wear"
        />
        <ActionButton
          v-else-if="injuredUntil(item)"
          label="Healed"
          secondary
        />
      </template>
    </ListItem>
  </div>
</template>

<script setup>
const { items } = useItems();
const { injuredUntil } = useCategories();
</script>
```

### Action Buttons

```vue
<!-- src/components/ActionButton.vue -->
<template>
  <KButton
    :variant="injury ? 'danger' : 'primary'"
    @click="$emit('click', $event)"
  >
    {{ label }}
  </KButton>
</template>
```

## Calendar Pane

```vue
<!-- src/components/CalendarPane.vue -->
<template>
  <div class="calendar">
    <KHeaderToolbar title="Wear Calendar" />
    <KLiquidStepper
      :value="selectedDate"
      :options="calendarOptions"
      @input="navigateDay"
    />
    <div class="day-grid">
      <div
        v-for="day in weekDays"
        :key="day.date"
        @click="navToDay(day)"
      >
        {{ day.dayNumber }}
        <div class="worn-indicator" v-if="day.worn">
          {{ day.worn }}h{{ day.worn % 60 > 0 ? ':' + day.worn % 60 : '' }}
        </div>
      </div>
    </div>
  </div>
</template>
```

## Stats Pane

```vue
<!-- src/views/Stats.vue -->
<template>
  <div class="stats">
    <KHeaderToolbar title="Stats" @icon-click="openLeaderboard" />
    
    <KLiquidStepper
      title="Leaderboard Type"
      :options="leaderboardOptions"
    />

    <div class="leaderboard">
      <ListItem
        v-for="item in sortedStats"
        :key="item.item.id"
        :title="item.item.name"
        :subtitle="`${item.rank}. ${item.stat}`"
        :color="item.item.color"
      >
        <template #actions>
          <KBadge :text="formatWear(item.stat)" />
          <KBadge :text="item.points" />
        </template>
      </ListItem>
    </div>
  </div>
</template>
```

## Items View

```vue
<!-- src/views/Items.vue -->
<template>
  <div class="items">
    <KHeaderToolbar title="Items" @icon-click="addNewItem" />

    <CategoryList
      :items="items"
      :categories="categories"
    >
      <template #actions>
        <ActionButton
          v-if="item.category_id"
          label="Edit"
          secondary
        />
      </template>
    </CategoryList>
  </div>
</template>
```

## Settings Drawer (Slide-over)

```vue
<!-- src/components/SettingsDrawer.vue -->
<template>
  <KDrawer
    :open="drawerOpen"
    @open="onOpen"
    @close="onClose"
  >
    <KDrawerToolbar
      title="Settings"
      close-button-variant="plain"
    >
      <template #icon>
        <i class="fas fa-cog"></i>
      </template>
    </KDrawerToolbar>

    <KBody>
      <KStack>
        <KStackRow label="Dark Mode">
          <KToggle v-model="settings.darkMode" />
        </KStackRow>
        
        <KStackRow label="Notifications">
          <KToggle v-model="settings.notifications" />
        </KStackRow>
        
        <KStackRow label="Category">
          <KTextField label="Category" v-model.trim="newCategory">
            <template #append>
              <KButton
                label="Add Category"
                variant="primary"
                @click="addCategory"
              >
                <template #icon:append>
                  <Icon type="plus" />
                </template>
              </KButton>
            </template>
          </KTextField>
        </KStackRow>
        
        <KStackRow label="Wear Length (min)">
          <KTextField type="number" v-model.number="settings.wearLength" />
        </KStackRow>
      </KStack>
    </KBody>
  </KDrawer>
</template>
```

## Onboarding View (Empty State)

When no data exists:

```vue
<!-- src/views/Setup.vue -->
<template>
  <div class="empty-state">
    <KLiquidPage>
      <KLiquidPageContent>
        <KHeaderToolbar title="Welcome to Weartrack">
          <template #icon>
            <Icon type="plug" />
          </template>
          <template #actions>
            <KButton
              @click="$router.push('/items')"
              label="Add Categories"
            />
          </template>
        </KHeaderToolbar>

        <KLiquidRow>
          <KLiquidColumn width="50%">
            <p>
              No categories configured yet. Create your categories and items to start tracking.
            </p>
          </KLiquidColumn>
          <KLiquidColumn width="50%">
            <p>
              Tap the gear icon in the bottom-left corner to open settings and manage your setup.
            </p>
          </KLiquidColumn>
        </KLiquidRow>
      </KLiquidPageContent>
    </KLiquidPage>
  </div>
</template>
```

## PWA Manifest

```javascript
// vite.config.ts - PWA config
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        globPatterns: ['**/*.{js,css,html,jpeg,png,svg,ico}'],
        runtimeCaching: [/* ... */],
      },
      manifest: {
        name: 'Weartrack',
        short_name: 'Weartrack',
        description: 'Track and manage wear sessions',
        theme_color: '#1c1c1c',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
    }),
  ],
});
```

## Composables (No Pinia)

```typescript
// src/composables/useItems.ts
export function useItems() {
  return {
    items: ref([]),
    loadItems: async () => {
      const response = await fetch('/api/items?include=category');
      const data = await response.json();
      items.value = data.items;
    },
    wearAction: (item) => {
      // Wear session logic
    },
    formatTime: (item) => {
      // Format current status
    },
  };
}
```

## Konsta UI Components Used

- `KHeaderToolbar` - Page headers with navigation
- `KLiquidPage` - Page container
- `KLiquidRow` / `KLiquidColumn` - Layout
- `KStack` / `KStackRow` - Stacked layouts
- `KLiquidStepper` - Day navigation
- `KButton` / `KToggle` / `KTextField` - Controls
- `KDrawer` / `KDrawerToolbar` - Settings slide-over
- `ListItem` - List items with actions
