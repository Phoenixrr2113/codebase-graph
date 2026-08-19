import { useState, useCallback } from 'react'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AppShell } from '@/components/dashboard/app-shell'
import { OperationsTab } from '@/components/dashboard/operations-tab'
import { ParseProjectDialog } from '@/components/dashboard/parse-project-dialog'
import { EmbeddingBadge } from '@/components/dashboard/embedding-badge'
import { ProjectSelector } from '@/components/dashboard/project-selector'
import { API_URL } from '@/lib/api'

export default function App() {
  const [activeTab, setActiveTab] = useState('explorer')
  const [projectId, setProjectId] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const handleProjectParsed = useCallback(() => {
    setRefreshKey(k => k + 1)
  }, [])

  const handleProjectChange = useCallback((project: { id: string; name: string } | null) => {
    setProjectId(project?.id ?? null)
  }, [])

  return (
    <div className="flex h-full flex-col" data-testid="app-shell">
      <header className="flex items-center justify-between border-b border-border bg-card px-4 py-2">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold tracking-tight">CodeGraph</h1>
          <span className="text-muted-foreground/30">|</span>
          <ProjectSelector onProjectChange={handleProjectChange} />
          <EmbeddingBadge />
        </div>
        <div className="flex items-center gap-3">
          <ParseProjectDialog apiUrl={API_URL} onProjectParsed={handleProjectParsed} />
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList>
              <TabsTrigger value="explorer">Graph Explorer</TabsTrigger>
              <TabsTrigger value="operations">Operations</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-hidden">
        {activeTab === 'explorer' && <AppShell key={`${projectId}-${refreshKey}`} projectId={projectId} />}
        {activeTab === 'operations' && <OperationsTab />}
      </main>
    </div>
  )
}
