"use client"

import { useState, useEffect } from "react"
import {
  MousePointer,
  Mail,
  FileText,
  Globe,
  CheckCircle,
  Clock,
  Calendar,
  Smartphone,
  Monitor,
  ChevronRight,
  Activity,
} from "lucide-react"
import { cn } from "@/lib/utils"

function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  confirmVariant = "primary",
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  description: string
  confirmLabel: string
  confirmVariant?: "primary" | "destructive"
  onConfirm: () => void
  onCancel: () => void
}) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-6">
        <h3 className="text-lg font-semibold text-foreground">{title}</h3>
        <p className="mt-2 text-sm text-muted-foreground">{description}</p>
        <div className="mt-6 flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-secondary"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className={cn(
              "flex-1 rounded-lg px-4 py-2 text-sm font-medium",
              confirmVariant === "destructive"
                ? "bg-destructive text-white hover:bg-destructive/90"
                : "bg-primary text-primary-foreground hover:bg-primary/90",
            )}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

type ActivityFilter = "all" | "actions" | "approvals"

interface ActivityItem {
  id: string
  type: "action" | "approval"
  icon: "click" | "email" | "document" | "browse"
  title: string
  description: string
  mission: string
  missionId: string
  device: string
  deviceType: "android" | "desktop"
  timestamp: string
  status: "completed" | "pending" | "approved"
}

const mockActivity: ActivityItem[] = [
  {
    id: "1",
    type: "approval",
    icon: "document",
    title: "Offer Letter Ready",
    description: "Agent drafted an offer for 4521 Manatee Ave - $242,000",
    mission: "Bradenton Rental Search",
    missionId: "1",
    device: "MacBook Pro",
    deviceType: "desktop",
    timestamp: "2 hours ago",
    status: "pending",
  },
  {
    id: "2",
    type: "action",
    icon: "browse",
    title: "Searched Zillow Listings",
    description: "Filtered properties in Bradenton under $250K with 3+ beds",
    mission: "Bradenton Rental Search",
    missionId: "1",
    device: "Pixel 8",
    deviceType: "android",
    timestamp: "3 hours ago",
    status: "completed",
  },
  {
    id: "3",
    type: "action",
    icon: "email",
    title: "Sent Follow-up Email",
    description: "Followed up with listing agent about property inspection",
    mission: "Bradenton Rental Search",
    missionId: "1",
    device: "MacBook Pro",
    deviceType: "desktop",
    timestamp: "5 hours ago",
    status: "completed",
  },
  {
    id: "4",
    type: "action",
    icon: "browse",
    title: "Collected Job Listings",
    description: "Found 12 matching React positions on LinkedIn",
    mission: "Job Application Campaign",
    missionId: "3",
    device: "MacBook Pro",
    deviceType: "desktop",
    timestamp: "1 day ago",
    status: "completed",
  },
  {
    id: "5",
    type: "approval",
    icon: "click",
    title: "Viewing Scheduled",
    description: "You approved scheduling a property viewing for Saturday 2pm",
    mission: "Bradenton Rental Search",
    missionId: "1",
    device: "Pixel 8",
    deviceType: "android",
    timestamp: "2 days ago",
    status: "approved",
  },
  {
    id: "6",
    type: "action",
    icon: "document",
    title: "Generated Report",
    description: "Compiled Q4 expenses from receipts and bank statements",
    mission: "Weekly Market Report",
    missionId: "2",
    device: "MacBook Pro",
    deviceType: "desktop",
    timestamp: "3 days ago",
    status: "completed",
  },
]

const iconMap = {
  click: MousePointer,
  email: Mail,
  document: FileText,
  browse: Globe,
}

interface ActivityPanelProps {
  initialFilter?: ActivityFilter
  onFilterChange?: () => void
  showEmptyState?: boolean
}

