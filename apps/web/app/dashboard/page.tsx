'use client'

import { useState } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AppShell } from '@/components/dashboard/app-shell'
import { OperationsTab } from '@/components/dashboard/operations-tab'

export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState('explorer')

  return (
    <div className="flex h-full flex-col" data-testid="app-shell">
      <header className="flex items-center justify-between border-b border-border bg-card px-4 py-2">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold tracking-tight">CodeGraph</h1>
          <span className="text-xs text-muted-foreground">Dashboard</span>
        </div>
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="explorer">Graph Explorer</TabsTrigger>
            <TabsTrigger value="operations">Operations</TabsTrigger>
          </TabsList>
        </Tabs>
      </header>

      <main className="flex-1 overflow-hidden">
        {activeTab === 'explorer' && <AppShell />}
        {activeTab === 'operations' && <OperationsTab />}
      </main>
    </div>
  )
}
