import { describe, expect, it } from 'vitest'
import { parseSetupStatus, setupNeedsPolling } from './setup-status'

function validStatus() {
  return {
    storage: {
      driver: 'falkordblite',
      dataPath: '/tmp/codegraph',
      ownerState: 'owned',
      embeddedSupported: true,
      externalGuidance: null,
      error: null,
    },
    embedding: {
      profile: { provider: 'local', model: 'local-model', dimension: 768 },
      keyPresent: false,
      localModelCached: false,
      modelLoad: null,
      migration: null,
    },
    projects: { configured: false, count: 0 },
    index: {
      state: 'not-configured',
      progress: null,
      embeddingPass: { running: false, scope: null, startedAt: null },
    },
  }
}

describe('setup status boundary', () => {
  it('accepts the frozen setup status contract without changing it', () => {
    const status = validStatus()
    expect(parseSetupStatus(status)).toEqual(status)
  })

  it('rejects malformed progress instead of displaying invented defaults', () => {
    expect(() => parseSetupStatus({
      ...validStatus(),
      index: {
        ...validStatus().index,
        state: 'indexing',
        progress: {
          id: 'job-1',
          phase: 'parsing',
          processed: '12',
          total: 24,
          startedAt: '2026-08-22T12:00:00.000Z',
        },
      },
    })).toThrow('invalid index progress')
  })

  it('polls only while model, index, or embedding work is active', () => {
    const idle = parseSetupStatus(validStatus())
    const indexing = parseSetupStatus({
      ...validStatus(),
      index: {
        ...validStatus().index,
        state: 'indexing',
        progress: {
          id: 'job-1',
          phase: 'writing',
          processed: 2,
          total: 5,
          startedAt: '2026-08-22T12:00:00.000Z',
        },
      },
    })

    expect(setupNeedsPolling(idle)).toBe(false)
    expect(setupNeedsPolling(indexing)).toBe(true)
  })
})
