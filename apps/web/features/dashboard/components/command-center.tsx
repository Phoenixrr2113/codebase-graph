"use client"

import { useState, useEffect } from "react"
import { Sidebar } from "./sidebar"
import { TopBar } from "./top-bar"
import { DevicesPanel } from "./devices-panel"
import { AgentChat } from "./agent-chat"
import { MissionsPanel } from "./missions-panel"
import { MissionDetail } from "./mission-detail"
import { MissionCreate } from "./mission-create"
import { ActivityPanel } from "./activity-panel"
import { DashboardPanel } from "./dashboard-panel"
import { SettingsPanel } from "./settings-panel"
import { AutomationsPanel } from "./automations-panel"
import { AutomationDetail } from "./automation-detail"
import { AutomationCreate } from "./automation-create"
import { VaultPanel } from "./vault-panel"

export type ActiveView =
  | "dashboard"
  | "chat"
  | "missions"
  | "automations"
  | "devices"
  | "vault"
  | "activity"
  | "settings"

export function CommandCenter() {
  const [activeView, setActiveView] = useState<ActiveView>("dashboard")
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [selectedMissionId, setSelectedMissionId] = useState<string | null>(null)
  const [isCreatingMission, setIsCreatingMission] = useState(false)
  const [selectedAutomationId, setSelectedAutomationId] = useState<string | null>(null)
  const [isCreatingAutomation, setIsCreatingAutomation] = useState(false)
  const [activityFilterApprovals, setActivityFilterApprovals] = useState(false)

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 1024) {
        setSidebarCollapsed(true)
      } else {
        setSidebarCollapsed(false)
      }
    }

    handleResize()

    window.addEventListener("resize", handleResize)
    return () => window.removeEventListener("resize", handleResize)
  }, [])

  const handleViewChange = (view: ActiveView) => {
    setActiveView(view)
    setSelectedMissionId(null)
    setIsCreatingMission(false)
    setSelectedAutomationId(null)
    setIsCreatingAutomation(false)
    setActivityFilterApprovals(false)
  }

  const handleMissionSelect = (missionId: string) => {
    setSelectedMissionId(missionId)
  }

  const handleBackToMissions = () => {
    setSelectedMissionId(null)
    setIsCreatingMission(false)
  }

  const handleCreateMission = () => {
    setIsCreatingMission(true)
    setSelectedMissionId(null)
  }

  const handleMissionCreated = (missionId: string) => {
    setIsCreatingMission(false)
    setSelectedMissionId(missionId)
  }

  const handleAutomationSelect = (automationId: string) => {
    setSelectedAutomationId(automationId)
  }

  const handleBackToAutomations = () => {
    setSelectedAutomationId(null)
    setIsCreatingAutomation(false)
  }

  const handleCreateAutomation = () => {
    setIsCreatingAutomation(true)
    setSelectedAutomationId(null)
  }

  const handleAutomationCreated = (automationId: string) => {
    setIsCreatingAutomation(false)
    setSelectedAutomationId(automationId)
  }

  const handleNotificationsClick = () => {
    setActiveView("activity")
    setActivityFilterApprovals(true)
    setSelectedMissionId(null)
    setIsCreatingMission(false)
    setSelectedAutomationId(null)
    setIsCreatingAutomation(false)
  }

  const handleTopBarNavigate = (view: string) => {
    handleViewChange(view as ActiveView)
  }

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      <Sidebar
        activeView={activeView}
        onViewChange={handleViewChange}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
        activeMissionCount={2}
        activeAutomationCount={4}
        notificationCount={3}
        onNotificationsClick={handleNotificationsClick}
      />

      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="hidden md:block">
          <TopBar onNavigate={handleTopBarNavigate} />
        </div>

        <main className="flex-1 overflow-hidden p-3 md:p-4">
          {activeView === "dashboard" && <DashboardPanel onNavigate={(page) => handleViewChange(page as ActiveView)} />}
          {activeView === "chat" && (
            <AgentChat
              onMissionCreated={(missionId) => {
                setActiveView("missions")
                setSelectedMissionId(missionId)
              }}
            />
          )}
          {activeView === "missions" &&
            (isCreatingMission ? (
              <MissionCreate onBack={handleBackToMissions} onCreated={handleMissionCreated} />
            ) : selectedMissionId ? (
              <MissionDetail missionId={selectedMissionId} onBack={handleBackToMissions} />
            ) : (
              <MissionsPanel onSelectMission={handleMissionSelect} onCreateNew={handleCreateMission} />
            ))}
          {activeView === "automations" &&
            (isCreatingAutomation ? (
              <AutomationCreate onBack={handleBackToAutomations} onCreated={handleAutomationCreated} />
            ) : selectedAutomationId ? (
              <AutomationDetail automationId={selectedAutomationId} onBack={handleBackToAutomations} />
            ) : (
              <AutomationsPanel onSelectAutomation={handleAutomationSelect} onCreateNew={handleCreateAutomation} />
            ))}
          {activeView === "devices" && <DevicesPanel />}
          {activeView === "vault" && <VaultPanel />}
          {activeView === "activity" && (
            <ActivityPanel
              initialFilter={activityFilterApprovals ? "approvals" : "all"}
              onFilterChange={() => setActivityFilterApprovals(false)}
            />
          )}
          {activeView === "settings" && <SettingsPanel />}
        </main>
      </div>
    </div>
  )
}
