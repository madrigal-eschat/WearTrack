// src/backend/src/notifications/scheduler.ts
import type { CategorySchedulerState, DueNotification, NotificationType } from './types.js';

interface Candidate {
  type: NotificationType;
  fire_at: number;
  title: string;
  body: string;
  suppressed?: boolean;
}

export function computeDueNotifications(
  states: CategorySchedulerState[],
  alreadySent: Set<string>,
  now: number,
): DueNotification[] {
  const result: DueNotification[] = [];

  for (const { category_id, category_name, break_grace_time, previous, session } of states) {
    const tag = `category-${category_id}`;

    if (session !== null) {
      const { id: session_id, started_at, target_wear_seconds, max_wear_seconds } = session;
      const candidates: Candidate[] = [
        {
          type: 'target_met',
          fire_at: started_at + target_wear_seconds,
          title: `${category_name} target reached!`,
          body: 'You can stop when ready',
        },
      ];

      if (max_wear_seconds !== null) {
        const fire_30 = started_at + max_wear_seconds - 1800;
        const fire_5 = started_at + max_wear_seconds - 300;
        candidates.push(
          {
            type: 'overtime_warning_30',
            fire_at: fire_30,
            title: `${category_name}: 30 minutes left`,
            body: 'End your session before overtime',
            suppressed: fire_30 <= started_at + 300,
          },
          {
            type: 'overtime_warning_5',
            fire_at: fire_5,
            title: `Stop wearing ${category_name}`,
            body: '5 minutes until overtime',
            suppressed: fire_5 <= started_at + 300,
          },
          {
            type: 'overtime',
            fire_at: started_at + max_wear_seconds,
            title: `Stop wearing ${category_name} now!`,
            body: 'Your session is in overtime',
          },
        );
      }

      for (const c of candidates) {
        if (c.suppressed) continue;
        if (now < c.fire_at) continue;
        if (alreadySent.has(`${session_id}:${c.type}`)) continue;
        result.push({ session_id, category_id, type: c.type, title: c.title, body: c.body, tag });
      }
    } else if (previous !== null) {
      const { id: session_id, ended_at, rest_seconds } = previous;
      const rest_end = ended_at + rest_seconds;
      const decay_start = rest_end + break_grace_time;
      const halfway = Math.floor((rest_end + decay_start) / 2);
      const decay_soon_fire = decay_start - 3600;
      const decaySoonSuppressed =
        decay_soon_fire < rest_end + 3600 || Math.abs(decay_soon_fire - halfway) < 1800;

      const candidates: Candidate[] = [
        {
          type: 'rest_end',
          fire_at: rest_end,
          title: `${category_name} wearable`,
          body: 'Rest period is over',
        },
        {
          type: 'halfway',
          fire_at: halfway,
          title: `Wear ${category_name} soon`,
          body: 'Your idle time is halfway up',
        },
        {
          type: 'decay_soon',
          fire_at: decay_soon_fire,
          title: `Wear ${category_name} now!`,
          body: 'Durations start decaying in 1 hour',
          suppressed: decaySoonSuppressed,
        },
      ];

      for (const c of candidates) {
        if (c.suppressed) continue;
        if (now < c.fire_at) continue;
        if (alreadySent.has(`${session_id}:${c.type}`)) continue;
        result.push({ session_id, category_id, type: c.type, title: c.title, body: c.body, tag });
      }
    }
  }

  return result;
}
