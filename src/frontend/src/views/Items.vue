<template>
  <k-page style="padding-bottom: 56px">
    <k-navbar title="Items" />

    <!-- ── Categories ────────────────────────────────────── -->
    <k-block-title>
      <span>Categories</span>
      <template #right>
        <button class="text-blue-500 text-sm font-normal" @click="showCatForm = !showCatForm">
          {{ showCatForm ? 'Cancel' : '+ Add' }}
        </button>
      </template>
    </k-block-title>

    <!-- Add-category form -->
    <div v-if="showCatForm">
      <k-list inset>
        <k-list-input
          label="Name"
          type="text"
          :value="catForm.name"
          @input="catForm.name = ($event.target as HTMLInputElement).value"
        />
        <k-list-input
          label="Icon (emoji or symbol)"
          type="text"
          placeholder="👟"
          :value="catForm.icon"
          @input="catForm.icon = ($event.target as HTMLInputElement).value"
        />
      </k-list>
      <div class="px-4 pb-2">
        <k-button @click="onAddCategory" :disabled="!catForm.name || !catForm.icon">
          Add Category
        </k-button>
      </div>
    </div>

    <!-- Category list -->
    <div v-if="loading" class="text-center py-4 text-gray-400">Loading…</div>
    <template v-else>
      <k-list v-if="categories.length > 0" inset>
        <k-list-item
          v-for="cat in categories"
          :key="cat.id"
          :title="cat.name"
          :subtitle="cat.icon"
        >
          <template #after>
            <k-button small outline @click="onDeleteCategory(cat.id)">Delete</k-button>
          </template>
        </k-list-item>
      </k-list>
      <k-block v-else>
        <p class="text-center text-gray-400 text-sm">No categories yet. Use "+ Add" above to create one.</p>
      </k-block>
    </template>

    <!-- ── Items ─────────────────────────────────────────── -->
    <k-block-title>
      <span>Items</span>
      <template #right>
        <button
          v-if="categories.length > 0"
          class="text-blue-500 text-sm font-normal"
          @click="showItemForm = !showItemForm"
        >
          {{ showItemForm ? 'Cancel' : '+ Add' }}
        </button>
      </template>
    </k-block-title>

    <!-- Add-item form -->
    <div v-if="showItemForm && categories.length > 0">
      <k-list inset>
        <k-list-input
          label="Name"
          type="text"
          :value="itemForm.name"
          @input="itemForm.name = ($event.target as HTMLInputElement).value"
        />
        <k-list-input
          label="Color (hex)"
          type="text"
          placeholder="#3b82f6"
          :value="itemForm.color"
          @input="itemForm.color = ($event.target as HTMLInputElement).value"
        />
        <k-list-item title="Category">
          <template #after>
            <select v-model="itemForm.category_id" class="text-sm border rounded px-1 py-0.5">
              <option :value="null" disabled>Select…</option>
              <option v-for="cat in categories" :key="cat.id" :value="cat.id">{{ cat.name }}</option>
            </select>
          </template>
        </k-list-item>
      </k-list>
      <div class="px-4 pb-2">
        <k-button
          @click="onAddItem"
          :disabled="!itemForm.name || !itemForm.color || !itemForm.category_id"
        >
          Add Item
        </k-button>
      </div>
    </div>

    <!-- Items grouped by category -->
    <template v-if="!loading">
      <div v-for="cat in categories" :key="cat.id">
        <k-block-title class="text-xs text-gray-500 uppercase tracking-wide">{{ cat.name }}</k-block-title>
        <k-list inset>
          <k-list-item
            v-for="item in itemsForCategory(cat.id)"
            :key="item.id"
            :title="item.name"
          >
            <template #media>
              <div class="w-3 h-3 rounded-full" :style="{ background: item.color }"></div>
            </template>
            <template #after>
              <k-button small outline @click="onDeleteItem(item.id)">Delete</k-button>
            </template>
          </k-list-item>
          <k-list-item
            v-if="itemsForCategory(cat.id).length === 0"
            title="No items in this category"
            class="text-gray-400"
          />
        </k-list>
      </div>
    </template>
  </k-page>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { kPage, kNavbar, kBlockTitle, kList, kListItem, kListInput, kButton, kBlock } from 'konsta/vue';
import { useItems } from '../composables/useItems.js';
import { useCategories } from '../composables/useCategories.js';
import type { Item } from '../composables/useWear.js';

const { items, loadItems, createItem, deleteItem } = useItems();
const { categories, loadCategories, createCategory, deleteCategory } = useCategories();

const loading = ref(true);
const showCatForm = ref(false);
const showItemForm = ref(false);

const catForm = reactive({ name: '', icon: '' });
const itemForm = reactive<{ name: string; color: string; category_id: number | null }>({
  name: '',
  color: '#3b82f6',
  category_id: null,
});

onMounted(async () => {
  await Promise.all([loadCategories(), loadItems()]);
  loading.value = false;
  if (categories.value.length > 0) {
    itemForm.category_id = categories.value[0].id;
  }
});

function itemsForCategory(categoryId: number): Item[] {
  return items.value.filter((i) => i.category_id === categoryId);
}

// ── Category actions ──────────────────────────────────────

async function onAddCategory() {
  if (!catForm.name || !catForm.icon) return;
  try {
    await createCategory({
      name: catForm.name,
      icon: catForm.icon,
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
    catForm.name = '';
    catForm.icon = '';
    showCatForm.value = false;
    // Pre-select newly created category for item form
    if (categories.value.length > 0) {
      itemForm.category_id = categories.value[categories.value.length - 1].id;
    }
  } catch (e) {
    alert(String(e));
  }
}

async function onDeleteCategory(id: number) {
  if (!confirm('Delete this category and all its items?')) return;
  try {
    await deleteCategory(id);
    await loadItems(); // refresh items after cascade delete
  } catch (e) {
    alert(String(e));
  }
}

// ── Item actions ──────────────────────────────────────────

async function onAddItem() {
  if (!itemForm.name || !itemForm.color || !itemForm.category_id) return;
  try {
    await createItem({ name: itemForm.name, color: itemForm.color, category_id: itemForm.category_id });
    itemForm.name = '';
    itemForm.color = '#3b82f6';
    showItemForm.value = false;
  } catch (e) {
    alert(String(e));
  }
}

async function onDeleteItem(id: number) {
  if (!confirm('Delete this item?')) return;
  try {
    await deleteItem(id);
  } catch (e) {
    alert(String(e));
  }
}
</script>
