import { useState, useCallback, useReducer } from 'react'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AppShell } from '@/components/dashboard/app-shell'
import { OperationsTab } from '@/components/dashboard/operations-tab'
import { ParseProjectDialog, type ParsedProject } from '@/components/dashboard/parse-project-dialog'
import { EmbeddingBadge } from '@/components/dashboard/embedding-badge'
import { ProjectSelector } from '@/components/dashboard/project-selector'
import { API_URL } from '@/lib/api'
import { AnalysisTab } from '@/components/dashboard/analysis-tab'
import type { GraphNode } from '@/components/dashboard/graph-canvas'

export default function App() {
  const [activeTab, setActiveTab] = useState('explorer')
  const [project, setProject] = useState<{ id: string; name: string } | null>(null)
  const [projectRefresh, dispatchProjectParsed] = useReducer(reduceProjectRefresh, {
    refreshKey: 0,
    requestedProjectId: null,
  })
  const [analysisSelection, setAnalysisSelection] = useState<GraphNode | null>(null)

  const handleProjectParsed = useCallback((parsedProject: ParsedProject) => {
    dispatchProjectParsed(parsedProject)
  }, [])

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
          <EmbeddingBadge
            projectId={project?.id ?? null}
            projectName={project?.name ?? null}
            refreshKey={projectRefresh.refreshKey}
          />
        </div>
        <div className="flex items-center gap-3">
          <ParseProjectDialog apiUrl={API_URL} onProjectParsed={handleProjectParsed} />
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList>
              <TabsTrigger value="explorer">Graph Explorer</TabsTrigger>
              <TabsTrigger value="analysis">Analysis</TabsTrigger>
              <TabsTrigger value="operations">Operations</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-hidden">
        {activeTab === 'explorer' && (
          <AppShell
            key={`${project?.id ?? 'all'}-${projectRefresh.refreshKey}`}
            projectId={project?.id ?? null}
            projectName={project?.name ?? 'All projects'}
            externalSelection={analysisSelection}
          />
        )}
        {activeTab === 'analysis' && (
          <AnalysisTab
            projectId={project?.id ?? null}
            onSelect={(node) => {
              setAnalysisSelection(node)
              setActiveTab('explorer')
            }}
          />
        )}
        {activeTab === 'operations' && <OperationsTab />}
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
