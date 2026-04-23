import { ref } from 'vue';

export type LeaderboardType = 'longest-wear' | 'most-total-wear' | 'best-streak' | 'most-sessions';

export interface LeaderboardEntry {
  [key: string]: unknown;
}

export const LEADERBOARD_TYPES: { value: LeaderboardType; label: string }[] = [
  { value: 'longest-wear', label: 'Longest Wear' },
  { value: 'most-total-wear', label: 'Most Total Wear' },
  { value: 'best-streak', label: 'Best Streak' },
  { value: 'most-sessions', label: 'Most Sessions' },
];

const leaderboard = ref<LeaderboardEntry[]>([]);
const activeType = ref<LeaderboardType>('longest-wear');
const loading = ref(false);

async function loadLeaderboard(type: LeaderboardType): Promise<void> {
  loading.value = true;
  try {
    const res = await fetch(`/api/leaderboards/${type}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
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