export function ActivityPanel({ initialFilter = "all", onFilterChange, showEmptyState = false }: ActivityPanelProps) {
  const [filter, setFilter] = useState<ActivityFilter>(initialFilter)
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean
    type: "approve" | "reject"
    itemId: string
  }>({ open: false, type: "approve", itemId: "" })

  useEffect(() => {
    setFilter(initialFilter)
  }, [initialFilter])

  const handleFilterChange = (newFilter: ActivityFilter) => {
    setFilter(newFilter)
    onFilterChange?.()
  }

  const activity = showEmptyState ? [] : mockActivity

  const filteredActivity = activity.filter((item) => {
    if (filter === "all") return true
    if (filter === "actions") return item.type === "action"
    if (filter === "approvals") return item.type === "approval"
    return true
  })

  const pendingCount = activity.filter((item) => item.status === "pending").length

  const handleApprove = (itemId: string) => {
    setConfirmDialog({ open: true, type: "approve", itemId })
  }

  const handleReject = (itemId: string) => {
    setConfirmDialog({ open: true, type: "reject", itemId })
  }

  const handleConfirm = () => {
    // In real app, this would call an API
    console.log(`${confirmDialog.type} item ${confirmDialog.itemId}`)
    setConfirmDialog({ open: false, type: "approve", itemId: "" })
  }

  return (
    <div className="flex h-full flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Activity</h2>
          <p className="text-sm text-muted-foreground">
            {activity.length === 0
              ? "No activity yet"
              : pendingCount > 0
                ? `${pendingCount} pending approval${pendingCount > 1 ? "s" : ""}`
                : "All caught up"}
          </p>
        </div>
        <button className="flex items-center gap-2 rounded-lg border border-border bg-secondary/50 px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground">
          <Calendar className="h-4 w-4" />
          Last 7 days
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-1.5 border-b border-border px-6 py-3">
        {(["all", "actions", "approvals"] as const).map((type) => (
          <button
            key={type}
            onClick={() => handleFilterChange(type)}
            className={cn(
              "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
              filter === type
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-muted-foreground hover:text-foreground",
            )}
          >
            {type.charAt(0).toUpperCase() + type.slice(1)}
            {type === "approvals" && pendingCount > 0 && (
              <span className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-white">
                {pendingCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Activity List */}
      <div className="flex-1 overflow-y-auto p-4">
        {filteredActivity.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-secondary">
              <Activity className="h-8 w-8 text-muted-foreground" />
            </div>
            <div>
              <p className="font-medium text-foreground">No activity yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {activity.length === 0
                  ? "Start a mission or automation to see activity here"
                  : "No items match your current filter"}
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {filteredActivity.map((item) => {
              const Icon = iconMap[item.icon]
              const isPending = item.status === "pending"

              return (
                <div
                  key={item.id}
                  className={cn(
                    "flex gap-3 rounded-lg border p-3 transition-colors",
                    isPending
                      ? "border-amber-500/30 bg-amber-500/5"
                      : "border-border bg-secondary/20 hover:bg-secondary/40",
                  )}
                >
                  {/* Icon */}
                  <div
                    className={cn(
                      "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                      isPending ? "bg-amber-500/10 text-amber-500" : "bg-secondary text-muted-foreground",
                    )}
                  >
                    <Icon className="h-4 w-4" />
                  </div>

                  {/* Content */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="text-sm font-medium text-foreground">{item.title}</h3>
                        <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{item.description}</p>
                      </div>
                      {isPending && (
                        <div className="flex shrink-0 gap-1.5">
                          <button
                            onClick={() => handleApprove(item.id)}
                            className="rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                          >
                            Approve
                          </button>
                          <button
                            onClick={() => handleReject(item.id)}
                            className="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-secondary"
                          >
                            Reject
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Meta */}
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <button className="flex items-center gap-1 rounded-md bg-secondary/50 px-1.5 py-0.5 hover:bg-secondary">
                        {item.mission}
                        <ChevronRight className="h-3 w-3" />
                      </button>
                      <span className="flex items-center gap-1">
                        {item.deviceType === "android" ? (
                          <Smartphone className="h-3 w-3" />
                        ) : (
                          <Monitor className="h-3 w-3" />
                        )}
                        {item.device}
                      </span>
                      <span className="flex items-center gap-1">
                        {item.status === "completed" || item.status === "approved" ? (
                          <CheckCircle className="h-3 w-3 text-green-500" />
                        ) : (
                          <Clock className="h-3 w-3 text-amber-500" />
                        )}
                        {item.timestamp}
                      </span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmDialog.open}
        title={confirmDialog.type === "approve" ? "Approve Action" : "Reject Action"}
        description={
          confirmDialog.type === "approve"
            ? "Are you sure you want to approve this action? The agent will proceed with the task."
            : "Are you sure you want to reject this action? The agent will not proceed."
        }
        confirmLabel={confirmDialog.type === "approve" ? "Approve" : "Reject"}
        confirmVariant={confirmDialog.type === "reject" ? "destructive" : "primary"}
        onConfirm={handleConfirm}
        onCancel={() => setConfirmDialog({ open: false, type: "approve", itemId: "" })}
      />
    </div>
  )
}
