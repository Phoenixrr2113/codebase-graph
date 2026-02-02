"use client"

import { useState } from "react"
import {
  ArrowLeft,
  Play,
  Pause,
  Settings,
  Clock,
  CheckCircle2,
  XCircle,
  RotateCw,
  Monitor,
  ChevronDown,
  ChevronRight,
} from "lucide-react"
import { cn } from "@/lib/utils"

interface AutomationDetailProps {
  automationId: string
  onBack: () => void
}

interface RunLog {
  id: string
  timestamp: string
  status: "success" | "failed" | "running"
  duration: string | null
  summary: string
  steps: {
    name: string
    status: "success" | "failed" | "running" | "skipped"
    detail?: string
  }[]
}

const automationData = {
  id: "1",
  name: "Morning Email Digest",
  description: "Summarize important emails and send a digest at 7 AM every day",
  status: "active" as const,
  trigger: {
    type: "schedule",
    schedule: "0 7 * * *",
    humanReadable: "Daily at 7:00 AM",
    timezone: "America/New_York",
  },
  devices: ["MacBook Pro - Work"],
  createdAt: "Dec 1, 2024",
  totalRuns: 45,
  successRate: 98,
  avgDuration: "2m 34s",
  lastRun: "Today, 7:00 AM",
  nextRun: "Tomorrow, 7:00 AM",
}

const runLogs: RunLog[] = [
  {
    id: "run-1",
    timestamp: "Today, 7:00 AM",
    status: "success",
    duration: "2m 18s",
    summary: "Processed 23 emails, sent digest with 5 important items",
    steps: [
      { name: "Connect to Gmail", status: "success", detail: "Connected successfully" },
      { name: "Fetch unread emails", status: "success", detail: "Retrieved 23 emails" },
      { name: "Analyze with AI", status: "success", detail: "Identified 5 high-priority items" },
      { name: "Generate digest", status: "success", detail: "Created summary document" },
      { name: "Send notification", status: "success", detail: "Sent to Slack #daily-digest" },
    ],
  },
  {
    id: "run-2",
    timestamp: "Yesterday, 7:00 AM",
    status: "success",
    duration: "2m 45s",
    summary: "Processed 31 emails, sent digest with 7 important items",
    steps: [
      { name: "Connect to Gmail", status: "success" },
      { name: "Fetch unread emails", status: "success", detail: "Retrieved 31 emails" },
      { name: "Analyze with AI", status: "success", detail: "Identified 7 high-priority items" },
      { name: "Generate digest", status: "success" },
      { name: "Send notification", status: "success" },
    ],
  },
  {
    id: "run-3",
    timestamp: "Dec 28, 7:00 AM",
    status: "failed",
    duration: "0m 12s",
    summary: "Failed to connect to Gmail - authentication expired",
    steps: [
      { name: "Connect to Gmail", status: "failed", detail: "OAuth token expired" },
      { name: "Fetch unread emails", status: "skipped" },
      { name: "Analyze with AI", status: "skipped" },
      { name: "Generate digest", status: "skipped" },
      { name: "Send notification", status: "skipped" },
    ],
  },
  {
    id: "run-4",
    timestamp: "Dec 27, 7:00 AM",
    status: "success",
    duration: "1m 58s",
    summary: "Processed 18 emails, sent digest with 3 important items",
    steps: [
      { name: "Connect to Gmail", status: "success" },
      { name: "Fetch unread emails", status: "success", detail: "Retrieved 18 emails" },
      { name: "Analyze with AI", status: "success", detail: "Identified 3 high-priority items" },
      { name: "Generate digest", status: "success" },
      { name: "Send notification", status: "success" },
    ],
  },
]

const statusConfig = {
  success: { icon: CheckCircle2, color: "text-primary", bg: "bg-primary/10" },
  failed: { icon: XCircle, color: "text-destructive", bg: "bg-destructive/10" },
  running: { icon: RotateCw, color: "text-blue-400", bg: "bg-blue-400/10" },
  skipped: { icon: ChevronRight, color: "text-muted-foreground", bg: "bg-muted" },
}

