<template>
  <div>
    <FormSectionHeader
      title="Categories"
      :isOpen="showCatForm"
      :showToggle="true"
      @toggle="onToggleAddForm"
    />

    <CategoryForm
      v-if="showCatForm"
      submitLabel="Add"
      @submit="onAddCategory"
      @cancel="showCatForm = false"
    />

    <div v-if="loading" class="text-center py-4 text-gray-400">Loading…</div>
    <template v-else>
      <k-list v-if="categories.length > 0" inset class="!my-2">
        <template v-for="cat in categories" :key="cat.id">
          <k-list-item :title="cat.name">
            <template #media>
              <Icon v-if="cat.icon?.includes(':')" :icon="cat.icon" class="text-2xl w-8 h-8" />
              <span v-else class="text-2xl">{{ cat.icon }}</span>
            </template>
            <template #after>
              <div class="flex gap-1">
                <k-button small outline type="button" @click="onToggleEdit(cat.id)">Edit</k-button>
                <k-button small outline type="button" @click="onDeleteCategory(cat.id)">Delete</k-button>
              </div>
            </template>
          </k-list-item>
          <CategoryForm
            v-if="editingCategoryId === cat.id"
            :initialValues="categoryToFormState(cat)"
            submitLabel="Save"
            @submit="onSaveCategory(cat.id, $event)"
            @cancel="editingCategoryId = null"
          />
        </template>
      </k-list>
      <k-block v-else>
        <p class="text-center text-gray-400 text-sm">No categories yet. Use "+ Add" above to create one.</p>
      </k-block>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { Icon } from '@iconify/vue';
import { kList, kListItem, kButton, kBlock } from 'konsta/vue';
import { useCategories } from '../composables/useCategories.js';
import { useItems } from '../composables/useItems.js';
import { useToast } from '../composables/useToast.js';
import { categoryToFormState, formStateToApiPayload } from '../utils/categoryForm.js';
import type { CategoryFormState } from './CategoryForm.vue';
import FormSectionHeader from './FormSectionHeader.vue';
import CategoryForm from './CategoryForm.vue';

const { categories, loadCategories, createCategory, updateCategory, deleteCategory } = useCategories();
const { loadItems } = useItems();
const { showError } = useToast();

const loading = ref(true);
const showCatForm = ref(false);
const editingCategoryId = ref<number | null>(null);

onMounted(async () => {
  try {
    await loadCategories();
  } finally {
    loading.value = false;
  }
});


function onToggleAddForm() {
  showCatForm.value = !showCatForm.value;
  if (showCatForm.value) editingCategoryId.value = null;
}

function onToggleEdit(id: number) {
  if (editingCategoryId.value === id) {
    editingCategoryId.value = null;
  } else {
    editingCategoryId.value = id;
    showCatForm.value = false;
  }
}

async function onAddCategory(data: CategoryFormState) {
  try {
    await createCategory(formStateToApiPayload(data));
    showCatForm.value = false;
  } catch (e) {
    showError(String(e));
  }
}

async function onSaveCategory(id: number, data: CategoryFormState) {
  try {
    await updateCategory(id, formStateToApiPayload(data));
    editingCategoryId.value = null;
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
  await loadItems().catch(() => {});
}
</script>
