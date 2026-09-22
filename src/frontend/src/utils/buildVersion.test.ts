import { describe, expect, it } from 'vitest'
import { buildFrontendVersion, normalizeBuildVersion } from './buildVersion.js'

describe('buildFrontendVersion', () => {
  it('derives exported metadata from Vite environment inputs', () => {
    expect(buildFrontendVersion({
      VITE_APP_VERSION: '2.0.0',
      VITE_COMMIT_HASH: 'def5678',
    })).toEqual({
      version: '2.0.0',
      commit: 'def5678',
    })
  })
})

describe('normalizeBuildVersion', () => {
  it('uses the supplied application version and commit hash', () => {
    expect(normalizeBuildVersion({
      version: '1.2.3',
      commit: 'abc1234',
    })).toEqual({
      version: '1.2.3',
      commit: 'abc1234',
    })
  })

  it('defaults unset and blank values to unknown', () => {
    expect(normalizeBuildVersion({
      version: '  ',
      commit: undefined,
    })).toEqual({
      version: 'unknown',
      commit: 'unknown',
    })
  })
})
