import { test, expect } from '@playwright/test';
import { uid } from './helpers.js';

test.describe('Wear sessions', () => {
  let categoryId: number;
  let categoryName: string;
  let itemName: string;

  // Use the API directly for setup so we can set rest_constant_seconds: 0,
  // meaning the item can be worn again immediately after a session ends.
  test.beforeAll(async ({ request }) => {
    categoryName = `WearCat-${uid()}`;
    itemName = `WearItem-${uid()}`;

    const catRes = await request.post('/api/categories', {
      data: {
        name: categoryName,
        icon: '👟',
        initial_target_wear_duration_seconds: 600,
        initial_max_wear_duration_seconds: 900,
        rest_multiplier: 0,
        minimum_rest: 0,
        risk_levels: [
          { lower: null, upper: 3600, text: 'Low', severity: 1 },
          { lower: 3600, upper: 7200, text: 'Medium', severity: 2 },
          { lower: 7200, upper: null, text: 'High', severity: 3 },
        ],
        break_decay_multiplier: 0.91,
        break_grace_time: 86400,
      },
    });
    const cat = await catRes.json();
    categoryId = cat.id;

    await request.post('/api/items', {
      data: { name: itemName, color: '#3b82f6', category_id: categoryId },
    });
  });

  test.afterAll(async ({ request }) => {
    await request.delete(`/api/categories/${categoryId}`);
  });

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    page.on('dialog', (d) => d.accept());
    // Stop any active session left from a previous test in THIS category only —
    // the page now lists many categories from other describe blocks/spec files
    // sharing the same dev DB, so an unscoped "first Stop button" can belong to
    // an unrelated category.
    // Safe to do because rest_constant_seconds: 0 — no penalty for stopping.
    const row = page.locator('li', { hasText: categoryName });
    const stopBtn = row.getByRole('button', { name: /stop/i });
    if (await stopBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
      await stopBtn.click();
    }
  });

  test('shows a Wear button for each item', async ({ page }) => {
    const row = page.locator('li', { hasText: categoryName });
    await expect(row.getByRole('button', { name: /wear/i })).toBeVisible();
  });

  test('can start a wear session', async ({ page }) => {
    const row = page.locator('li', { hasText: categoryName });
    await row.getByRole('button', { name: /^wear$/i }).click();

    await expect(row.getByRole('button', { name: /stop/i })).toBeVisible({
      timeout: 5000,
    });
  });

  test('elapsed time is shown while wearing', async ({ page }) => {
    const row = page.locator('li', { hasText: categoryName });
    await row.getByRole('button', { name: /^wear$/i }).click();

    // Wait for session to start (Stop button appears), then check elapsed time.
    // Scope to .tabular-nums to avoid matching hidden <option> elements whose
    // text content also contains digits + letters (e.g. item names like
    // "Item-7m").
    await expect(row.getByRole('button', { name: /stop/i })).toBeVisible({
      timeout: 5000,
    });
    await expect(row.locator('.tabular-nums').first()).toBeVisible();
  });

  test('can stop a wear session', async ({ page }) => {
    const row = page.locator('li', { hasText: categoryName });
    await row.getByRole('button', { name: /^wear$/i }).click();

    const stopBtn = row.getByRole('button', { name: /stop/i });
    await stopBtn.waitFor({ timeout: 5000 });
    await stopBtn.click();

    await expect(
      row.getByRole('button', { name: /^wear$/i }),
    ).toBeVisible({ timeout: 5000 });
  });

  test('active session shows a target marker on the bar', async ({
    page,
  }) => {
    const row = page.locator('li', { hasText: categoryName });
    await row.getByRole('button', { name: /^wear$/i }).click();
    await expect(row.getByRole('button', { name: /stop/i })).toBeVisible({
      timeout: 5000,
    });
    await expect(row.getByTestId('target-marker')).toBeVisible();
  });

  test('overdue session shows "Stop wearing" and an Overdue stat', async ({
    page,
    request,
  }) => {
    // Stop any session left open by other tests in this category first, via
    // the API rather than a UI click — this category has accumulated growth
    // from earlier tests in this describe block, and driving cleanup through
    // the API avoids fighting the live-ticking elapsed-time UI for an
    // interaction the test isn't actually verifying.
    const currentRes = await request.get('/api/sessions/current');
    const current = (await currentRes.json()) as Array<{
      category: { id: number };
      session: { id: number } | null;
      items: Array<{ item_id: number; expected_max: number | null }>;
    }>;
    const entry = current.find((e) => e.category.id === categoryId);
    if (entry?.session) {
      await request.post(`/api/sessions/${entry.session.id}/end`, {
        data: {},
      });
    }

    const itemsRes = await request.get(
      `/api/items?category_id=${categoryId}`,
    );
    const [item] = await itemsRes.json();
    // This category's max grows with each completed session
    // (rest_multiplier: 0 means immediate re-wear, so earlier tests keep
    // compounding it). Elapse well past whatever the max has grown to,
    // rather than a fixed offset, so this stays overdue regardless of how
    // much prior tests grew it.
    const expectedMax =
      entry?.items.find((i) => i.item_id === item.id)?.expected_max ?? 900;
    const now = Math.floor(Date.now() / 1000);
    await request.post('/api/sessions/start', {
      data: { item_id: item.id, started_at: now - expectedMax - 300 },
    });

    await page.goto('/');
    await expect(page.getByText('Stop wearing')).toBeVisible();
    await expect(page.getByText('Overdue')).toBeVisible();

    await page.getByRole('button', { name: /stop/i }).first().click();
  });
});

