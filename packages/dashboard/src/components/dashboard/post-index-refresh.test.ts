import { describe, expect, it } from 'vitest'
import * as appModule from '../../App'
import * as parseModule from './parse-project-dialog'
import * as projectModule from './project-selector'

describe('post-index project refresh', () => {
  it('turns a completed parse into a selector refresh for the returned project', () => {
    const reduce = Reflect.get(appModule, 'reduceProjectRefresh') as unknown
    expect(reduce).toBeTypeOf('function')
    if (typeof reduce !== 'function') return

    expect(reduce(
      { refreshKey: 2, requestedProjectId: null },
      { projectId: 'new-project', projectName: 'New Project' },
    )).toEqual({ refreshKey: 3, requestedProjectId: 'new-project' })
  })

  it('accepts only a successful parse payload with project identity', () => {
    const parseResult = Reflect.get(parseModule, 'parseSuccessfulProject') as unknown
    expect(parseResult).toBeTypeOf('function')
    if (typeof parseResult !== 'function') return

    expect(parseResult({
      success: true,
      projectId: 'new-project',
      projectName: 'New Project',
      stats: { files: 3, entities: 8, edges: 5, errors: 0, durationMs: 20 },
    })).toEqual({ projectId: 'new-project', projectName: 'New Project' })
    expect(() => parseResult({ success: true })).toThrow('Invalid parse response')
  })

  it('refetches the list and selects the newly indexed project', async () => {
    const refresh = Reflect.get(projectModule, 'refreshProjectSelection') as unknown
    expect(refresh).toBeTypeOf('function')
    if (typeof refresh !== 'function') return

    const fetcher = async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        projects: [
          { id: 'old-project', name: 'Old Project', rootPath: '/old' },
          { id: 'new-project', name: 'New Project', rootPath: '/new' },
        ],
      }),
    })

    await expect(refresh(fetcher, {
      requestedProjectId: 'new-project',
      currentProjectId: 'old-project',
      urlProjectId: 'old-project',
      storedProjectId: 'old-project',
    })).resolves.toMatchObject({
      state: { status: 'success' },
      project: { id: 'new-project', name: 'New Project' },
    })
  })
})