export function AutomationDetail({ automationId, onBack }: AutomationDetailProps) {
  const [expandedRun, setExpandedRun] = useState<string | null>("run-1")

  return (
    <div className="flex h-full flex-col gap-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold text-foreground">{automationData.name}</h1>
            <span className="flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
              <Play className="h-3 w-3" />
              Active
            </span>
          </div>
          <p className="text-sm text-muted-foreground">{automationData.description}</p>
        </div>
        <div className="flex items-center gap-2">
          <button className="flex items-center gap-2 rounded-lg border border-border bg-secondary px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-secondary/80">
            <Pause className="h-4 w-4" />
            Pause
          </button>
          <button className="flex items-center gap-2 rounded-lg border border-border bg-secondary px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-secondary/80">
            <Play className="h-4 w-4" />
            Run Now
          </button>
          <button className="rounded-lg border border-border bg-secondary p-2 text-muted-foreground transition-colors hover:bg-secondary/80 hover:text-foreground">
            <Settings className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex flex-1 gap-4 overflow-hidden">
        {/* Main Content - Run History */}
        <div className="flex flex-1 flex-col overflow-hidden rounded-lg border border-border bg-card">
          <div className="border-b border-border px-4 py-3">
            <h2 className="font-medium text-foreground">Run History</h2>
          </div>

          <div className="flex-1 overflow-y-auto">
            {runLogs.map((run) => {
              const StatusIcon = statusConfig[run.status].icon
              const isExpanded = expandedRun === run.id

              return (
                <div key={run.id} className="border-b border-border last:border-b-0">
                  <button
                    onClick={() => setExpandedRun(isExpanded ? null : run.id)}
                    className="flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-secondary/50"
                  >
                    <div
                      className={cn(
                        "flex h-8 w-8 items-center justify-center rounded-full",
                        statusConfig[run.status].bg,
                      )}
                    >
                      <StatusIcon
                        className={cn(
                          "h-4 w-4",
                          statusConfig[run.status].color,
                          run.status === "running" && "animate-spin",
                        )}
                      />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-foreground">{run.timestamp}</span>
                        {run.duration && <span className="text-xs text-muted-foreground">({run.duration})</span>}
                      </div>
                      <p className="mt-0.5 text-sm text-muted-foreground">{run.summary}</p>
                    </div>
                    <ChevronDown
                      className={cn("h-4 w-4 text-muted-foreground transition-transform", isExpanded && "rotate-180")}
                    />
                  </button>

                  {isExpanded && (
                    <div className="border-t border-border bg-secondary/30 px-4 py-3">
                      <div className="space-y-2">
                        {run.steps.map((step, index) => {
                          const StepIcon = statusConfig[step.status].icon
                          return (
                            <div key={index} className="flex items-center gap-3">
                              <div className="flex h-6 w-6 items-center justify-center">
                                <StepIcon
                                  className={cn(
                                    "h-4 w-4",
                                    statusConfig[step.status].color,
                                    step.status === "running" && "animate-spin",
                                  )}
                                />
                              </div>
                              <span className="text-sm text-foreground">{step.name}</span>
                              {step.detail && <span className="text-xs text-muted-foreground">— {step.detail}</span>}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Sidebar - Configuration */}
        <div className="w-72 shrink-0 space-y-4 overflow-y-auto">
          {/* Stats */}
          <div className="rounded-lg border border-border bg-card p-4">
            <h3 className="text-sm font-medium text-foreground">Statistics</h3>
            <div className="mt-3 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Total Runs</span>
                <span className="text-sm font-medium text-foreground">{automationData.totalRuns}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Success Rate</span>
                <span className="text-sm font-medium text-primary">{automationData.successRate}%</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Avg Duration</span>
                <span className="text-sm font-medium text-foreground">{automationData.avgDuration}</span>
              </div>
            </div>
          </div>

          {/* Trigger */}
          <div className="rounded-lg border border-border bg-card p-4">
            <h3 className="text-sm font-medium text-foreground">Trigger</h3>
            <div className="mt-3 space-y-2">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-foreground">{automationData.trigger.humanReadable}</span>
              </div>
              <div className="rounded-md bg-secondary px-2 py-1">
                <code className="text-xs text-muted-foreground">{automationData.trigger.schedule}</code>
              </div>
              <p className="text-xs text-muted-foreground">Timezone: {automationData.trigger.timezone}</p>
            </div>
          </div>

          {/* Schedule */}
          <div className="rounded-lg border border-border bg-card p-4">
            <h3 className="text-sm font-medium text-foreground">Schedule</h3>
            <div className="mt-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Last Run</span>
                <span className="text-sm text-foreground">{automationData.lastRun}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Next Run</span>
                <span className="text-sm text-primary">{automationData.nextRun}</span>
              </div>
            </div>
          </div>

          {/* Device */}
          <div className="rounded-lg border border-border bg-card p-4">
            <h3 className="text-sm font-medium text-foreground">Runs On</h3>
            <div className="mt-3">
              {automationData.devices.map((device, index) => (
                <div key={index} className="flex items-center gap-2">
                  <Monitor className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm text-foreground">{device}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Danger Zone */}
          <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-4">
            <h3 className="text-sm font-medium text-destructive">Danger Zone</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Permanently delete this automation and all run history.
            </p>
            <button className="mt-3 w-full rounded-lg border border-destructive bg-destructive/10 py-2 text-sm font-medium text-destructive transition-colors hover:bg-destructive/20">
              Delete Automation
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
