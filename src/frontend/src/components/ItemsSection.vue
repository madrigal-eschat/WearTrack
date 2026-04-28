<template>
  <div>
    <FormSectionHeader
      title="Items"
      :isOpen="showItemForm"
      :showToggle="categories.length > 0"
      @toggle="showItemForm = !showItemForm"
    />

    <div v-if="showItemForm && categories.length > 0" class="px-4 pb-2 space-y-3">
      <TextField id="item-name" label="Name" v-model="itemForm.name" />
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1">Color</label>
        <ColorPicker v-model="itemForm.color" />
      </div>
      <SelectField
        id="item-category"
        label="Category"
        :modelValue="itemForm.category_id"
        @update:modelValue="itemForm.category_id = $event"
      >
        <option value="" disabled>Select…</option>
        <option v-for="cat in categories" :key="cat.id" :value="String(cat.id)">{{ cat.name }}</option>
      </SelectField>
      <k-button
        type="button"
        @click="onAddItem"
        :disabled="!itemForm.name || !itemForm.category_id"
      >
        Add Item
      </k-button>
    </div>

    <template v-if="!loading">
      <div v-for="cat in categories" :key="cat.id">
        <div class="px-4 mt-4 mb-1 text-xs font-semibold text-gray-500 uppercase tracking-wide">
          {{ cat.name }}
        </div>
        <k-list inset>
          <k-list-item
            v-for="item in itemsForCategory(cat.id)"
            :key="item.id"
            :title="item.name"
          >
            <template #media>
              <ColorCircle :color="item.color" />
            </template>
            <template #after>
              <k-button small outline type="button" @click="onDeleteItem(item.id)">Delete</k-button>
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
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, watch, onMounted } from 'vue';
import { kList, kListItem, kButton } from 'konsta/vue';
import { useItems } from '../composables/useItems.js';
import { useCategories } from '../composables/useCategories.js';
import { useToast } from '../composables/useToast.js';
import { randomSwatchColor } from '../utils/colors.js';
import TextField from './TextField.vue';
import SelectField from './SelectField.vue';
import ColorPicker from './ColorPicker.vue';
import ColorCircle from './ColorCircle.vue';
import FormSectionHeader from './FormSectionHeader.vue';

const { loadItems, createItem, deleteItem, itemsForCategory } = useItems();
const { categories } = useCategories();
const { showError } = useToast();

const loading = ref(true);
const showItemForm = ref(false);

const itemForm = reactive({ name: '', color: randomSwatchColor(), category_id: '' });

onMounted(async () => {
  await loadItems();
  loading.value = false;
});

// Keep default category selection in sync when categories change.
// deep: true is needed because createCategory pushes to the array rather than replacing it.
watch(categories, (cats) => {
  if (cats.length > 0 && !itemForm.category_id) {
    itemForm.category_id = String(cats[cats.length - 1].id);
  }
}, { immediate: true, deep: true });

async function onAddItem() {
  if (!itemForm.name || !itemForm.color || !itemForm.category_id) return;
  try {
    await createItem({
      name: itemForm.name,
      color: itemForm.color,
      category_id: Number(itemForm.category_id),
    });
    itemForm.name = '';
    itemForm.color = randomSwatchColor();
    showItemForm.value = false;
  } catch (e) {
    showError(String(e));
  }
}

async function onDeleteItem(id: number) {
  if (!confirm('Delete this item?')) return;
  try {
    await deleteItem(id);
  } catch (e) {
    showError(String(e));
  }
}
</script>
