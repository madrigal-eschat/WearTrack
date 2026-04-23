<template>
  <k-page style="padding-bottom: 56px">
    <k-navbar title="Items">
      <template #right>
        <k-link navbar @click="showAddForm = !showAddForm">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-5 h-5">
            <path fill-rule="evenodd" d="M12 3.75a.75.75 0 0 1 .75.75v6.75h6.75a.75.75 0 0 1 0 1.5h-6.75v6.75a.75.75 0 0 1-1.5 0v-6.75H4.5a.75.75 0 0 1 0-1.5h6.75V4.5a.75.75 0 0 1 .75-.75Z" clip-rule="evenodd" />
          </svg>
        </k-link>
      </template>
    </k-navbar>

    <!-- Add item form -->
    <div v-if="showAddForm">
      <k-block-title>New Item</k-block-title>
      <k-list inset>
        <k-list-input label="Name" type="text" :value="form.name" @input="form.name = ($event.target as HTMLInputElement).value" />
        <k-list-input label="Color (hex)" type="text" placeholder="#3b82f6" :value="form.color" @input="form.color = ($event.target as HTMLInputElement).value" />
        <k-list-item title="Category">
          <template #after>
            <select v-model="form.category_id" class="text-sm border rounded px-1 py-0.5">
              <option :value="null" disabled>Select…</option>
              <option v-for="cat in categories" :key="cat.id" :value="cat.id">{{ cat.name }}</option>
            </select>
          </template>
        </k-list-item>
      </k-list>
      <div class="px-4 pb-2 flex gap-2">
        <k-button @click="onAdd" :disabled="!form.name || !form.color || !form.category_id">Add</k-button>
        <k-button outline @click="showAddForm = false">Cancel</k-button>
      </div>
    </div>

    <!-- Items list -->
    <div v-if="loading" class="text-center py-8 text-gray-400">Loading…</div>
    <template v-else-if="categories.length === 0">
      <k-block>
        <p class="text-center text-gray-400">No categories yet. Add one from the Home screen (⚙).</p>
      </k-block>
    </template>
    <template v-else>
      <div v-for="cat in categories" :key="cat.id">
        <k-block-title>{{ cat.name }}</k-block-title>
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
              <k-button small outline @click="onDelete(item.id)">Delete</k-button>
            </template>
          </k-list-item>
          <k-list-item v-if="itemsForCategory(cat.id).length === 0" title="No items" class="text-gray-400" />
        </k-list>
      </div>
    </template>
  </k-page>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { kPage, kNavbar, kLink, kBlockTitle, kList, kListItem, kListInput, kButton, kBlock } from 'konsta/vue';
import { useItems } from '../composables/useItems.js';
import { useCategories } from '../composables/useCategories.js';
import type { Item } from '../composables/useWear.js';

const { items, loadItems, createItem, deleteItem } = useItems();
const { categories, loadCategories } = useCategories();

const loading = ref(true);
const showAddForm = ref(false);
const form = reactive<{ name: string; color: string; category_id: number | null }>({
  name: '',
  color: '#3b82f6',
  category_id: null,
});

onMounted(async () => {
  await Promise.all([loadCategories(), loadItems()]);
  loading.value = false;
  if (categories.value.length > 0) {
    form.category_id = categories.value[0].id;
  }
});

function itemsForCategory(categoryId: number): Item[] {
  return items.value.filter((i) => i.category_id === categoryId);
}

async function onAdd() {
  if (!form.name || !form.color || !form.category_id) return;
  try {
    await createItem({ name: form.name, color: form.color, category_id: form.category_id });
    form.name = '';
    form.color = '#3b82f6';
    showAddForm.value = false;
  } catch (e) {
    alert(String(e));
  }
}

async function onDelete(id: number) {
  if (!confirm('Delete this item?')) return;
  try {
    await deleteItem(id);
  } catch (e) {
    alert(String(e));
  }
}
</script>