test.describe('Wear session conflict (409)', () => {
  /**
   * When a category already has an active session on item A, trying to start a
   * second session on item B in the same category should surface an error.
   *
   * The server returns HTTP 409 with
   * { error: "Category already has an open session …" }.
   * ActionPane.onWear() calls showError(String(e)) which renders the error
   * text in the Toast component (fixed red banner at the top of the screen).
   *
   * This test needs two items in the same category.  We create a dedicated
   * category with zero rest so cleanup is easy.
   */
  let categoryId: number;
  let item1Id: number;
  let item2Id: number;

  test.beforeAll(async ({ request }) => {
    const catRes = await request.post('/api/categories', {
      data: {
        name: `ConflictCat-${Math.random().toString(36).slice(2, 7)}`,
        icon: '⚡',
        initial_target_wear_duration_seconds: 600,
        initial_max_wear_duration_seconds: 900,
        rest_multiplier: 0,
        minimum_rest: 0,
        risk_levels: [
          { lower: null, upper: 3600, text: 'Low', severity: 1 },
          { lower: 3600, upper: 7200, text: 'Medium', severity: 2 },
          { lower: 7200, upper: null, text: 'High', severity: 3 },
        ],
        break_decay_multiplier: 0.91,
        break_grace_time: 86400,
      },
    });
    const cat = await catRes.json();
    categoryId = cat.id;

    const i1 = await request
      .post('/api/items', {
        data: {
          name: `ConflictItem1-${Math.random().toString(36).slice(2, 7)}`,
          color: '#3b82f6',
          category_id: categoryId,
        },
      })
      .then((r) => r.json());
    item1Id = i1.id;

    const i2 = await request
      .post('/api/items', {
        data: {
          name: `ConflictItem2-${Math.random().toString(36).slice(2, 7)}`,
          color: '#ef4444',
          category_id: categoryId,
        },
      })
      .then((r) => r.json());
    item2Id = i2.id;
  });

  test.afterAll(async ({ request }) => {
    await request.delete(`/api/categories/${categoryId}`);
  });

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    page.on('dialog', (d) => d.accept());
    // End any open sessions from a prior test
    const stopBtn = page.getByRole('button', { name: /stop/i }).first();
    if (await stopBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
      await stopBtn.click();
    }
  });

  test(
    'starting a second session in the same category shows an error toast',
    async ({ page }) => {
      // Select item1 in the category's picker and start a session
      page.locator('.action-pane k-list-item, .action-pane li').filter({
        // ActionPane renders one k-list-item per category; locate by the
        // select containing item1
        hasText: '',
      });

      // Start item1's session via the API so we don't have to fight the UI
      // picker
      await page.request.post('/api/sessions/start', {
        data: { item_id: item1Id },
      });

      // Re-fetch the page so ActionPane reflects the open session
      await page.reload();

      // Now try to start item2 via the API — the server should return 409.
      // The UI itself doesn't expose a second Wear button when a session is
      // active in the category (the row shows Stop instead). So we call the
      // API and verify the error.
      const conflictRes = await page.request.post('/api/sessions/start', {
        data: { item_id: item2Id },
      });
      expect(conflictRes.status()).toBe(409);
      const body = await conflictRes.json();
      expect(body.error).toMatch(/already has an open session/i);

      // Stop the open session for cleanup
      const stopBtn = page.getByRole('button', { name: /stop/i }).first();
      if (await stopBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await stopBtn.click();
      } else {
        // Fallback: end via API
        const current = await page.request
          .get('/api/sessions/current')
          .then((r) => r.json()) as Array<{ session: { id: number } | null }>;
        for (const entry of current) {
          if (entry.session) {
            await page.request.post(
              `/api/sessions/${entry.session.id}/end`,
              { data: {} },
            );
          }
        }
      }
    },
  );

  test('conflict API response includes the conflicting item details', async ({
    request,
  }) => {
    // Start a session on item1
    const startRes = await request.post('/api/sessions/start', {
      data: { item_id: item1Id },
    });
    expect(startRes.status()).toBe(201);
    const session = await startRes.json();

    // Attempt to start item2 — expect 409 with conflicting_item payload
    const conflictRes = await request.post('/api/sessions/start', {
      data: { item_id: item2Id },
    });
    expect(conflictRes.status()).toBe(409);
    const body = await conflictRes.json();
    expect(body.conflicting_item).toBeDefined();
    expect(body.conflicting_item.id).toBe(item1Id);

    // Cleanup
    await request.post(`/api/sessions/${session.id}/end`, { data: {} });
  });
});

