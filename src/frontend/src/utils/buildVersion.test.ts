import { describe, expect, it } from 'vitest'
import { normalizeBuildVersion } from './buildVersion.js'

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
