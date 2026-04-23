<template>
  <!-- Sheet slides up from bottom -->
  <k-sheet
    :opened="open"
    @backdropclick="$emit('close')"
    class="pb-safe"
  >
    <k-toolbar>
      <div class="flex w-full items-center justify-between px-4">
        <span class="font-semibold">Categories</span>
        <k-button clear @click="$emit('close')">Done</k-button>
      </div>
    </k-toolbar>

    <div class="overflow-y-auto px-4 py-2" style="max-height: 60vh">
      <!-- Existing categories -->
      <k-list v-if="categories.length > 0" inset>
        <k-list-item
          v-for="cat in categories"
          :key="cat.id"
          :title="cat.name"
          :subtitle="`icon: ${cat.icon}`"
        >
          <template #after>
            <k-button
              small
              outline
              colors="{ textIos: 'text-red-500' }"
              @click="onDelete(cat.id)"
            >Delete</k-button>
          </template>
        </k-list-item>
      </k-list>
      <p v-else class="text-sm text-gray-400 py-4 text-center">No categories yet.</p>

      <!-- Add new category (minimal fields) -->
      <k-block-title>Add Category</k-block-title>
      <k-list inset>
        <k-list-input label="Name" type="text" :value="form.name" @input="form.name = ($event.target as HTMLInputElement).value" />
        <k-list-input label="Icon (SF symbol or emoji)" type="text" :value="form.icon" @input="form.icon = ($event.target as HTMLInputElement).value" />
      </k-list>
      <div class="px-2 pb-4">
        <k-button @click="onAdd" :disabled="!form.name || !form.icon">Add Category</k-button>
      </div>
    </div>
  </k-sheet>
</template>

<script setup lang="ts">
import { reactive, onMounted } from 'vue';
import { kSheet, kToolbar, kButton, kList, kListItem, kListInput, kBlockTitle } from 'konsta/vue';
import { useCategories } from '../composables/useCategories.js';

defineProps<{ open: boolean }>();
defineEmits<{ close: [] }>();

const { categories, loadCategories, createCategory, deleteCategory } = useCategories();

onMounted(loadCategories);

const form = reactive({ name: '', icon: '' });

async function onAdd() {
  if (!form.name || !form.icon) return;
  try {
    await createCategory({
      name: form.name,
      icon: form.icon,
      initial_wear_duration_seconds: 900,
      rest_multiplier: 2,
      rest_constant_seconds: 86400,
      risk_levels: [
        { lower: null, upper: 3600, text: 'Low', severity: 1 },
        { lower: 3600, upper: 7200, text: 'Medium', severity: 2 },
        { lower: 7200, upper: null, text: 'High', severity: 3 },
      ],
      break_decay_multiplier: 0.75,
      break_starts_after_seconds: 604800,
    });
    form.name = '';
    form.icon = '';
  } catch (e) {
    alert(String(e));
  }
}

async function onDelete(id: number) {
  if (!confirm('Delete this category and all its items?')) return;
  try {
    await deleteCategory(id);
  } catch (e) {
    alert(String(e));
  }
}
</script>
