"use client"

import { useState } from "react"
import {
  Target,
  Clock,
  Activity,
  CheckCircle2,
  AlertCircle,
  Pause,
  MoreHorizontal,
  Search,
  Plus,
  Bot,
} from "lucide-react"
import { cn } from "@/lib/utils"

interface Mission {
  id: string
  title: string
  description: string
  status: "active" | "paused" | "completed" | "needs_input"
  progress: number
  startDate: Date
  lastUpdate: string
  actionsCompleted: number
  totalActions: number
  category: string
}

const missions: Mission[] = [
  {
    id: "1",
    title: "Bradenton Rental Property Search",
    description: "Find rental properties under $250K with positive cash flow potential",
    status: "needs_input",
    progress: 85,
    startDate: new Date(Date.now() - 25 * 24 * 60 * 60 * 1000),
    lastUpdate: "Offer accepted! Inspection scheduled for Thursday 2PM",
    actionsCompleted: 47,
    totalActions: 55,
    category: "Real Estate",
  },
  {
    id: "2",
    title: "Weekly Market Report Generation",
    description: "Compile market analysis report with comparable sales data",
    status: "active",
    progress: 30,
    startDate: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
    lastUpdate: "Gathering comparable sales data from 3 counties",
    actionsCompleted: 12,
    totalActions: 40,
    category: "Research",
  },
  {
    id: "3",
    title: "Job Application Campaign",
    description: "Apply to 20 remote React developer positions",
    status: "active",
    progress: 45,
    startDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
    lastUpdate: "Applied to 9 positions, 2 responses received",
    actionsCompleted: 9,
    totalActions: 20,
    category: "Career",
  },
  {
    id: "4",
    title: "Competitor Price Monitoring",
    description: "Track pricing changes for top 5 competitors",
    status: "completed",
    progress: 100,
    startDate: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000),
    lastUpdate: "Monitoring cycle complete - report generated",
    actionsCompleted: 28,
    totalActions: 28,
    category: "Business",
  },
]

interface MissionsPanelProps {
  onSelectMission: (missionId: string) => void
  onCreateNew: () => void
}

const statusConfig = {
  active: { label: "Active", color: "text-green-500", bg: "bg-green-500/10", icon: Activity },
  paused: { label: "Paused", color: "text-amber-500", bg: "bg-amber-500/10", icon: Pause },
  completed: { label: "Completed", color: "text-muted-foreground", bg: "bg-secondary", icon: CheckCircle2 },
  needs_input: { label: "Needs Input", color: "text-primary", bg: "bg-primary/10", icon: AlertCircle },
}

export function MissionsPanel({ onSelectMission, onCreateNew }: MissionsPanelProps) {
  const [filter, setFilter] = useState<"all" | "active" | "paused" | "completed" | "needs_input">("all")
  const [searchQuery, setSearchQuery] = useState("")

  const filteredMissions = missions.filter((m) => {
    if (filter !== "all" && m.status !== filter) return false
    if (searchQuery && !m.title.toLowerCase().includes(searchQuery.toLowerCase())) return false
    return true
  })

  const activeMissions = missions.filter((m) => m.status === "active" || m.status === "needs_input").length

  return (
    <div className="flex flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Missions</h2>
          <p className="text-sm text-muted-foreground">{activeMissions} active</p>
        </div>
        <button
          onClick={onCreateNew}
          className="flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">New Mission</span>
        </button>
      </div>

      {/* Search & Filters */}
      <div className="flex flex-col gap-3 border-b border-border px-6 py-3 sm:flex-row sm:items-center">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search missions..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border border-border bg-secondary/30 py-2 pl-10 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <div className="flex items-center gap-1.5 overflow-x-auto">
          {(["all", "active", "needs_input", "completed"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                "whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                filter === f
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-muted-foreground hover:text-foreground",
              )}
            >
              {f === "needs_input" ? "Needs Input" : f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Mission List */}
      <div className="flex-1 overflow-y-auto p-4">
        {filteredMissions.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-center py-12">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-secondary">
              <Bot className="h-8 w-8 text-muted-foreground" />
            </div>
            <div>
              <p className="font-medium text-foreground truncate">No missions found</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {searchQuery || filter !== "all"
                  ? "Try adjusting your search or filters"
                  : "Start your first mission to see it here"}
              </p>
            </div>
            {!searchQuery && filter === "all" && (
              <button
                onClick={onCreateNew}
                className="mt-2 flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
              >
                <Plus className="h-4 w-4" />
                New Mission
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {filteredMissions.map((mission) => {
              const status = statusConfig[mission.status]
              const StatusIcon = status.icon
              const daysSinceStart = Math.floor((Date.now() - mission.startDate.getTime()) / (1000 * 60 * 60 * 24))

              return (
                <div
                  key={mission.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelectMission(mission.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault()
                      onSelectMission(mission.id)
                    }
                  }}
                  className="w-full cursor-pointer rounded-xl border border-border bg-secondary/20 p-4 text-left transition-all hover:border-primary/40 hover:bg-secondary/40"
                >
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                      <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", status.bg)}>
                        <Target className={cn("h-4 w-4", status.color)} />
                      </div>
                      <div className="min-w-0">
                        <h3 className="font-medium text-foreground truncate">{mission.title}</h3>
                        <p className="text-sm text-muted-foreground truncate">{mission.description}</p>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span
                        className={cn(
                          "flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
                          status.bg,
                          status.color,
                        )}
                      >
                        <StatusIcon className="h-3 w-3" />
                        {status.label}
                      </span>
                      <button
                        className="rounded-lg p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  {/* Progress */}
                  <div className="mb-3">
                    <div className="mb-1 flex justify-between text-xs">
                      <span className="text-muted-foreground">Progress</span>
                      <span className="text-foreground">{mission.progress}%</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
                      <div
                        className={cn(
                          "h-full rounded-full transition-all",
                          mission.status === "needs_input"
                            ? "bg-primary"
                            : mission.status === "completed"
                              ? "bg-muted-foreground"
                              : "bg-green-500",
                        )}
                        style={{ width: `${mission.progress}%` }}
                      />
                    </div>
                  </div>

                  {/* Last update */}
                  <p className="mb-3 text-sm text-foreground line-clamp-1">{mission.lastUpdate}</p>

                  {/* Meta */}
                  <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {daysSinceStart}d
                    </span>
                    <span className="flex items-center gap-1">
                      <Activity className="h-3 w-3" />
                      {mission.actionsCompleted}/{mission.totalActions}
                    </span>
                    <span className="rounded-full bg-secondary px-2 py-0.5">{mission.category}</span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
