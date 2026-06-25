export type NotificationType =
  | 'rest_end'
  | 'halfway'
  | 'decay_soon'
  | 'target_met'
  | 'overtime_warning_30'
  | 'overtime_warning_5'
  | 'overtime';

export interface CategorySchedulerState {
  category_id: number;
  category_name: string;
  break_grace_time: number;
  previous: { id: number; ended_at: number; rest_seconds: number } | null;
  session: {
    id: number;
    started_at: number;
    target_wear_seconds: number;
    max_wear_seconds: number | null;
  } | null;
}

export interface DueNotification {
  session_id: number;
  category_id: number;
  type: NotificationType;
  title: string;
  body: string;
  tag: string;
}
