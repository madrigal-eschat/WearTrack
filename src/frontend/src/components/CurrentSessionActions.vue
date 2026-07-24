<template>
  <div class="flex gap-2 items-center">
    <template v-if="entry.session !== null">
      <k-button small outline @click="$emit('stop')">Stop</k-button>
    </template>
    <template v-else>
      <div
        v-if="entry.category.type !== 'rotation' || restRemaining === 0"
        class="flex gap-2 items-center"
      >
        <template v-if="locked">
          <span
            class="text-sm font-medium"
            data-testid="forced-item-label"
          >{{ forcedItemName }}</span>
          <k-button
            small
            inline
            outline
            data-testid="wear-something-else"
            @click="$emit('choose-something-else')"
          >Choose Something Else</k-button>
          <k-button small inline @click="$emit('wear')">Wear</k-button>
        </template>
        <template v-else>
          <select
            v-if="items.length > 0"
            :value="selectedItemId"
            @change="
              $emit(
                'update:selectedItemId',
                Number(($event.target as HTMLSelectElement).value),
              )
            "
            class="text-sm border rounded px-1 py-0.5"
          >
            <option
              v-for="item in items"
              :key="item.id"
              :value="item.id"
              :disabled="
                entry.category.type === 'rotation' &&
                  !itemRotationAvailable(item.id)
              "
            >{{ item.name }}</option>
          </select>
          <span v-else class="text-sm text-gray-400 italic">No items</span>
          <k-button
            small
            :disabled="!selectedItemId"
            :class="{ 'opacity-60': itemRestRemaining > 0 }"
            @click="$emit('wear')"
          >Wear</k-button>
        </template>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { kButton } from 'konsta/vue'
import type { CurrentEntry } from '../composables/useWear.js'

defineProps<{
  entry: CurrentEntry;
  items: { id: number; name: string }[];
  selectedItemId: number | null;
  locked: boolean;
  forcedItemName: string;
  /**
   * Gates whether the whole locked/dropdown cluster renders at all for
   * rotation categories: the *effective* rest (daily rotation cap), matching
   * `effectiveRestRemainingSeconds` in ActionPane.vue. Deliberately distinct
   * from `itemRestRemaining` below - conflating the two would show the
   * dropdown Wear button when the category's still in its rotation rest
   * period, or hide it based on an unrelated per-item rest window.
   */
  restRemaining: number;
  /**
   * Per-item rest remaining (`restRemainingSeconds`), used only for the
   * unlocked Wear button's opacity hint.
   */
  itemRestRemaining: number;
  itemRotationAvailable: (itemId: number) => boolean;
}>()
defineEmits<{
  'update:selectedItemId': [value: number | null];
  stop: [];
  'choose-something-else': [];
  wear: [];
}>()
</script>
