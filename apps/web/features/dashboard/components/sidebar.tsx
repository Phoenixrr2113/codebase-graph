"use client"

import { useState, useEffect } from "react"
import {
  Monitor,
  ChevronLeft,
  ChevronRight,
  Settings,
  HelpCircle,
  Zap,
  MessageSquare,
  Target,
  Activity,
  LayoutDashboard,
  RotateCw,
  KeyRound,
  Menu,
  X,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { NotificationsDropdown } from "./notifications-dropdown"
import type { ActiveView } from "./command-center"

interface SidebarProps {
  activeView: ActiveView
  onViewChange: (view: ActiveView) => void
  collapsed: boolean
  onToggleCollapse: () => void
  notificationCount?: number
  activeMissionCount?: number
  activeAutomationCount?: number
  onNotificationsClick?: () => void
}

const navItems = [
  { id: "dashboard" as const, label: "Dashboard", icon: LayoutDashboard },
  { id: "chat" as const, label: "Chat", icon: MessageSquare },
  { id: "missions" as const, label: "Missions", icon: Target },
  { id: "automations" as const, label: "Automations", icon: RotateCw },
  { id: "devices" as const, label: "Devices", icon: Monitor },
  { id: "vault" as const, label: "Vault", icon: KeyRound },
  { id: "activity" as const, label: "Activity", icon: Activity },
]

export function Sidebar({
  activeView,
  onViewChange,
  collapsed,
  onToggleCollapse,
  activeMissionCount = 2,
  activeAutomationCount = 4,
  onNotificationsClick,
}: SidebarProps) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const [showHelpTooltip, setShowHelpTooltip] = useState(false)

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 768) {
        setMobileOpen(false)
      }
    }
    window.addEventListener("resize", handleResize)
    return () => window.removeEventListener("resize", handleResize)
  }, [])

  const handleNavClick = (view: ActiveView) => {
    onViewChange(view)
    setMobileOpen(false)
  }

  const handleNotificationsViewActivity = () => {
    onNotificationsClick?.()
    setMobileOpen(false)
  }

  return (
    <>
      {!mobileOpen && (
        <button
          onClick={() => setMobileOpen(true)}
          className="fixed left-4 top-4 z-40 flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-background text-foreground md:hidden"
        >
          <Menu className="h-5 w-5" />
        </button>
      )}

      {mobileOpen && <div className="fixed inset-0 z-40 bg-black/50 md:hidden" onClick={() => setMobileOpen(false)} />}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex h-full flex-col border-r border-border bg-sidebar transition-all duration-200",
          "md:relative",
          collapsed ? "md:w-16" : "md:w-56",
          mobileOpen ? "w-64 translate-x-0" : "-translate-x-full md:translate-x-0",
        )}
      >
        {/* Logo */}
        <div className="flex h-14 items-center justify-between border-b border-border px-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Zap className="h-4 w-4" />
            </div>
            {(!collapsed || mobileOpen) && (
              <span className={cn("text-sm font-semibold tracking-wide text-foreground", collapsed && "md:hidden")}>
                CONTROLAI
              </span>
            )}
          </div>
          {mobileOpen ? (
            <button
              onClick={() => setMobileOpen(false)}
              className="rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-foreground md:hidden"
            >
              <X className="h-4 w-4" />
            </button>
          ) : (
            <button
              onClick={onToggleCollapse}
              className="hidden rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-foreground md:block"
            >
              {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
            </button>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-1 p-2">
          {navItems.map((item) => {
            const Icon = item.icon
            const isActive = activeView === item.id
            const badge =
              item.id === "missions" ? activeMissionCount : item.id === "automations" ? activeAutomationCount : null

            return (
              <button
                key={item.id}
                onClick={() => handleNavClick(item.id)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {(!collapsed || mobileOpen) && (
                  <span className={cn("flex-1 text-left", collapsed && "md:hidden")}>{item.label}</span>
                )}
                {(!collapsed || mobileOpen) && badge ? (
                  <span
                    className={cn(
                      "flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-bold text-primary-foreground",
                      collapsed && "md:hidden",
                    )}
                  >
                    {badge}
                  </span>
                ) : (!collapsed || mobileOpen) && isActive ? (
                  <div className={cn("h-1.5 w-1.5 rounded-full bg-primary", collapsed && "md:hidden")} />
                ) : null}
              </button>
            )
          })}
        </nav>

        {/* Notifications - Now using dropdown component */}
        <div className="border-t border-border p-2">
          <NotificationsDropdown onViewActivity={handleNotificationsViewActivity} />
        </div>

        {/* Bottom Actions */}
        <div className="space-y-1 border-t border-border p-2">
          <button
            onClick={() => handleNavClick("settings")}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
              activeView === "settings"
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-secondary hover:text-foreground",
            )}
          >
            <Settings className="h-4 w-4 shrink-0" />
            {(!collapsed || mobileOpen) && <span className={cn(collapsed && "md:hidden")}>Settings</span>}
          </button>
          <div className="relative">
            <button
              onClick={() => setShowHelpTooltip(!showHelpTooltip)}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              <HelpCircle className="h-4 w-4 shrink-0" />
              {(!collapsed || mobileOpen) && <span className={cn(collapsed && "md:hidden")}>Help</span>}
            </button>
            {showHelpTooltip && (
              <div className="absolute bottom-full left-0 mb-2 w-48 rounded-lg border border-border bg-card p-3 shadow-lg">
                <p className="mb-2 text-xs text-muted-foreground">Need assistance?</p>
                <a href="mailto:support@controlai.dev" className="mb-1 block text-xs text-primary hover:underline">
                  support@controlai.dev
                </a>
                <a href="#" className="block text-xs text-primary hover:underline">
                  View Documentation
                </a>
              </div>
            )}
          </div>
        </div>
      </aside>
    </>
  )
}
