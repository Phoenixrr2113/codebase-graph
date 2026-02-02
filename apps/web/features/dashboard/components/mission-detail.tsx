"use client"

import { useState } from "react"
import {
  ArrowLeft,
  Target,
  Activity,
  CheckCircle2,
  AlertCircle,
  Pause,
  XCircle,
  User,
  FileText,
  TrendingUp,
  Calendar,
  Mail,
  Send,
} from "lucide-react"
import { cn } from "@/lib/utils"

interface MissionDetailProps {
  missionId: string
  onBack: () => void
}

interface TimelineEvent {
  id: string
  type: "update" | "action" | "milestone" | "approval_needed" | "user_message"
  content: string
  timestamp: Date
  day: number
  status?: "completed" | "pending"
  icon?: typeof FileText
}

const missionData = {
  id: "1",
  title: "Bradenton Rental Property Search",
  description: "Find rental properties under $250K with positive cash flow potential. Close within 3 months.",
  status: "needs_input" as const,
  progress: 85,
  startDate: new Date(Date.now() - 25 * 24 * 60 * 60 * 1000),
  actionsCompleted: 47,
  totalActions: 55,
  devices: ["MacBook Pro", "iPhone 15"],
}

const timeline: TimelineEvent[] = [
  {
    id: "1",
    type: "update",
    content: "Mission started. Monitoring Zillow, Realtor.com, and Redfin for listings.",
    timestamp: new Date(Date.now() - 25 * 24 * 60 * 60 * 1000),
    day: 0,
    icon: Target,
  },
  {
    id: "2",
    type: "action",
    content:
      "Found 3 properties. Analysis:\n• 4521 Maple Dr - $235K, $287/mo\n• 892 Oak Lane - $242K, $198/mo\n• 1105 Palm Ave - $229K, $312/mo (best)",
    timestamp: new Date(Date.now() - 22 * 24 * 60 * 60 * 1000),
    day: 3,
    status: "completed",
    icon: TrendingUp,
  },
  {
    id: "3",
    type: "update",
    content: "Interest rates dropped 0.25%. Recalculating all analyses.",
    timestamp: new Date(Date.now() - 18 * 24 * 60 * 60 * 1000),
    day: 7,
    icon: TrendingUp,
  },
  {
    id: "4",
    type: "milestone",
    content:
      "New listing: 2847 Sunset Blvd - $238K. New roof, HVAC replaced. Projected cash flow: $412/mo. Significantly better than previous options.",
    timestamp: new Date(Date.now() - 13 * 24 * 60 * 60 * 1000),
    day: 12,
    icon: Target,
  },
  {
    id: "5",
    type: "approval_needed",
    content: "Drafted offer at $232K (3% under asking). Ready to submit.",
    timestamp: new Date(Date.now() - 13 * 24 * 60 * 60 * 1000),
    day: 12,
    status: "completed",
    icon: FileText,
  },
  {
    id: "6",
    type: "user_message",
    content: "This looks great. Submit the offer.",
    timestamp: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
    day: 15,
  },
  {
    id: "7",
    type: "action",
    content: "Offer submitted via Realtor.com. Confirmation received.",
    timestamp: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
    day: 15,
    status: "completed",
    icon: CheckCircle2,
  },
  {
    id: "8",
    type: "action",
    content: "Sent follow-up email to listing agent.",
    timestamp: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
    day: 18,
    status: "completed",
    icon: Mail,
  },
  {
    id: "9",
    type: "milestone",
    content: "Offer accepted at $234K (counter). Documents being prepared.",
    timestamp: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
    day: 23,
    icon: CheckCircle2,
  },
  {
    id: "10",
    type: "action",
    content: "Scheduled inspection for Thursday 2PM. Added to calendar.",
    timestamp: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
    day: 23,
    status: "completed",
    icon: Calendar,
  },
  {
    id: "11",
    type: "approval_needed",
    content: "Inspection is Thursday. Should I coordinate the closing process, or will you handle it?",
    timestamp: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
    day: 24,
    status: "pending",
    icon: AlertCircle,
  },
]

