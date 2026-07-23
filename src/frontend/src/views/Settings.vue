<template>
  <k-page style="padding-bottom: 56px">
    <PageHeader title="Settings" showBack @back="router.push('/')" />
    <div class="px-4 py-4">
      <p class="text-sm text-gray-500 text-center">
        Manage categories and items from the <strong>Items</strong> tab.
      </p>

      <div class="mt-4">
        <p v-if="!isSupported" class="text-sm text-gray-400 text-center">
          Push notifications are not supported in this browser.
        </p>
        <p v-else-if="!isConfigured" class="text-sm text-amber-600 text-center">
          Push notifications are not configured on the server.
        </p>
        <k-list v-else>
          <k-list-item
            title="Push notifications"
            :after="isSubscribed ? 'On' : 'Off'"
          >
            <template #after>
              <k-toggle :checked="isSubscribed" @change="onToggle" />
            </template>
          </k-list-item>
        </k-list>
      </div>

      <div class="mt-6">
        <h2 class="text-sm font-semibold text-gray-700 px-1 mb-1">MQTT</h2>
        <FormCard>
          <div class="flex items-center justify-between">
            <span class="text-sm font-medium text-gray-700">Enable MQTT</span>
            <k-toggle
              :checked="mqttConfig.enabled"
              @change="mqttConfig.enabled = !mqttConfig.enabled"
            />
          </div>

          <TextField
            id="mqtt-host"
            label="Host"
            v-model="mqttHost"
            placeholder="broker.local"
          />
          <NumberField
            id="mqtt-port"
            label="Port"
            v-model="mqttConfig.port"
            :min="1"
            :max="65535"
            :default="1883"
          />
          <TextField
            id="mqtt-username"
            label="Username (optional)"
            v-model="mqttUsername"
          />
          <TextField
            id="mqtt-password"
            label="Password (optional)"
            type="password"
            v-model="mqttPassword"
          />
          <TextField
            id="mqtt-prefix"
            label="Topic prefix"
            v-model="mqttConfig.topic_prefix"
          />

          <div class="flex items-center justify-between">
            <span class="text-sm font-medium text-gray-700">
              Home Assistant discovery
            </span>
            <k-toggle
              :checked="mqttConfig.ha_discovery_enabled"
              @change="
                mqttConfig.ha_discovery_enabled =
                  !mqttConfig.ha_discovery_enabled
              "
            />
          </div>

          <p class="text-xs text-gray-400">
            Status: <span :class="statusColor">{{ mqttConfig.status }}</span>
          </p>

          <button
            type="button"
            data-testid="mqtt-save"
            class="
              px-4 py-2 rounded-lg text-sm font-medium bg-blue-500
              text-white
            "
            @click="onSaveMqtt"
          >Save</button>
        </FormCard>
      </div>
    </div>
  </k-page>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { kPage, kList, kListItem, kToggle } from 'konsta/vue';
import { useNotifications } from '../composables/useNotifications.js';
import { useMqtt } from '../composables/useMqtt.js';
import PageHeader from '../components/PageHeader.vue';
import FormCard from '../components/FormCard.vue';
import TextField from '../components/TextField.vue';
import NumberField from '../components/NumberField.vue';

const router = useRouter();
const {
  isSupported,
  isConfigured,
  isSubscribed,
  enable,
  disable,
} = useNotifications();
const {
  config: mqttConfig,
  password: mqttPassword,
  init: initMqtt,
  save: saveMqtt,
} = useMqtt();

void initMqtt();

const mqttHost = computed({
  get: () => mqttConfig.value.host ?? '',
  set: (v: string) => { mqttConfig.value.host = v === '' ? null : v; },
});
const mqttUsername = computed({
  get: () => mqttConfig.value.username ?? '',
  set: (v: string) => { mqttConfig.value.username = v === '' ? null : v; },
});

const statusColor = computed(() => ({
  'text-green-600': mqttConfig.value.status === 'connected',
  'text-red-600': mqttConfig.value.status === 'error',
  'text-gray-400':
    mqttConfig.value.status === 'disconnected' ||
    mqttConfig.value.status === 'connecting',
}));

async function onToggle() {
  if (isSubscribed.value) {
    await disable();
  } else {
    await enable();
  }
}

async function onSaveMqtt() {
  await saveMqtt();
}
</script>
