import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useMqtt } from './useMqtt.js'

function mockFetchOnce(body: unknown, ok = true) {
  global.fetch = vi.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  } as Response)
}

const DEFAULT_CONFIG = {
  enabled: false,
  host: null,
  port: 1883,
  username: null,
  hasPassword: false,
  topic_prefix: 'weartrack',
  ha_discovery_enabled: false,
  status: 'disconnected',
}

describe('useMqtt', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('init() loads config from GET /api/mqtt/config', async () => {
    mockFetchOnce(DEFAULT_CONFIG)
    const { config, init } = useMqtt()
    await init()
    expect(config.value).toEqual(DEFAULT_CONFIG)
    expect(global.fetch).toHaveBeenCalledWith('/api/mqtt/config', {
      redirect: 'manual',
    })
  })

  it(
    'save() PUTs the current config and updates state from the response',
    async () => {
      mockFetchOnce(DEFAULT_CONFIG)
      const { config, init, save } = useMqtt()
      await init()

      config.value.enabled = true
      config.value.host = 'broker.local'
      mockFetchOnce({
        ...DEFAULT_CONFIG,
        enabled: true,
        host: 'broker.local',
        status: 'connecting',
      })
      await save()

      expect(global.fetch).toHaveBeenLastCalledWith(
        '/api/mqtt/config',
        expect.objectContaining({
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          redirect: 'manual',
        }),
      )
      expect(config.value.status).toBe('connecting')
    },
  )

  it(
    'save() sends the password field only when the user typed one',
    async () => {
      mockFetchOnce(DEFAULT_CONFIG)
      const { init, save, password } = useMqtt()
      await init()

      password.value = 'my-secret'
      mockFetchOnce({ ...DEFAULT_CONFIG, hasPassword: true })
      await save()

      const [, requestInit] = vi.mocked(global.fetch).mock.calls[0]
      const body = requestInit as RequestInit
      const sentBody = JSON.parse(body.body as string)
      expect(sentBody.password).toBe('my-secret')
    },
  )
})
