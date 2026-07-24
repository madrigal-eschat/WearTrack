import { ref } from 'vue';
import { formatDuration } from '../utils/formatDuration.js';
import { apiFetch } from '../utils/apiFetch.js';

export interface LeaderboardEntry {
  [key: string]: unknown;
}

export const LEADERBOARD_TYPES = [
  {
    value: 'longest-wear' as const,
    label: 'Longest Wear',
    badge: (entry: Record<string, unknown>) =>
      formatDuration((entry.max_single_session_wear_seconds ?? 0) as number),
  },
  {
    value: 'most-total-wear' as const,
    label: 'Most Total Wear',
    badge: (entry: Record<string, unknown>) =>
      formatDuration((entry.total_wear_seconds ?? 0) as number),
  },
  {
    value: 'best-streak' as const,
    label: 'Longest Streak',
    badge: (entry: Record<string, unknown>) =>
      `${entry.streak_sessions ?? 0} sessions`,
  },
  {
    value: 'most-sessions' as const,
    label: 'Most Sessions',
    badge: (entry: Record<string, unknown>) =>
      `${entry.session_count ?? 0} sessions`,
  },
] as const;

export type LeaderboardType = typeof LEADERBOARD_TYPES[number]['value'];

// Module-level state shared across all component instances
const leaderboard = ref<LeaderboardEntry[]>([]);
const activeType = ref<LeaderboardType>('longest-wear');
const loading = ref(false);

async function loadLeaderboard(type: LeaderboardType): Promise<void> {
  loading.value = true;
  try {
    const res = await apiFetch(`/api/leaderboards/${type}`);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    leaderboard.value = await res.json();
    activeType.value = type;
  } finally {
    loading.value = false;
  }
}

export function useStats() {
  return {
    leaderboard,
    activeType,
    loading,
    loadLeaderboard,
    LEADERBOARD_TYPES,
  };
}
