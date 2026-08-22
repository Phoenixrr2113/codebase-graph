import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { API_URL } from '@/lib/api'

export interface Project {
  id: string
  name: string
  rootPath: string | null
}

type ProjectState =
  | { status: 'loading' }
  | { status: 'success'; data: Project[] }
  | { status: 'error'; message: string }

interface ProjectSelectorProps {
  onProjectChange?: (project: Project | null) => void
  refreshKey?: number
  requestedProjectId?: string | null
}

interface ProjectSelectorContentProps {
  state: ProjectState
  selected: string | null
  onSelect: (project: Project | null) => void
  onRetry: () => void
  notice?: string | null
}

interface FetchResponse {
  ok: boolean
  status: number
  statusText: string
  json(): Promise<unknown>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseProjects(value: unknown): Project[] {
  if (!isRecord(value) || !Array.isArray(value.projects)) {
    throw new Error('Invalid projects response')
  }

  return value.projects.map((project) => {
    if (
      !isRecord(project)
      || typeof project.id !== 'string'
      || typeof project.name !== 'string'
      || (project.rootPath !== null && typeof project.rootPath !== 'string')
    ) {
      throw new Error('Invalid projects response')
    }
    return { id: project.id, name: project.name, rootPath: project.rootPath }
  })
}

async function loadProjects(
  fetcher: (input: string) => Promise<FetchResponse>,
): Promise<ProjectState> {
  try {
    const response = await fetcher(`${API_URL}/api/projects`)
    if (!response.ok) {
      const statusText = response.statusText ? ` ${response.statusText}` : ''
      throw new Error(`HTTP ${response.status}${statusText}`)
    }
    return { status: 'success', data: parseProjects(await response.json()) }
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'Request failed',
    }
  }
}

export const PROJECT_SELECTION_STORAGE_KEY = 'codegraph.selectedProjectId'

interface SelectionCandidates {
  requestedProjectId?: string | null
  currentProjectId?: string | null
  urlProjectId?: string | null
  storedProjectId?: string | null
}

export function resolveProjectSelection(
  projects: Project[],
  candidates: SelectionCandidates,
): { project: Project | null; staleProjectId: string | null } {
  const orderedCandidates = [
    candidates.requestedProjectId,
    candidates.currentProjectId,
    candidates.urlProjectId,
    candidates.storedProjectId,
  ]
  if (projects.length === 0) {
    return {
      project: null,
      staleProjectId: orderedCandidates.find((candidate): candidate is string => Boolean(candidate)) ?? null,
    }
  }

  let staleProjectId: string | null = null

  for (const candidate of orderedCandidates) {
    if (!candidate) continue
    const project = projects.find((entry) => entry.id === candidate)
    if (project) return { project, staleProjectId }
    staleProjectId ??= candidate
  }

  return {
    project: projects[projects.length - 1]!,
    staleProjectId,
  }
}

export async function refreshProjectSelection(
  fetcher: (input: string) => Promise<FetchResponse>,
  candidates: SelectionCandidates,
): Promise<{
  state: ProjectState
  project: Project | null
  staleProjectId: string | null
}> {
  const state = await loadProjects(fetcher)
  if (state.status !== 'success') {
    return { state, project: null, staleProjectId: null }
  }
  return { state, ...resolveProjectSelection(state.data, candidates) }
}

export function persistProjectSelection(
  projectId: string | null,
  location: Pick<Location, 'href'>,
  history: Pick<History, 'replaceState'>,
  storage: Pick<Storage, 'setItem' | 'removeItem'>,
): void {
  const url = new URL(location.href)
  if (projectId) {
    url.searchParams.set('projectId', projectId)
  } else {
    url.searchParams.delete('projectId')
  }
  history.replaceState(null, '', url.href)
  if (projectId) storage.setItem(PROJECT_SELECTION_STORAGE_KEY, projectId)
  else storage.removeItem(PROJECT_SELECTION_STORAGE_KEY)
}

function readStoredProjectId(storage: Pick<Storage, 'getItem'>): string | null {
  try {
    return storage.getItem(PROJECT_SELECTION_STORAGE_KEY)
  } catch (error) {
    console.warn('Unable to read the saved project selection', error)
    return null
  }
}

