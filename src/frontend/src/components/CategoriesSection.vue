<template>
  <div>
    <FormSectionHeader
      title="Categories"
      :isOpen="showCatForm"
      :showToggle="true"
      @toggle="showCatForm = !showCatForm"
    />

    <div v-if="showCatForm" class="px-4 pb-2 space-y-3">
      <TextField id="cat-name" label="Name" v-model="catForm.name" />
      <TextField id="cat-icon" label="Icon (emoji or symbol)" v-model="catForm.icon" placeholder="👟" />
      <k-button @click="onAddCategory" :disabled="!catForm.name || !catForm.icon">
        Add Category
      </k-button>
    </div>

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
            <k-button small outline type="button" @click="onDeleteCategory(cat.id)">Delete</k-button>
          </template>
        </k-list-item>
      </k-list>
      <k-block v-else>
        <p class="text-center text-gray-400 text-sm">No categories yet. Use "+ Add" above to create one.</p>
      </k-block>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { kList, kListItem, kButton, kBlock } from 'konsta/vue';
import { useCategories } from '../composables/useCategories.js';
import { useItems } from '../composables/useItems.js';
import { useToast } from '../composables/useToast.js';
import { DEFAULT_CATEGORY_FIELDS } from '../utils/categoryDefaults.js';
import TextField from './TextField.vue';
import FormSectionHeader from './FormSectionHeader.vue';

const { categories, loadCategories, createCategory, deleteCategory } = useCategories();
const { loadItems } = useItems();
const { showError } = useToast();

const loading = ref(true);
const showCatForm = ref(false);
const catForm = reactive({ name: '', icon: '' });

onMounted(async () => {
  await loadCategories();
  loading.value = false;
});

async function onAddCategory() {
  if (!catForm.name || !catForm.icon) return;
  try {
    await createCategory({ name: catForm.name, icon: catForm.icon, ...DEFAULT_CATEGORY_FIELDS });
    catForm.name = '';
    catForm.icon = '';
    showCatForm.value = false;
  } catch (e) {
    showError(String(e));
  }
}

async function onDeleteCategory(id: number) {
  if (!confirm('Delete this category and all its items?')) return;
  try {
    await deleteCategory(id);
  } catch (e) {
    showError(String(e));
    return;
  }
  // Refresh items silently after cascade delete; a stale list is not fatal.
  await loadItems().catch(() => {});
}
</script>