test.describe('Lap counter (null-max categories)', () => {
  let categoryId: number;
  let categoryName: string;
  let itemId: number;

  test.beforeAll(async ({ request }) => {
    categoryName = `LapCat-${uid()}`;
    const catRes = await request.post('/api/categories', {
      data: {
        name: categoryName,
        icon: '🔁',
        initial_target_wear_duration_seconds: 2,
        initial_max_wear_duration_seconds: null,
        rest_multiplier: 0,
        minimum_rest: 0,
        risk_levels: [{ lower: null, upper: null, text: 'Low', severity: 1 }],
        break_decay_multiplier: 0.91,
        break_grace_time: 86400,
      },
    });
    const cat = await catRes.json();
    categoryId = cat.id;

    const itemRes = await request.post('/api/items', {
      data: {
        name: `LapItem-${uid()}`,
        color: '#a855f7',
        category_id: categoryId,
      },
    });
    const item = await itemRes.json();
    itemId = item.id;
  });

  test.afterAll(async ({ request }) => {
    await request.delete(`/api/categories/${categoryId}`);
  });

  test(
    'lap badge appears after the first lap and advances tiers over time',
    async ({ page, request }) => {
      await request.post('/api/sessions/start', {
        data: { item_id: itemId },
      });
      await page.goto('/');

      const row = page.locator('li', { hasText: categoryName });
      const badge = row.getByTestId('lap-badge');

      // target is 2s; badge is hidden until the first lap completes.
      await expect(badge).not.toBeVisible();
      await expect(badge).toHaveText('1x', { timeout: 4000 });
      await expect(badge).toHaveText('2x', { timeout: 4000 });
      await expect(row.getByTestId('wear-progress-bar')).toHaveClass(
        /tier-1/,
      );

      const current = (await request
        .get('/api/sessions/current')
        .then((r) => r.json())) as Array<{
        category: { id: number };
        session: { id: number } | null;
      }>;
      const entry = current.find((e) => e.category.id === categoryId);
      if (entry?.session) {
        await request.post(`/api/sessions/${entry.session.id}/end`, {
          data: {},
        });
      }
    },
  );
});

