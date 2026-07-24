<template>
  <div>
    <FormSectionHeader
      title="Items"
      :isOpen="showItemForm"
      :showToggle="categories.length > 0"
      @toggle="
        showItemForm = !showItemForm;
        if (showItemForm) editingItemId = null;
      "
    />

    <ItemForm
      v-if="showItemForm && categories.length > 0"
      id-prefix="item"
      :categories="categories"
      submit-label="Add"
      show-placeholder-option
      @submit="onAddItem"
    />

    <template v-if="!loading">
      <div v-for="cat in categories" :key="cat.id">
        <div class="px-6 mt-4 mb-1">
          <SectionTitle variant="group">{{ cat.name }}</SectionTitle>
        </div>
        <k-list inset class="!my-2">
          <template v-for="item in itemsForCategory(cat.id)" :key="item.id">
            <k-list-item :title="item.name">
              <template #media>
                <Icon
                  v-if="cat.icon?.includes(':')"
                  :icon="cat.icon"
                  class="w-7 h-7"
                  :style="{ color: item.color }"
                />
                <span
                  v-else-if="cat.icon"
                  class="text-2xl"
                >{{ cat.icon }}</span>
                <ColorCircle v-else :color="item.color" />
              </template>
              <template #after>
                <div class="flex gap-1">
                  <k-button
                    small
                    outline
                    type="button"
                    @click="onToggleEdit(item)"
                  >Edit</k-button>
                  <DeleteButton
                    title="Delete item?"
                    message="This cannot be undone."
                    @confirm="onConfirmDeleteItem(item.id)"
                  >
                    <template #trigger="{ open }">
                      <k-button
                        small
                        outline
                        type="button"
                        @click="open"
                      >Delete</k-button>
                    </template>
                  </DeleteButton>
                </div>
              </template>
            </k-list-item>
            <ItemForm
              v-if="editingItemId === item.id"
              id-prefix="edit-item"
              :categories="categories"
              :initial-values="{
                name: item.name,
                color: item.color,
                category_id: String(item.category_id),
                difficulty_multiplier: item.difficulty_multiplier,
              }"
              submit-label="Save"
              show-cancel
              @submit="onSaveItem(item.id, $event)"
              @cancel="editingItemId = null"
            />
          </template>
          <k-list-item
            v-if="itemsForCategory(cat.id).length === 0"
            title="No items in this category"
            class="text-gray-400"
          />
        </k-list>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { Icon } from '@iconify/vue';
import { kList, kListItem, kButton } from 'konsta/vue';
import { useItems } from '../composables/useItems.js';
import type { Item } from '../composables/useWear.js';
import { useCategories } from '../composables/useCategories.js';
import { useToast } from '../composables/useToast.js';
import ColorCircle from './ColorCircle.vue';
import FormSectionHeader from './FormSectionHeader.vue';
import SectionTitle from './SectionTitle.vue';
import ItemForm from './ItemForm.vue';
import DeleteButton from './DeleteButton.vue';

const {
  loadItems,
  createItem,
  updateItem,
  deleteItem,
  itemsForCategory,
} = useItems();
const { categories } = useCategories();
const { showError } = useToast();

const loading = ref(true);
const showItemForm = ref(false);
const editingItemId = ref<number | null>(null);

onMounted(async () => {
  try {
    await loadItems();
  } finally {
    loading.value = false;
  }
});

function onToggleEdit(item: Item) {
  editingItemId.value = editingItemId.value === item.id ? null : item.id;
  if (editingItemId.value !== null) {
    showItemForm.value = false;
  }
}

interface ItemFormData {
  name: string;
  color: string;
  category_id: number;
  difficulty_multiplier: number;
}

async function onAddItem(data: ItemFormData) {
  try {
    await createItem(data);
    showItemForm.value = false;
  } catch (e) {
    showError(String(e));
  }
}

async function onSaveItem(id: number, data: ItemFormData) {
  try {
    await updateItem(id, data);
    editingItemId.value = null;
  } catch (e) {
    showError(String(e));
  }
}

async function onConfirmDeleteItem(id: number) {
  try {
    await deleteItem(id);
  } catch (e) {
    showError(String(e));
  }
}
</script>