function saveProjectSelection(projectId: string | null): void {
  try {
    persistProjectSelection(projectId, window.location, window.history, window.localStorage)
  } catch (error) {
    console.warn('Unable to persist the project selection', error)
  }
}

export function ProjectSelectorContent({
  state,
  selected,
  onSelect,
  onRetry,
  notice,
}: ProjectSelectorContentProps) {
  if (state.status === 'loading') return null

  if (state.status === 'error') {
    return (
      <div role="alert" className="flex items-center gap-1.5 text-[10px] text-red-400">
        <span>Projects unavailable</span>
        <Button variant="ghost" size="sm" onClick={onRetry} className="h-5 px-1.5 text-[10px]">
          Retry
        </Button>
      </div>
    )
  }

  if (state.data.length === 0) {
    return notice
      ? <span role="status" className="text-[10px] text-amber-400">{notice}</span>
      : null
  }

  if (state.data.length === 1) {
    return (
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-1.5">
          <div className="h-2 w-2 rounded-full bg-emerald-400" />
          <span className="text-sm font-medium">{state.data[0]!.name}</span>
        </div>
        {notice && <span role="status" className="text-[10px] text-amber-400">{notice}</span>}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-1.5">
        <div className="h-2 w-2 rounded-full bg-emerald-400" />
        <select
          aria-label="Indexed project"
          value={selected ?? ''}
          onChange={(event) => {
            const project = state.data.find((candidate) => candidate.id === event.target.value) ?? null
            onSelect(project)
          }}
          className="cursor-pointer border-none bg-transparent text-sm font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          {state.data.map((project) => (
            <option key={project.id} value={project.id} className="bg-card text-foreground">
              {project.name}
            </option>
          ))}
        </select>
      </div>
      {notice && <span role="status" className="text-[10px] text-amber-400">{notice}</span>}
    </div>
  )
}

export function ProjectSelector({
  onProjectChange,
  refreshKey = 0,
  requestedProjectId = null,
}: ProjectSelectorProps) {
  const [state, setState] = useState<ProjectState>({ status: 'loading' })
  const [selected, setSelected] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const selectedRef = useRef<string | null>(null)
  const consumedRequestRef = useRef<string | null>(null)
  const refreshSequenceRef = useRef(0)

  const refresh = useCallback(async (): Promise<void> => {
    const sequence = ++refreshSequenceRef.current
    setState({ status: 'loading' })
    const pendingRequestedProjectId = requestedProjectId !== consumedRequestRef.current
      ? requestedProjectId
      : null
    const result = await refreshProjectSelection(fetch, {
      requestedProjectId: pendingRequestedProjectId,
      currentProjectId: selectedRef.current,
      urlProjectId: new URL(window.location.href).searchParams.get('projectId'),
      storedProjectId: readStoredProjectId(window.localStorage),
    })
    if (sequence !== refreshSequenceRef.current) return
    setState(result.state)

    if (result.state.status !== 'success') return

    const nextProject = result.project
    if (pendingRequestedProjectId) consumedRequestRef.current = pendingRequestedProjectId
    selectedRef.current = nextProject?.id ?? null
    setSelected(nextProject?.id ?? null)
    setNotice(result.staleProjectId
      ? `Project ${result.staleProjectId} is no longer available. Showing ${nextProject?.name ?? 'all projects'}.`
      : null)
    saveProjectSelection(nextProject?.id ?? null)
    onProjectChange?.(nextProject)
  }, [onProjectChange, requestedProjectId])

  useEffect(() => {
    void refresh()
    return () => {
      refreshSequenceRef.current += 1
    }
  }, [refresh, refreshKey])

  return (
    <ProjectSelectorContent
      state={state}
      selected={selected}
      notice={notice}
      onSelect={(project) => {
        selectedRef.current = project?.id ?? null
        setSelected(project?.id ?? null)
        setNotice(null)
        saveProjectSelection(project?.id ?? null)
        onProjectChange?.(project)
      }}
      onRetry={() => void refresh()}
    />
  )
}