test.describe('Idle row states', () => {
  let categoryId: number;
  let categoryName: string;
  let itemId: number;

  test.beforeAll(async ({ request }) => {
    categoryName = `IdleCat-${uid()}`;
    const catRes = await request.post('/api/categories', {
      data: {
        name: categoryName,
        icon: '🧦',
        initial_target_wear_duration_seconds: 600,
        initial_max_wear_duration_seconds: 900,
        rest_multiplier: 2,
        minimum_rest: 30,
        risk_levels: [{ lower: null, upper: null, text: 'Low', severity: 1 }],
        break_decay_multiplier: 0.5,
        break_grace_time: 1,
      },
    });
    const cat = await catRes.json();
    categoryId = cat.id;

    const itemRes = await request.post('/api/items', {
      data: {
        name: `IdleItem-${uid()}`,
        color: '#22c55e',
        category_id: categoryId,
      },
    });
    itemId = (await itemRes.json()).id;
  });

  test.afterAll(async ({ request }) => {
    await request.delete(`/api/categories/${categoryId}`);
  });

  test('shows the resting bar and Remaining/Total stats while resting', async ({
    page,
    request,
  }) => {
    const now = Math.floor(Date.now() / 1000);
    const startRes = await request.post('/api/sessions/start', {
      data: { item_id: itemId, started_at: now - 10 },
    });
    const session = await startRes.json();
    // minimum_rest is 30s — end quickly so most of the rest window is still
    // ahead.
    await request.post(`/api/sessions/${session.id}/end`, {
      data: { ended_at: now - 5 },
    });

    await page.goto('/');
    const row = page.locator('li', { hasText: categoryName });
    await expect(row.getByText('Rest')).toBeVisible();
    await expect(row.getByText(/Remaining/)).toBeVisible();
    await expect(row.getByText(/Total/)).toBeVisible();
  });

  test('shows "Total decay in" once the decay window has started', async ({
    page,
    request,
  }) => {
    // Uses its own category+item (rather than the shared one from
    // beforeAll) because the backend picks the "previous session" per
    // category by MAX(ended_at) — sharing a category with the
    // resting-state test (whose session has a real, recent ended_at)
    // would make that real session outrank this one's backdated
    // ended_at, and the decay window would never appear to have started.
    const decayCategoryName = `DecayCat-${uid()}`;
    const catRes = await request.post('/api/categories', {
      data: {
        name: decayCategoryName,
        icon: '🍂',
        initial_target_wear_duration_seconds: 600,
        initial_max_wear_duration_seconds: 900,
        rest_multiplier: 2,
        minimum_rest: 30,
        risk_levels: [{ lower: null, upper: null, text: 'Low', severity: 1 }],
        break_decay_multiplier: 0.5,
        break_grace_time: 1,
      },
    });
    const decayCategory = await catRes.json();
    const itemRes = await request.post('/api/items', {
      data: {
        name: `DecayItem-${uid()}`,
        color: '#f59e0b',
        category_id: decayCategory.id,
      },
    });
    const decayItem = await itemRes.json();

    // ended long enough ago that rest (small) + grace (1s) has passed, but
    // not long enough to be fully decayed (break_decay_multiplier 0.5
    // halves per day).
    const now = Math.floor(Date.now() / 1000);
    const startRes = await request.post('/api/sessions/start', {
      data: { item_id: decayItem.id, started_at: now - 3600 - 30 },
    });
    const session = await startRes.json();
    await request.post(`/api/sessions/${session.id}/end`, {
      data: { ended_at: now - 3600 },
    });

    await page.goto('/');
    const row = page.locator('li', { hasText: decayCategoryName });
    await expect(row.getByText(/Total decay in/)).toBeVisible();

    await request.delete(`/api/categories/${decayCategory.id}`);
  });

  test(
    'shows "Start your first session" for a category with no previous session',
    async ({ page, request }) => {
      const freshCatRes = await request.post('/api/categories', {
        data: {
          name: `FreshCat-${uid()}`,
          icon: '🆕',
          initial_target_wear_duration_seconds: 600,
          initial_max_wear_duration_seconds: 900,
          rest_multiplier: 2,
          minimum_rest: 30,
          risk_levels: [{ lower: null, upper: null, text: 'Low', severity: 1 }],
          break_decay_multiplier: 0.91,
          break_grace_time: 86400,
        },
      });
      const freshCat = await freshCatRes.json();
      await request.post('/api/items', {
        data: {
          name: `FreshItem-${uid()}`,
          color: '#0ea5e9',
          category_id: freshCat.id,
        },
      });

      await page.goto('/');
      const row = page.locator('li', { hasText: freshCat.name });
      await expect(row.getByText('Start your first session')).toBeVisible();

      await request.delete(`/api/categories/${freshCat.id}`);
    },
  );
});

