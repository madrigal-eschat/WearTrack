// src/backend/scripts/seed-example-data.ts
// One-shot script: seeds a running dev server (http://localhost:3000) with
// realistic example data for README screenshots. Run against a freshly
// reset database — POST /api/__reset first if re-running.
const BASE = 'http://localhost:3000';
const now = Math.floor(Date.now() / 1000);
const DAY = 86400;
const HOUR = 3600;

async function post(path: string, body: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function endSession(id: number, endedAt: number) {
  return post(`/api/sessions/${id}/end`, { ended_at: endedAt });
}

async function startSession(itemId: number, startedAt: number) {
  return post('/api/sessions/start', { item_id: itemId, started_at: startedAt });
}

async function main() {
  // --- Footwear: max set, active session, some history ---
  const footwear = await post('/api/categories', {
    name: 'Footwear',
    icon: 'ph:sneaker',
    initial_target_wear_duration_seconds: 3 * HOUR,
    initial_max_wear_duration_seconds: 6 * HOUR,
    rest_multiplier: 1,
    minimum_rest: 4 * HOUR,
    risk_levels: [
      { lower: null, upper: 6 * HOUR, text: 'Safe', severity: 1 },
      { lower: 6 * HOUR, upper: null, text: 'High', severity: 2 },
    ],
    break_decay_multiplier: 0.9,
    break_grace_time: 3 * DAY,
  });
  const trailRunners = await post('/api/items', {
    name: 'Trail Runners', category_id: footwear.id, color: '#3b82f6',
  });
  for (const daysAgo of [21, 14, 7]) {
    const start = now - daysAgo * DAY;
    const s = await startSession(trailRunners.id, start);
    await endSession(s.id, start + 2 * HOUR);
  }
  await startSession(trailRunners.id, now - 45 * 60); // active 45 min

  // --- Orthodontics: null max, active session past several laps ---
  const ortho = await post('/api/categories', {
    name: 'Orthodontics',
    icon: 'ph:tooth',
    initial_target_wear_duration_seconds: 30 * 60,
    initial_max_wear_duration_seconds: null,
    rest_multiplier: 0.5,
    minimum_rest: 0,
    risk_levels: [{ lower: null, upper: null, text: 'Low', severity: 1 }],
    break_decay_multiplier: 0.95,
    break_grace_time: 2 * DAY,
  });
  const nightGuard = await post('/api/items', {
    name: 'Night Guard', category_id: ortho.id, color: '#f97316',
  });
  for (const daysAgo of [10, 4] as const) {
    const start = now - daysAgo * DAY;
    const s = await startSession(nightGuard.id, start);
    await endSession(s.id, start + 45 * 60);
  }
  await startSession(nightGuard.id, now - 7 * HOUR); // several laps past a ~30min-ish target (tier 3+)

  // --- Retainer: streak of 3, now decaying, idle (no active session) ---
  const retainer = await post('/api/categories', {
    name: 'Retainer',
    icon: 'ph:circle-dashed',
    initial_target_wear_duration_seconds: 8 * HOUR,
    initial_max_wear_duration_seconds: 10 * HOUR,
    rest_multiplier: 1,
    minimum_rest: 30 * 60,
    risk_levels: [{ lower: null, upper: null, text: 'Low', severity: 1 }],
    break_decay_multiplier: 0.85,
    break_grace_time: 1 * DAY,
  });
  const upperRetainer = await post('/api/items', {
    name: 'Upper Retainer', category_id: retainer.id, color: '#22c55e',
  });
  // Three consecutive sessions, each starting well within rest+grace of the
  // previous one ending, most recent ended long enough ago (past rest+grace,
  // within a few decay-multiplier days) to be "decaying" but not fully.
  let prevEnd = now - 4.5 * DAY;
  for (let i = 0; i < 3; i++) {
    const start = prevEnd + 10 * 60; // 10 min after previous ended — well within rest+grace
    const s = await startSession(upperRetainer.id, i === 0 ? prevEnd - 8 * HOUR : start);
    const end = i === 0 ? prevEnd : start + 8 * HOUR;
    await endSession(s.id, end);
    prevEnd = end;
  }

  console.log('Seed complete:', { footwear: footwear.id, ortho: ortho.id, retainer: retainer.id });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
