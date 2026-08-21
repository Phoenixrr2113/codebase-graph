import { createElement, type ComponentType } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import * as embeddingModule from './embedding-badge'
import * as parseModule from './parse-project-dialog'
import * as projectModule from './project-selector'

function exportedComponent(
  module: object,
  name: string,
): ComponentType<Record<string, unknown>> {
  const component = Reflect.get(module, name) as unknown
  expect(typeof component).toBe('function')
  return component as ComponentType<Record<string, unknown>>
}

describe('secondary dashboard controls', () => {
  it('renders a project-list failure as a visible retry affordance', () => {
    const ProjectSelectorContent = exportedComponent(projectModule, 'ProjectSelectorContent')
    const html = renderToStaticMarkup(createElement(ProjectSelectorContent, {
      state: { status: 'error', message: 'HTTP 503 Service Unavailable' },
      selected: null,
      onSelect: vi.fn(),
      onRetry: vi.fn(),
    }))

    expect(html).toContain('role="alert"')
    expect(html).toContain('Projects unavailable')
    expect(html).toContain('Retry')
  })

  it('labels the project select and gives it a visible focus ring', () => {
    const ProjectSelectorContent = exportedComponent(projectModule, 'ProjectSelectorContent')
    const html = renderToStaticMarkup(createElement(ProjectSelectorContent, {
      state: {
        status: 'success',
        data: [
          { id: 'one', name: 'One', rootPath: '/one' },
          { id: 'two', name: 'Two', rootPath: '/two' },
        ],
      },
      selected: 'two',
      onSelect: vi.fn(),
      onRetry: vi.fn(),
    }))

    expect(html).toContain('aria-label="Indexed project"')
    expect(html).toContain('focus-visible:ring')
  })

  it('renders an embedding-status failure as a visible retry affordance', () => {
    const EmbeddingBadgeContent = exportedComponent(embeddingModule, 'EmbeddingBadgeContent')
    const html = renderToStaticMarkup(createElement(EmbeddingBadgeContent, {
      state: { status: 'error', message: 'Network unavailable' },
      generating: false,
      genResult: null,
      onGenerate: vi.fn(),
      onRetry: vi.fn(),
    }))

    expect(html).toContain('role="alert"')
    expect(html).toContain('Embedding status unavailable')
    expect(html).toContain('Retry')
  })

  it('provides a programmatic label for the index-project path input', () => {
    const ParseProjectForm = exportedComponent(parseModule, 'ParseProjectForm')
    const html = renderToStaticMarkup(createElement(ParseProjectForm, {
      path: '',
      loading: false,
      result: null,
      onPathChange: vi.fn(),
      onParse: vi.fn(),
      onCancel: vi.fn(),
    }))

    expect(html).toContain('for="index-project-path"')
    expect(html).toContain('id="index-project-path"')
    expect(html).toContain('Project path')
  })
})
