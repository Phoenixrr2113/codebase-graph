"use client"

import { useState, useRef, useEffect } from "react"
import { Bell, CheckCircle2, AlertCircle, Info, X, Target, RotateCw, Clock } from "lucide-react"
import { cn } from "@/lib/utils"

interface Notification {
  id: string
  type: "approval" | "update" | "alert" | "info"
  title: string
  message: string
  source: string
  sourceType: "mission" | "automation"
  timestamp: string
  read: boolean
}

const mockNotifications: Notification[] = [
  {
    id: "1",
    type: "approval",
    title: "Approval Needed",
    message: "Offer letter ready for 4521 Manatee Ave - $242,000",
    source: "Bradenton Rental Search",
    sourceType: "mission",
    timestamp: "2 hours ago",
    read: false,
  },
  {
    id: "2",
    type: "update",
    title: "Mission Update",
    message: "Found 3 new properties matching your criteria",
    source: "Bradenton Rental Search",
    sourceType: "mission",
    timestamp: "5 hours ago",
    read: false,
  },
  {
    id: "3",
    type: "alert",
    title: "Automation Failed",
    message: "Invoice processing failed - authentication error",
    source: "Invoice Processing",
    sourceType: "automation",
    timestamp: "Yesterday",
    read: false,
  },
  {
    id: "4",
    type: "info",
    title: "Weekly Report Ready",
    message: "Your competitor price analysis is complete",
    source: "Competitor Price Monitor",
    sourceType: "automation",
    timestamp: "2 days ago",
    read: true,
  },
]

const typeConfig = {
  approval: { icon: Clock, color: "text-amber-500", bg: "bg-amber-500/10" },
  update: { icon: CheckCircle2, color: "text-primary", bg: "bg-primary/10" },
  alert: { icon: AlertCircle, color: "text-destructive", bg: "bg-destructive/10" },
  info: { icon: Info, color: "text-blue-500", bg: "bg-blue-500/10" },
}

interface NotificationsDropdownProps {
  onViewActivity: () => void
}

export function NotificationsDropdown({ onViewActivity }: NotificationsDropdownProps) {
  const [open, setOpen] = useState(false)
  const [notifications, setNotifications] = useState(mockNotifications)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const unreadCount = notifications.filter((n) => !n.read).length

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  const markAsRead = (id: string) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)))
  }

  const markAllAsRead = () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
  }

  const dismissNotification = (id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id))
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-secondary hover:text-foreground"
      >
        <div className="relative">
          <Bell className="h-4 w-4 shrink-0" />
          {unreadCount > 0 && (
            <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-white">
              {unreadCount}
            </span>
          )}
        </div>
        <span className="md:hidden lg:inline">Notifications</span>
      </button>

      {open && (
        <div className="absolute bottom-full left-0 z-50 mb-2 w-80 rounded-xl border border-border bg-card shadow-lg">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h3 className="font-semibold text-foreground">Notifications</h3>
            {unreadCount > 0 && (
              <button onClick={markAllAsRead} className="text-xs text-primary hover:underline">
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-80 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
                <Bell className="h-8 w-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">No notifications</p>
              </div>
            ) : (
              notifications.map((notification) => {
                const config = typeConfig[notification.type]
                const Icon = config.icon
                const SourceIcon = notification.sourceType === "mission" ? Target : RotateCw

                return (
                  <div
                    key={notification.id}
                    className={cn(
                      "group relative border-b border-border p-3 transition-colors last:border-0",
                      !notification.read && "bg-primary/5",
                    )}
                    onClick={() => markAsRead(notification.id)}
                  >
                    <div className="flex gap-3">
                      <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", config.bg)}>
                        <Icon className={cn("h-4 w-4", config.color)} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-medium text-foreground">{notification.title}</p>
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              dismissNotification(notification.id)
                            }}
                            className="shrink-0 rounded-md p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-secondary hover:text-foreground group-hover:opacity-100"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{notification.message}</p>
                        <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <SourceIcon className="h-3 w-3" />
                            {notification.source}
                          </span>
                          <span>•</span>
                          <span>{notification.timestamp}</span>
                        </div>
                      </div>
                    </div>
                    {!notification.read && (
                      <div className="absolute left-1.5 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-primary" />
                    )}
                  </div>
                )
              })
            )}
          </div>

          <div className="border-t border-border p-2">
            <button
              onClick={() => {
                onViewActivity()
                setOpen(false)
              }}
              className="w-full rounded-lg px-3 py-2 text-center text-sm text-primary hover:bg-primary/10"
            >
              View all activity
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
