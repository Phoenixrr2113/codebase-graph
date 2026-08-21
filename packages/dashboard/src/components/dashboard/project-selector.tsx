import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { API_URL } from '@/lib/api'

interface Project {
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
}

interface ProjectSelectorContentProps {
  state: ProjectState
  selected: string | null
  onSelect: (project: Project | null) => void
  onRetry: () => void
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

export function ProjectSelectorContent({
  state,
  selected,
  onSelect,
  onRetry,
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

  if (state.data.length === 0) return null

  if (state.data.length === 1) {
    return (
      <div className="flex items-center gap-1.5">
        <div className="h-2 w-2 rounded-full bg-emerald-400" />
        <span className="text-sm font-medium">{state.data[0]!.name}</span>
      </div>
    )
  }

  return (
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
  )
}

export function ProjectSelector({ onProjectChange }: ProjectSelectorProps) {
  const [state, setState] = useState<ProjectState>({ status: 'loading' })
  const [selected, setSelected] = useState<string | null>(null)
  const selectedRef = useRef<string | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    setState({ status: 'loading' })
    const nextState = await loadProjects(fetch)
    setState(nextState)

    if (nextState.status !== 'success' || nextState.data.length === 0) return
    const currentProject = nextState.data.find((project) => project.id === selectedRef.current)
    const nextProject = currentProject ?? nextState.data[nextState.data.length - 1]!
    selectedRef.current = nextProject.id
    setSelected(nextProject.id)
    onProjectChange?.(nextProject)
  }, [onProjectChange])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return (
    <ProjectSelectorContent
      state={state}
      selected={selected}
      onSelect={(project) => {
        selectedRef.current = project?.id ?? null
        setSelected(project?.id ?? null)
        onProjectChange?.(project)
      }}
      onRetry={() => void refresh()}
    />
  )
}
