import { ref, computed } from 'vue';
import type { Session } from './useWear.js';

export interface DayEntry {
  date: Date;
  label: string;       // "Mon", "Tue", etc.
  dayNum: number;      // day of month
  isToday: boolean;
  totalWearSeconds: number;
  sessionCount: number;
  sessions: Session[];
}

function startOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay(); // 0 = Sun
  const diff = (day === 0 ? -6 : 1) - day; // Monday-first
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

// Module-level state shared across all component instances
const weekStart = ref<Date>(startOfWeek(new Date()));
const sessions = ref<Session[]>([]);

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const weekDays = computed<DayEntry[]>(() => {
  const today = new Date();
  return DAY_LABELS.map((label, i) => {
    const date = new Date(weekStart.value);
    date.setDate(date.getDate() + i);
    const dayStart = Math.floor(date.getTime() / 1000);
    const dayEnd = dayStart + 86400;

    const daySessions = sessions.value.filter(
      (s) => s.started_at >= dayStart && s.started_at < dayEnd && s.ended_at !== null,
    );

    return {
      date,
      label,
      dayNum: date.getDate(),
      isToday: date.toDateString() === today.toDateString(),
      totalWearSeconds: daySessions.reduce((sum, s) => sum + ((s.ended_at ?? s.started_at) - s.started_at), 0),
      sessionCount: daySessions.length,
      sessions: daySessions,
    };
  });
});

async function loadWeekSessions(): Promise<void> {
  const from = Math.floor(weekStart.value.getTime() / 1000);
  const to = from + 7 * 86400;
  // Fetch all sessions; filter client-side (API has no date range filter)
  const res = await fetch('/api/sessions');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const all: Session[] = await res.json();
  sessions.value = all.filter((s) => s.started_at >= from && s.started_at < to);
}

function prevWeek(): void {
  const d = new Date(weekStart.value);
  d.setDate(d.getDate() - 7);
  weekStart.value = d;
  loadWeekSessions();
}

function nextWeek(): void {
  const d = new Date(weekStart.value);
  d.setDate(d.getDate() + 7);
  weekStart.value = d;
  loadWeekSessions();
}

function formatWeekRange(): string {
  const end = new Date(weekStart.value);
  end.setDate(end.getDate() + 6);
  const fmt = (d: Date) =>
    d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return `${fmt(weekStart.value)} – ${fmt(end)}`;
}

export function useCalendar() {
  return {
    weekStart,
    weekDays,
    loadWeekSessions,
    prevWeek,
    nextWeek,
    formatWeekRange,
  };
}
