"use client"

import {
  Target,
  Monitor,
  Clock,
  CheckCircle2,
  Zap,
  ArrowUpRight,
  Sparkles,
  ArrowRight,
  Bot,
  RotateCw,
  Play,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Area, AreaChart, Bar, BarChart, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts"

const activityData = [
  { day: "Mon", actions: 24 },
  { day: "Tue", actions: 18 },
  { day: "Wed", actions: 42 },
  { day: "Thu", actions: 35 },
  { day: "Fri", actions: 28 },
  { day: "Sat", actions: 12 },
  { day: "Sun", actions: 8 },
]

const missionProgressData = [
  { week: "W1", completed: 2, active: 3 },
  { week: "W2", completed: 4, active: 2 },
  { week: "W3", completed: 3, active: 4 },
  { week: "W4", completed: 5, active: 2 },
]

const recentMissions = [
  {
    id: "1",
    name: "Find rental properties in Bradenton",
    status: "active",
    progress: 65,
    lastUpdate: "2 hours ago",
  },
  {
    id: "2",
    name: "Apply to React developer jobs",
    status: "active",
    progress: 40,
    lastUpdate: "5 hours ago",
  },
  {
    id: "3",
    name: "Monitor competitor pricing",
    status: "completed",
    progress: 100,
    lastUpdate: "Yesterday",
  },
]

const recentAutomations = [
  {
    id: "1",
    name: "Daily Email Summary",
    status: "active",
    lastRun: "Today 8:00 AM",
    nextRun: "Tomorrow 8:00 AM",
  },
  {
    id: "2",
    name: "Lead Research & Outreach",
    status: "active",
    lastRun: "2 hours ago",
    nextRun: "On new lead",
  },
  {
    id: "3",
    name: "Weekly Report Generator",
    status: "active",
    lastRun: "Friday",
    nextRun: "This Friday",
  },
]

const connectedDevices = [
  { name: "MacBook Pro", type: "desktop", status: "online" },
  { name: "Pixel 7", type: "android", status: "online" },
  { name: "Windows Workstation", type: "desktop", status: "offline" },
]

interface DashboardPanelProps {
  onNavigate?: (page: string) => void
}

export function DashboardPanel({ onNavigate }: DashboardPanelProps) {
  return (
    <div className="flex h-full flex-col gap-4 overflow-x-hidden overflow-y-auto px-1 pt-12 md:gap-6 md:px-0 md:pt-0">
      {/* Hero Banner */}
      <div className="relative min-w-0 rounded-xl border border-primary/20 bg-gradient-to-br from-primary/10 via-background to-blue-500/5 p-4 md:rounded-2xl md:p-6">
        {/* Background decoration - hidden on mobile to avoid overflow issues */}
        <div className="absolute -right-20 -top-20 hidden h-64 w-64 rounded-full bg-primary/5 blur-3xl md:block" />
        <div className="absolute -bottom-10 -left-10 hidden h-40 w-40 rounded-full bg-blue-500/5 blur-2xl md:block" />

        <div className="relative flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0 flex-1">
            <div className="mb-2 flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/20">
                <Bot className="h-4 w-4 text-primary" />
              </div>
              <span className="text-xs font-medium uppercase tracking-wider text-primary">Agent Status: Online</span>
            </div>
            <h1 className="mb-1 text-xl font-bold text-foreground md:text-2xl">Good evening, Marcus</h1>
            <p className="text-sm text-muted-foreground md:text-base">
              Your AI agent is actively working on <span className="font-medium text-primary">2 missions</span> and
              running <span className="font-medium text-primary">4 automations</span>. You've saved{" "}
              <span className="font-medium text-primary">18.5 hours</span> this week.
            </p>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
              <Button
                className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
                onClick={() => onNavigate?.("chat")}
              >
                <Sparkles className="h-4 w-4" />
                Start New Mission
              </Button>
              <Button
                variant="outline"
                className="gap-2 border-border bg-transparent hover:bg-secondary"
                onClick={() => onNavigate?.("missions")}
              >
                View Active Missions
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Quick Stats in Banner - hidden on mobile/tablet */}
          <div className="hidden items-center gap-6 xl:flex">
            <div className="text-center">
              <div className="text-3xl font-bold text-foreground">167</div>
              <div className="text-xs text-muted-foreground">Actions Today</div>
            </div>
            <div className="h-12 w-px bg-border" />
            <div className="text-center">
              <div className="text-3xl font-bold text-primary">98%</div>
              <div className="text-xs text-muted-foreground">Success Rate</div>
            </div>
            <div className="h-12 w-px bg-border" />
            <div className="text-center">
              <div className="text-3xl font-bold text-foreground">2/3</div>
              <div className="text-xs text-muted-foreground">Devices Online</div>
            </div>
          </div>
        </div>
      </div>

      {/* Stats Cards - Responsive grid */}
      <div className="grid min-w-0 grid-cols-2 gap-2 sm:gap-3 md:gap-4 lg:grid-cols-5">
        <Card className="border-border bg-card transition-colors hover:border-primary/30">
          <CardContent className="p-3 md:p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground">Active Missions</p>
                <p className="mt-1 text-xl font-bold text-foreground md:text-2xl">2</p>
              </div>
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 md:h-10 md:w-10 md:rounded-xl">
                <Target className="h-4 w-4 text-primary md:h-5 md:w-5" />
              </div>
            </div>
            <div className="mt-2 hidden items-center gap-1 text-xs sm:flex">
              <ArrowUpRight className="h-3 w-3 text-primary" />
              <span className="text-primary">+1</span>
              <span className="text-muted-foreground">from last week</span>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border bg-card transition-colors hover:border-purple-500/30">
          <CardContent className="p-3 md:p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground">Automations</p>
                <p className="mt-1 text-xl font-bold text-foreground md:text-2xl">4</p>
              </div>
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-500/10 md:h-10 md:w-10 md:rounded-xl">
                <RotateCw className="h-4 w-4 text-purple-500 md:h-5 md:w-5" />
              </div>
            </div>
            <div className="mt-2 hidden items-center gap-1 text-xs sm:flex">
              <span className="text-muted-foreground">47 runs this week</span>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border bg-card transition-colors hover:border-blue-500/30">
          <CardContent className="p-3 md:p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground">Devices Online</p>
                <p className="mt-1 text-xl font-bold text-foreground md:text-2xl">2/3</p>
              </div>
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/10 md:h-10 md:w-10 md:rounded-xl">
                <Monitor className="h-4 w-4 text-blue-500 md:h-5 md:w-5" />
              </div>
            </div>
            <div className="mt-2 hidden items-center gap-1 text-xs sm:flex">
              <span className="text-muted-foreground">1 device offline</span>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border bg-card transition-colors hover:border-amber-500/30">
          <CardContent className="p-3 md:p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground">Actions</p>
                <p className="mt-1 text-xl font-bold text-foreground md:text-2xl">167</p>
              </div>
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/10 md:h-10 md:w-10 md:rounded-xl">
                <Zap className="h-4 w-4 text-amber-500 md:h-5 md:w-5" />
              </div>
            </div>
            <div className="mt-2 hidden items-center gap-1 text-xs sm:flex">
              <ArrowUpRight className="h-3 w-3 text-primary" />
              <span className="text-primary">+23%</span>
            </div>
          </CardContent>
        </Card>

        <Card className="col-span-2 border-border bg-card transition-colors hover:border-emerald-500/30 lg:col-span-1">
          <CardContent className="p-3 md:p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground">Time Saved</p>
                <p className="mt-1 text-xl font-bold text-foreground md:text-2xl">18.5h</p>
              </div>
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10 md:h-10 md:w-10 md:rounded-xl">
                <Clock className="h-4 w-4 text-emerald-500 md:h-5 md:w-5" />
              </div>
            </div>
            <div className="mt-2 hidden items-center gap-1 text-xs sm:flex">
              <ArrowUpRight className="h-3 w-3 text-primary" />
              <span className="text-primary">+4.2h</span>
              <span className="text-muted-foreground">from last week</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts Row - Stack on mobile */}
      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="border-border bg-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-foreground">Agent Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-40 md:h-48">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={activityData}>
                  <defs>
                    <linearGradient id="activityGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(142, 76%, 36%)" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="hsl(142, 76%, 36%)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(0, 0%, 20%)" />
                  <XAxis
                    dataKey="day"
                    tick={{ fill: "hsl(0, 0%, 50%)", fontSize: 12 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis tick={{ fill: "hsl(0, 0%, 50%)", fontSize: 12 }} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(0, 0%, 10%)",
                      border: "1px solid hsl(0, 0%, 20%)",
                      borderRadius: "8px",
                      color: "white",
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="actions"
                    stroke="hsl(142, 76%, 36%)"
                    fill="url(#activityGradient)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border bg-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-foreground">Mission Completion</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-40 md:h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={missionProgressData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(0, 0%, 20%)" />
                  <XAxis
                    dataKey="week"
                    tick={{ fill: "hsl(0, 0%, 50%)", fontSize: 12 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis tick={{ fill: "hsl(0, 0%, 50%)", fontSize: 12 }} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(0, 0%, 10%)",
                      border: "1px solid hsl(0, 0%, 20%)",
                      borderRadius: "8px",
                      color: "white",
                    }}
                  />
                  <Bar dataKey="completed" fill="hsl(142, 76%, 36%)" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="active" fill="hsl(217, 91%, 60%)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Bottom Row - Stack on mobile/tablet */}
      <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {/* Recent Missions */}
        <Card className="border-border bg-card">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-foreground">Recent Missions</CardTitle>
            <Button
              variant="ghost"
              size="sm"
              className="h-auto p-0 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => onNavigate?.("missions")}
            >
              View all
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {recentMissions.map((mission) => (
              <div
                key={mission.id}
                className="flex cursor-pointer items-center gap-3 rounded-lg p-2 transition-colors hover:bg-secondary/50"
              >
                <div
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                    mission.status === "completed" ? "bg-primary/10" : "bg-blue-500/10"
                  }`}
                >
                  {mission.status === "completed" ? (
                    <CheckCircle2 className="h-4 w-4 text-primary" />
                  ) : (
                    <Target className="h-4 w-4 text-blue-500" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{mission.name}</p>
                  <p className="text-xs text-muted-foreground">{mission.lastUpdate}</p>
                </div>
                {mission.status === "active" && (
                  <div className="hidden items-center gap-2 sm:flex">
                    <div className="h-1.5 w-12 rounded-full bg-secondary">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${mission.progress}%` }} />
                    </div>
                    <span className="text-xs text-muted-foreground">{mission.progress}%</span>
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Recent Automations */}
        <Card className="border-border bg-card">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-foreground">Active Automations</CardTitle>
            <Button
              variant="ghost"
              size="sm"
              className="h-auto p-0 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => onNavigate?.("automations")}
            >
              View all
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {recentAutomations.map((automation) => (
              <div
                key={automation.id}
                className="flex cursor-pointer items-center gap-3 rounded-lg p-2 transition-colors hover:bg-secondary/50"
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-purple-500/10">
                  <Play className="h-4 w-4 text-purple-500" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{automation.name}</p>
                  <p className="text-xs text-muted-foreground">Next: {automation.nextRun}</p>
                </div>
                <div className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-primary" />
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Connected Devices */}
        <Card className="border-border bg-card md:col-span-2 lg:col-span-1">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-foreground">Connected Devices</CardTitle>
            <Button
              variant="ghost"
              size="sm"
              className="h-auto p-0 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => onNavigate?.("devices")}
            >
              Manage
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {connectedDevices.map((device, index) => (
              <div
                key={index}
                className="flex cursor-pointer items-center gap-3 rounded-lg p-2 transition-colors hover:bg-secondary/50"
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-secondary">
                  <Monitor className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{device.name}</p>
                  <p className="text-xs capitalize text-muted-foreground">{device.type}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <div
                    className={`h-2 w-2 rounded-full ${
                      device.status === "online" ? "bg-primary" : "bg-muted-foreground"
                    }`}
                  />
                  <span
                    className={`text-xs capitalize ${
                      device.status === "online" ? "text-primary" : "text-muted-foreground"
                    }`}
                  >
                    {device.status}
                  </span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