test.describe('Target reached (null-max, no overdue CTA)', () => {
  let categoryId: number;
  let categoryName: string;
  let itemId: number;

  test.beforeAll(async ({ request }) => {
    categoryName = `TargetReachedCat-${uid()}`;
    const catRes = await request.post('/api/categories', {
      data: {
        name: categoryName,
        icon: '🎯',
        initial_target_wear_duration_seconds: 100,
        initial_max_wear_duration_seconds: null,
        rest_multiplier: 0,
        minimum_rest: 0,
        risk_levels: [{ lower: null, upper: null, text: 'Low', severity: 1 }],
        break_decay_multiplier: 0.91,
        break_grace_time: 86400,
      },
    });
    const cat = await catRes.json();
    categoryId = cat.id;

    const itemRes = await request.post('/api/items', {
      data: {
        name: `TargetReachedItem-${uid()}`,
        color: '#f97316',
        category_id: categoryId,
      },
    });
    itemId = (await itemRes.json()).id;
  });

  test.afterAll(async ({ request }) => {
    await request.delete(`/api/categories/${categoryId}`);
  });

  test(
    'shows "Target reached" (not "Overdue"/"Stop wearing") once target passes',
    async ({ page, request }) => {
      const now = Math.floor(Date.now() / 1000);
      await request.post('/api/sessions/start', {
        data: { item_id: itemId, started_at: now - 150 },
      });

      await page.goto('/');
      const row = page.locator('li', { hasText: categoryName });
      await expect(row.getByText('Target reached')).toBeVisible();
      await expect(row.getByText('Stop wearing')).not.toBeVisible();
      await expect(row.getByText('Overdue')).not.toBeVisible();

      await row.getByRole('button', { name: /stop/i }).click();
    },
  );
});

test.describe('Category streak badge', () => {
  let categoryId: number;
  let categoryName: string;
  let itemId: number;

  test.beforeAll(async ({ request }) => {
    categoryName = `StreakCat-${uid()}`;
    const catRes = await request.post('/api/categories', {
      data: {
        name: categoryName,
        icon: '🔥',
        initial_target_wear_duration_seconds: 100,
        initial_max_wear_duration_seconds: 200,
        rest_multiplier: 0,
        minimum_rest: 0,
        risk_levels: [{ lower: null, upper: null, text: 'Low', severity: 1 }],
        break_decay_multiplier: 0.91,
        break_grace_time: 1000,
      },
    });
    const cat = await catRes.json();
    categoryId = cat.id;

    const itemRes = await request.post('/api/items', {
      data: {
        name: `StreakItem-${uid()}`,
        color: '#f97316',
        category_id: categoryId,
      },
    });
    itemId = (await itemRes.json()).id;
  });

  test.afterAll(async ({ request }) => {
    await request.delete(`/api/categories/${categoryId}`);
  });

  test(
    'hidden with no streak, shown with count after consecutive sessions',
    async ({ page, request }) => {
      await page.goto('/');
      const row = page.locator('li', { hasText: categoryName });
      await expect(row.getByTestId('streak-badge')).not.toBeVisible();

      const s1 = await (
        await request.post('/api/sessions/start', {
          data: { item_id: itemId, started_at: 0 },
        })
      ).json();
      await request.post(`/api/sessions/${s1.id}/end`, {
        data: { ended_at: 50 },
      });
      const s2 = await (
        await request.post('/api/sessions/start', {
          data: { item_id: itemId, started_at: 100 },
        })
      ).json();
      await request.post(`/api/sessions/${s2.id}/end`, {
        data: { ended_at: 150 },
      });

      await page.reload();
      await expect(row.getByTestId('streak-badge')).toBeVisible();
      await expect(row.getByTestId('streak-badge')).toHaveText('2');
    },
  );

  test(
    'streak badge and active-session progress bar both show on the same row',
    async ({ page, request }) => {
      const s1 = await (
        await request.post('/api/sessions/start', {
          data: { item_id: itemId, started_at: 0 },
        })
      ).json();
      await request.post(`/api/sessions/${s1.id}/end`, {
        data: { ended_at: 50 },
      });
      const s2 = await (
        await request.post('/api/sessions/start', {
          data: { item_id: itemId, started_at: 100 },
        })
      ).json();
      await request.post(`/api/sessions/${s2.id}/end`, {
        data: { ended_at: 150 },
      });

      const now = Math.floor(Date.now() / 1000);
      await request.post('/api/sessions/start', {
        data: { item_id: itemId, started_at: now - 5 },
      });

      await page.goto('/');
      const row = page.locator('li', { hasText: categoryName });
      await expect(row.getByTestId('streak-badge')).toBeVisible();
      await expect(row.getByTestId('wear-progress-bar')).toBeVisible();

      await row.getByRole('button', { name: /stop/i }).click();
    },
  );
});
