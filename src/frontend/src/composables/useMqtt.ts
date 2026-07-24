import { ref } from 'vue';
import { apiFetch } from '../utils/apiFetch.js';

export interface MqttConfigState {
  enabled: boolean;
  host: string | null;
  port: number;
  username: string | null;
  hasPassword: boolean;
  topic_prefix: string;
  ha_discovery_enabled: boolean;
  status: 'disconnected' | 'connecting' | 'connected' | 'error';
}

const DEFAULT_CONFIG: MqttConfigState = {
  enabled: false,
  host: null,
  port: 1883,
  username: null,
  hasPassword: false,
  topic_prefix: 'weartrack',
  ha_discovery_enabled: false,
  status: 'disconnected',
};

export function useMqtt() {
  const config = ref<MqttConfigState>({ ...DEFAULT_CONFIG });
  const password = ref('');
  const loading = ref(false);

  async function init(): Promise<void> {
    loading.value = true;
    try {
      const res = await apiFetch('/api/mqtt/config');
      if (res.ok) {
        config.value = (await res.json()) as MqttConfigState;
      }
    } finally {
      loading.value = false;
    }
  }

  async function save(): Promise<void> {
    loading.value = true;
    try {
      const body: Record<string, unknown> = {
        enabled: config.value.enabled,
        host: config.value.host,
        port: config.value.port,
        username: config.value.username,
        topic_prefix: config.value.topic_prefix,
        ha_discovery_enabled: config.value.ha_discovery_enabled,
      };
      if (password.value !== '') {
        body.password = password.value;
      }

      const res = await apiFetch('/api/mqtt/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        config.value = (await res.json()) as MqttConfigState;
        password.value = '';
      }
    } finally {
      loading.value = false;
    }
  }

  return { config, password, loading, init, save };
}
