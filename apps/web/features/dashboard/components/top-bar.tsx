"use client"

import { useState, useEffect, useRef } from "react"
import {
  Search,
  User,
  Settings,
  LogOut,
  HelpCircle,
  ChevronDown,
  Target,
  Monitor,
  RotateCw,
  X,
  FileText,
  ArrowRight,
} from "lucide-react"
import { cn } from "@/lib/utils"

interface TopBarProps {
  onNavigate?: (view: string) => void
}

export function TopBar({ onNavigate }: TopBarProps) {
  const [showUserDropdown, setShowUserDropdown] = useState(false)
  const [showCommandPalette, setShowCommandPalette] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const dropdownRef = useRef<HTMLDivElement>(null)
  const paletteRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowUserDropdown(false)
      }
      if (paletteRef.current && !paletteRef.current.contains(event.target as Node)) {
        setShowCommandPalette(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "k") {
        event.preventDefault()
        setShowCommandPalette(true)
        setTimeout(() => searchInputRef.current?.focus(), 100)
      }
      if (event.key === "Escape") {
        setShowCommandPalette(false)
        setShowUserDropdown(false)
      }
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [])

  const commandItems = [
    { id: "new-mission", label: "New Mission", icon: Target, shortcut: "M", action: () => onNavigate?.("missions") },
    {
      id: "new-automation",
      label: "New Automation",
      icon: RotateCw,
      shortcut: "A",
      action: () => onNavigate?.("automations"),
    },
    { id: "devices", label: "Go to Devices", icon: Monitor, action: () => onNavigate?.("devices") },
    { id: "settings", label: "Open Settings", icon: Settings, action: () => onNavigate?.("settings") },
    { id: "docs", label: "View Documentation", icon: FileText, action: () => window.open("#", "_blank") },
  ]

  const filteredCommands = commandItems.filter((item) => item.label.toLowerCase().includes(searchQuery.toLowerCase()))

  const handleCommandSelect = (action: () => void) => {
    action()
    setShowCommandPalette(false)
    setSearchQuery("")
  }

  return (
    <>
      <header className="flex h-14 items-center justify-between border-b border-border bg-card/50 px-6">
        {/* Search - Opens command palette */}
        <div className="flex items-center gap-4">
          <button
            onClick={() => {
              setShowCommandPalette(true)
              setTimeout(() => searchInputRef.current?.focus(), 100)
            }}
            className="relative flex items-center"
          >
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <div className="flex h-9 w-72 items-center rounded-lg border border-border bg-secondary pl-10 pr-4 text-sm text-muted-foreground">
              Search or jump to...
            </div>
            <kbd className="absolute right-3 top-1/2 -translate-y-1/2 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              ⌘K
            </kbd>
          </button>
        </div>

        {/* User Profile - Added dropdown */}
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setShowUserDropdown(!showUserDropdown)}
            className="flex items-center gap-3 rounded-lg p-1.5 transition-colors hover:bg-secondary"
          >
            <div className="text-right">
              <p className="text-sm font-medium text-foreground">Demo User</p>
              <p className="text-xs text-muted-foreground">Pro Plan</p>
            </div>
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/20 text-primary">
              <User className="h-5 w-5" />
            </div>
            <ChevronDown
              className={cn("h-4 w-4 text-muted-foreground transition-transform", showUserDropdown && "rotate-180")}
            />
          </button>

          {showUserDropdown && (
            <div className="absolute right-0 top-full z-50 mt-2 w-56 rounded-xl border border-border bg-card p-2 shadow-lg">
              <div className="border-b border-border px-3 py-2">
                <p className="text-sm font-medium text-foreground">Demo User</p>
                <p className="text-xs text-muted-foreground">demo@controlai.dev</p>
              </div>
              <div className="py-1">
                <button
                  onClick={() => {
                    onNavigate?.("settings")
                    setShowUserDropdown(false)
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-secondary hover:text-foreground"
                >
                  <Settings className="h-4 w-4" />
                  Settings
                </button>
                <button className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-secondary hover:text-foreground">
                  <HelpCircle className="h-4 w-4" />
                  Help & Support
                </button>
              </div>
              <div className="border-t border-border pt-1">
                <button className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-destructive hover:bg-destructive/10">
                  <LogOut className="h-4 w-4" />
                  Log out
                </button>
              </div>
            </div>
          )}
        </div>
      </header>

      {showCommandPalette && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-[20vh]">
          <div ref={paletteRef} className="w-full max-w-lg rounded-xl border border-border bg-card shadow-2xl">
            <div className="flex items-center gap-3 border-b border-border px-4 py-3">
              <Search className="h-5 w-5 text-muted-foreground" />
              <input
                ref={searchInputRef}
                type="text"
                placeholder="Search commands..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
              />
              <button
                onClick={() => {
                  setShowCommandPalette(false)
                  setSearchQuery("")
                }}
                className="rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="max-h-80 overflow-y-auto p-2">
              {filteredCommands.length === 0 ? (
                <p className="px-3 py-6 text-center text-sm text-muted-foreground">No commands found</p>
              ) : (
                filteredCommands.map((item) => {
                  const Icon = item.icon
                  return (
                    <button
                      key={item.id}
                      onClick={() => handleCommandSelect(item.action)}
                      className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors hover:bg-secondary"
                    >
                      <Icon className="h-4 w-4 text-muted-foreground" />
                      <span className="flex-1 text-foreground">{item.label}</span>
                      {item.shortcut && (
                        <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                          ⌘{item.shortcut}
                        </kbd>
                      )}
                      <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100" />
                    </button>
                  )
                })
              )}
            </div>
            <div className="border-t border-border px-4 py-2">
              <p className="text-xs text-muted-foreground">
                <kbd className="rounded border border-border bg-muted px-1 py-0.5 text-[10px]">↑↓</kbd> to navigate{" "}
                <kbd className="ml-2 rounded border border-border bg-muted px-1 py-0.5 text-[10px]">↵</kbd> to select{" "}
                <kbd className="ml-2 rounded border border-border bg-muted px-1 py-0.5 text-[10px]">esc</kbd> to close
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
