import { useState, useCallback, useEffect, useReducer, useRef } from 'react'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { AppShell } from '@/components/dashboard/app-shell'
import { OperationsTab } from '@/components/dashboard/operations-tab'
import { ParseProjectDialog, type ParsedProject } from '@/components/dashboard/parse-project-dialog'
import { EmbeddingBadge } from '@/components/dashboard/embedding-badge'
import { ProjectSelector } from '@/components/dashboard/project-selector'
import { API_URL } from '@/lib/api'
import { AnalysisTab } from '@/components/dashboard/analysis-tab'
import type { GraphNode } from '@/components/dashboard/graph-canvas'
import { SetupFlow } from '@/components/dashboard/setup-flow'
import { loadSetupStatus, setupNeedsPolling, type SetupStatus } from '@/lib/setup-status'
import { createQueryWorkspaces } from '@/components/dashboard/query-panel'
import { createSearchWorkspace } from '@/components/dashboard/search-panel'

type SetupResource =
  | { status: 'loading' }
  | { status: 'success'; data: SetupStatus }
  | { status: 'error'; message: string }

export default function App() {
  const [activeTab, setActiveTab] = useState('explorer')
  const [project, setProject] = useState<{ id: string; name: string } | null>(null)
  const [projectRefresh, dispatchProjectParsed] = useReducer(reduceProjectRefresh, {
    refreshKey: 0,
    requestedProjectId: null,
  })
  const [analysisSelection, setAnalysisSelection] = useState<GraphNode | null>(null)
  const [setup, setSetup] = useState<SetupResource>({ status: 'loading' })
  const [setupOpen, setSetupOpen] = useState(false)
  const [queryWorkspaces, setQueryWorkspaces] = useState(createQueryWorkspaces)
  const [searchWorkspace, setSearchWorkspace] = useState(createSearchWorkspace)
  const setupRequestRef = useRef(0)

  const refreshSetup = useCallback(async (showLoading = false): Promise<void> => {
    const sequence = ++setupRequestRef.current
    if (showLoading) setSetup({ status: 'loading' })
    try {
      const data = await loadSetupStatus(API_URL)
      if (sequence !== setupRequestRef.current) return
      setSetup({ status: 'success', data })
      if (!data.projects.configured || data.embedding.migration) setSetupOpen(true)
    } catch (error) {
      if (sequence !== setupRequestRef.current) return
      setSetup({
        status: 'error',
        message: error instanceof Error ? error.message : 'Setup status unavailable',
      })
    }
  }, [])

  useEffect(() => {
    void refreshSetup(true)
    return () => { setupRequestRef.current += 1 }
  }, [refreshSetup])

  useEffect(() => {
    if (setup.status !== 'success' || (!setupOpen && !setupNeedsPolling(setup.data))) return
    const timer = window.setInterval(() => { void refreshSetup() }, 500)
    return () => window.clearInterval(timer)
  }, [refreshSetup, setup, setupOpen])

  const handleProjectParsed = useCallback((parsedProject: ParsedProject) => {
    dispatchProjectParsed(parsedProject)
    void refreshSetup()
  }, [refreshSetup])

  const handleProjectChange = useCallback((project: { id: string; name: string } | null) => {
    setProject(project)
    setAnalysisSelection(null)
  }, [])

  return (
    <div className="flex h-full flex-col" data-testid="app-shell">
      <header className="flex items-center justify-between border-b border-border bg-card px-4 py-2">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold tracking-tight">CodeGraph</h1>
          <span className="text-muted-foreground/30">|</span>
          <ProjectSelector
            onProjectChange={handleProjectChange}
            refreshKey={projectRefresh.refreshKey}
            requestedProjectId={projectRefresh.requestedProjectId}
          />
          {setup.status === 'success' && setup.data.projects.configured && (
            <EmbeddingBadge
              projectId={project?.id ?? null}
              projectName={project?.name ?? null}
              refreshKey={projectRefresh.refreshKey}
            />
          )}
        </div>
        <div className="flex items-center gap-3">
          {setup.status === 'success' && setup.data.projects.configured && (
            <ParseProjectDialog apiUrl={API_URL} onProjectParsed={handleProjectParsed} />
          )}
          {setup.status === 'success' && setup.data.projects.configured && (
            <Button variant="ghost" size="sm" onClick={() => setSetupOpen(true)} className="h-7 text-xs">
              Setup
            </Button>
          )}
          <Tabs value={activeTab} onValueChange={(tab) => {
            setActiveTab(tab)
            if (setup.status === 'success' && setup.data.projects.configured) setSetupOpen(false)
          }}>
            <TabsList>
              <TabsTrigger value="explorer">Graph Explorer</TabsTrigger>
              <TabsTrigger value="analysis">Analysis</TabsTrigger>
              <TabsTrigger value="operations">Operations</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-hidden">
        {setup.status === 'loading' && (
          <div role="status" aria-live="polite" className="grid h-full place-items-center text-sm text-muted-foreground">
            Checking setup...
          </div>
        )}
        {setup.status === 'error' && (
          <div role="alert" className="grid h-full place-items-center p-6 text-center">
            <div>
              <p className="font-medium text-red-700 dark:text-red-400">Setup status unavailable</p>
              <p className="mt-1 text-sm text-muted-foreground">{setup.message}</p>
              <Button variant="outline" className="mt-4" onClick={() => void refreshSetup(true)}>Retry</Button>
            </div>
          </div>
        )}
        {setup.status === 'success' && setupOpen && (
          <SetupFlow
            apiUrl={API_URL}
            status={setup.data}
            onStatusRefresh={() => refreshSetup()}
            onProjectParsed={handleProjectParsed}
            onExplore={() => {
              setSetupOpen(false)
              setActiveTab('explorer')
            }}
          />
        )}
        {setup.status === 'success' && !setupOpen && activeTab === 'explorer' && (
          <AppShell
            key={`${project?.id ?? 'all'}-${projectRefresh.refreshKey}`}
            projectId={project?.id ?? null}
            projectName={project?.name ?? 'All projects'}
            externalSelection={analysisSelection}
            queryWorkspaces={queryWorkspaces}
            onQueryWorkspacesChange={setQueryWorkspaces}
            searchWorkspace={searchWorkspace}
            onSearchWorkspaceChange={setSearchWorkspace}
          />
        )}
        {setup.status === 'success' && !setupOpen && activeTab === 'analysis' && (
          <AnalysisTab
            projectId={project?.id ?? null}
            onSelect={(node) => {
              setAnalysisSelection(node)
              setActiveTab('explorer')
            }}
          />
        )}
        {setup.status === 'success' && !setupOpen && activeTab === 'operations' && <OperationsTab />}
      </main>
    </div>
  )
}

interface ProjectRefreshState {
  refreshKey: number
  requestedProjectId: string | null
}

export function reduceProjectRefresh(
  state: ProjectRefreshState,
  parsedProject: ParsedProject,
): ProjectRefreshState {
  return {
    refreshKey: state.refreshKey + 1,
    requestedProjectId: parsedProject.projectId,
  }
}