export function MissionDetail({ missionId, onBack }: MissionDetailProps) {
  const [replyInput, setReplyInput] = useState("")
  const daysSinceStart = Math.floor((Date.now() - missionData.startDate.getTime()) / (1000 * 60 * 60 * 24))

  const handleReply = () => {
    if (!replyInput.trim()) return
    setReplyInput("")
  }

  const groupedTimeline = timeline.reduce(
    (acc, event) => {
      if (!acc[event.day]) acc[event.day] = []
      acc[event.day].push(event)
      return acc
    },
    {} as Record<number, TimelineEvent[]>,
  )

  return (
    <div className="flex h-full min-h-0 flex-1 gap-4 overflow-hidden">
      {/* Main Timeline */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-3">
            <button
              onClick={onBack}
              className="rounded-lg p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div>
              <h2 className="font-medium text-foreground">{missionData.title}</h2>
              <p className="text-xs text-muted-foreground">Day {daysSinceStart}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button className="flex items-center gap-1.5 rounded-lg bg-secondary px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">
              <Pause className="h-3.5 w-3.5" />
              Pause
            </button>
            <button className="flex items-center gap-1.5 rounded-lg bg-destructive/10 px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/20">
              <XCircle className="h-3.5 w-3.5" />
              Cancel
            </button>
          </div>
        </div>

        {/* Timeline */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <div className="mx-auto max-w-2xl">
            {Object.entries(groupedTimeline).map(([day, events]) => (
              <div key={day} className="mb-6">
                <div className="mb-3 flex items-center gap-3">
                  <div className="h-px flex-1 bg-border" />
                  <span className="rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                    Day {day}
                  </span>
                  <div className="h-px flex-1 bg-border" />
                </div>

                <div className="space-y-3">
                  {events.map((event) => {
                    const Icon = event.icon || Activity
                    const isUserMessage = event.type === "user_message"
                    const isApproval = event.type === "approval_needed"
                    const isMilestone = event.type === "milestone"
                    const isPending = event.status === "pending"

                    return (
                      <div
                        key={event.id}
                        className={cn("flex gap-2.5", isUserMessage ? "flex-row-reverse" : "flex-row")}
                      >
                        <div
                          className={cn(
                            "flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
                            isUserMessage
                              ? "bg-secondary"
                              : isMilestone
                                ? "bg-primary/20"
                                : isPending
                                  ? "bg-amber-500/20"
                                  : "bg-secondary",
                          )}
                        >
                          {isUserMessage ? (
                            <User className="h-3.5 w-3.5 text-foreground" />
                          ) : (
                            <Icon
                              className={cn(
                                "h-3.5 w-3.5",
                                isMilestone ? "text-primary" : isPending ? "text-amber-500" : "text-muted-foreground",
                              )}
                            />
                          )}
                        </div>

                        <div className={cn("max-w-[85%]", isUserMessage && "text-right")}>
                          <div
                            className={cn(
                              "inline-block rounded-xl px-3 py-2",
                              isUserMessage
                                ? "bg-primary text-primary-foreground"
                                : isMilestone
                                  ? "border border-primary/30 bg-primary/5"
                                  : isPending
                                    ? "border border-amber-500/30 bg-amber-500/5"
                                    : "bg-secondary/50",
                            )}
                          >
                            {isMilestone && (
                              <div className="mb-1 flex items-center gap-1 text-xs font-medium text-primary">
                                <CheckCircle2 className="h-3 w-3" />
                                Milestone
                              </div>
                            )}
                            {isPending && (
                              <div className="mb-1 flex items-center gap-1 text-xs font-medium text-amber-500">
                                <AlertCircle className="h-3 w-3" />
                                Awaiting Input
                              </div>
                            )}
                            <p className="whitespace-pre-wrap text-sm">{event.content}</p>
                          </div>

                          {isPending && (
                            <div className="mt-2 flex gap-2">
                              <button className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90">
                                Yes, proceed
                              </button>
                              <button className="rounded-lg bg-secondary px-3 py-1.5 text-xs font-medium text-foreground hover:bg-secondary/80">
                                I'll handle it
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Reply Input */}
        <div className="shrink-0 border-t border-border p-3">
          <div className="mx-auto max-w-2xl">
            <div className="flex items-end gap-2 rounded-xl border border-border bg-secondary/30 p-2">
              <textarea
                value={replyInput}
                onChange={(e) => setReplyInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault()
                    handleReply()
                  }
                }}
                placeholder="Reply to this mission..."
                className="max-h-24 min-h-[36px] flex-1 resize-none bg-transparent px-1 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
                rows={1}
              />
              <button
                onClick={handleReply}
                disabled={!replyInput.trim()}
                className="shrink-0 rounded-lg bg-primary p-1.5 text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Mission Info Sidebar */}
      <aside className="hidden w-64 shrink-0 space-y-3 overflow-y-auto md:block min-h-0">
        {/* Status */}
        <div className="rounded-xl border border-border bg-card p-4">
          <h3 className="mb-3 text-sm font-medium text-foreground">Status</h3>

          <div className="mb-3">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
              <AlertCircle className="h-3 w-3" />
              Needs Input
            </span>
          </div>

          <div className="mb-3">
            <div className="mb-1 flex justify-between text-xs">
              <span className="text-muted-foreground">Progress</span>
              <span className="text-foreground">{missionData.progress}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
              <div className="h-full rounded-full bg-primary" style={{ width: `${missionData.progress}%` }} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 text-center">
            <div className="rounded-lg bg-secondary/30 p-2">
              <p className="text-lg font-semibold text-foreground">{daysSinceStart}</p>
              <p className="text-xs text-muted-foreground">Days</p>
            </div>
            <div className="rounded-lg bg-secondary/30 p-2">
              <p className="text-lg font-semibold text-foreground">{missionData.actionsCompleted}</p>
              <p className="text-xs text-muted-foreground">Actions</p>
            </div>
          </div>
        </div>

        {/* Devices */}
        <div className="rounded-xl border border-border bg-card p-4">
          <h3 className="mb-3 text-sm font-medium text-foreground">Devices Used</h3>
          <div className="space-y-1.5">
            {missionData.devices.map((device, i) => (
              <div key={i} className="flex items-center gap-2 rounded-lg bg-secondary/30 px-3 py-2">
                <div className="h-1.5 w-1.5 rounded-full bg-green-500" />
                <span className="text-sm text-foreground">{device}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Quick Actions */}
        <div className="rounded-xl border border-border bg-card p-4">
          <h3 className="mb-3 text-sm font-medium text-foreground">Quick Actions</h3>
          <div className="space-y-1.5">
            <button className="flex w-full items-center gap-2 rounded-lg bg-secondary/30 px-3 py-2 text-sm text-foreground hover:bg-secondary">
              <FileText className="h-4 w-4 text-muted-foreground" />
              View documents
            </button>
            <button className="flex w-full items-center gap-2 rounded-lg bg-secondary/30 px-3 py-2 text-sm text-foreground hover:bg-secondary">
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
              Cash flow analysis
            </button>
            <button className="flex w-full items-center gap-2 rounded-lg bg-secondary/30 px-3 py-2 text-sm text-foreground hover:bg-secondary">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              Scheduled events
            </button>
          </div>
        </div>
      </aside>
    </div>
  )
}
