import { Hono } from 'hono'
import { statsStore } from '../db/stores/stats-store.js'

export const router = new Hono()

// GET /api/leaderboards/longest-wear — items ranked by best single session
router.get('/longest-wear', (c) => {
  return c.json(statsStore.longestWear())
})

// GET /api/leaderboards/most-total-wear — items ranked by lifetime wear
router.get('/most-total-wear', (c) => {
  return c.json(statsStore.mostTotalWear())
})

// GET /api/leaderboards/best-streak — categories ranked by best wear streak
router.get('/best-streak', (c) => {
  return c.json(statsStore.bestStreak())
})

// GET /api/leaderboards/most-sessions — items ranked by session count
router.get('/most-sessions', (c) => {
  return c.json(statsStore.mostSessions())
})
