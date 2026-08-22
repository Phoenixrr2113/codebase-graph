import { describe, expect, it, vi } from 'vitest'
import * as projectModule from './project-selector'

interface Project {
  id: string
  name: string
  rootPath: string | null
}

const projects: Project[] = [
  { id: 'alpha', name: 'Alpha', rootPath: '/alpha' },
  { id: 'beta', name: 'Beta', rootPath: '/beta' },
]

function selectionExports() {
  const module = projectModule as unknown as {
    resolveProjectSelection?: (
      projects: Project[],
      candidates: {
        requestedProjectId?: string | null
        currentProjectId?: string | null
        urlProjectId?: string | null
        storedProjectId?: string | null
      },
    ) => { project: Project | null; staleProjectId: string | null }
    persistProjectSelection?: (
      projectId: string | null,
      location: Pick<Location, 'href'>,
      history: Pick<History, 'replaceState'>,
      storage: Pick<Storage, 'setItem' | 'removeItem'>,
    ) => void
  }

  expect(module.resolveProjectSelection).toBeTypeOf('function')
  expect(module.persistProjectSelection).toBeTypeOf('function')
  return module
}

describe('project selection restoration', () => {
  it('renders a visible notice when a persisted project is stale', () => {
    const html = renderToStaticMarkup(createElement(projectModule.ProjectSelectorContent, {
      state: { status: 'success', data: projects },
      selected: 'beta',
      notice: 'Project deleted-project is no longer available. Showing Beta.',
      onSelect: vi.fn(),
      onRetry: vi.fn(),
    }))

    expect(html).toContain('role="status"')
    expect(html).toContain('Project deleted-project is no longer available. Showing Beta.')
  })

  it('restores a valid URL project before local storage', () => {
    const { resolveProjectSelection } = selectionExports()

    expect(resolveProjectSelection?.(projects, {
      urlProjectId: 'alpha',
      storedProjectId: 'beta',
    })).toEqual({ project: projects[0], staleProjectId: null })
  })

  it('restores local storage when the URL has no project', () => {
    const { resolveProjectSelection } = selectionExports()

    expect(resolveProjectSelection?.(projects, {
      urlProjectId: null,
      storedProjectId: 'beta',
    })).toEqual({ project: projects[1], staleProjectId: null })
  })

  it('falls back from a stale persisted id and exposes it for a visible notice', () => {
    const { resolveProjectSelection } = selectionExports()

    expect(resolveProjectSelection?.(projects, {
      urlProjectId: 'deleted-project',
      storedProjectId: null,
    })).toEqual({ project: projects[1], staleProjectId: 'deleted-project' })
  })

  it('keeps a stale-id notice visible when no projects remain', () => {
    const { resolveProjectSelection } = selectionExports()

    const selection = resolveProjectSelection?.([], {
      urlProjectId: 'deleted-project',
      storedProjectId: null,
    })
    expect(selection).toEqual({ project: null, staleProjectId: 'deleted-project' })

    const html = renderToStaticMarkup(createElement(projectModule.ProjectSelectorContent, {
      state: { status: 'success', data: [] },
      selected: null,
      notice: 'Project deleted-project is no longer available. Showing all projects.',
      onSelect: vi.fn(),
      onRetry: vi.fn(),
    }))
    expect(html).toContain('role="status"')
    expect(html).toContain('Project deleted-project is no longer available.')
  })

  it('selects a newly indexed project ahead of the current selection', () => {
    const { resolveProjectSelection } = selectionExports()

    expect(resolveProjectSelection?.(projects, {
      requestedProjectId: 'beta',
      currentProjectId: 'alpha',
      urlProjectId: 'alpha',
      storedProjectId: 'alpha',
    })).toEqual({ project: projects[1], staleProjectId: null })
  })

  it('writes selection to the shareable URL and local storage without navigation', () => {
    const { persistProjectSelection } = selectionExports()
    const replaceState = vi.fn()
    const setItem = vi.fn()

    persistProjectSelection?.(
      'beta value',
      { href: 'https://dashboard.test/?tab=graph#details' },
      { replaceState },
      { setItem, removeItem: vi.fn() },
    )

    expect(replaceState).toHaveBeenCalledWith(
      null,
      '',
      'https://dashboard.test/?tab=graph&projectId=beta+value#details',
    )
    expect(setItem).toHaveBeenCalledWith('codegraph.selectedProjectId', 'beta value')
  })
})
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
