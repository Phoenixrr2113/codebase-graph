"use client"

import { useState, useEffect, useRef } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { cn } from "@/lib/utils"

interface PuzzleTab {
  id: string
  label: string
  icon: React.ReactNode
  content: React.ReactNode
  color?: string
}

interface PuzzleTabsProps {
  tabs: PuzzleTab[]
  className?: string
  autoRotate?: boolean
  rotateInterval?: number
}

export function PuzzleTabs({ 
  tabs, 
  className,
  autoRotate = false,
  rotateInterval = 5000
}: PuzzleTabsProps) {
  const [activeTab, setActiveTab] = useState(tabs[0].id)
  const [progress, setProgress] = useState(0)
  const intervalRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    if (!autoRotate) return

    intervalRef.current = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 100) {
          const currentIndex = tabs.findIndex(t => t.id === activeTab)
          const nextIndex = (currentIndex + 1) % tabs.length
          setActiveTab(tabs[nextIndex].id)
          return 0
        }
        return prev + (100 / (rotateInterval / 50))
      })
    }, 50)

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [autoRotate, rotateInterval, activeTab, tabs])

  const handleTabClick = (tabId: string) => {
    setActiveTab(tabId)
    setProgress(0)
  }

  return (
    <div className={className}>
      {/* Puzzle-piece style tabs */}
      <div className="flex flex-wrap justify-center gap-2 md:gap-3" role="tablist" aria-label="Configuration options">
        {tabs.map((tab, index) => {
          const isActive = activeTab === tab.id
          const prevActive = tabs.findIndex(t => t.id === activeTab) === index - 1
          const nextActive = tabs.findIndex(t => t.id === activeTab) === index + 1
          
          return (
            <motion.button
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              aria-controls={`tabpanel-${tab.id}`}
              onClick={() => handleTabClick(tab.id)}
              whileHover={{ scale: 1.02, y: -2 }}
              whileTap={{ scale: 0.98 }}
              className={cn(
                "relative flex items-center gap-2 px-4 py-2.5 md:px-5 md:py-3 rounded-xl text-sm font-medium transition-all duration-300",
                "border-2",
                isActive
                  ? "bg-accent/15 border-accent text-accent shadow-lg shadow-accent/20"
                  : "bg-card/50 border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground/50",
                prevActive && "md:-ml-2",
                nextActive && "md:-mr-2"
              )}
            >
              {/* Icon container with glow effect */}
              <span className={cn(
                "flex items-center justify-center w-7 h-7 rounded-lg transition-all duration-300",
                isActive 
                  ? "bg-accent/20 text-accent" 
                  : "bg-muted text-muted-foreground"
              )}>
                {tab.icon}
              </span>
              
              <span className="text-xs sm:text-sm truncate max-w-[60px] sm:max-w-none">{tab.label}</span>
              
              {/* Active indicator dot */}
              {isActive && (
                <motion.div
                  layoutId="puzzle-active-dot"
                  className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-accent"
                  transition={{ type: "spring", bounce: 0.3, duration: 0.5 }}
                />
              )}

              {/* Progress bar for auto-rotate */}
              {isActive && autoRotate && (
                <div className="absolute bottom-0 left-2 right-2 h-0.5 bg-accent/20 rounded-full overflow-hidden">
                  <motion.div
                    className="h-full bg-accent"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              )}
            </motion.button>
          )
        })}
      </div>

      {/* Tab content */}
      <div className="mt-6 md:mt-8">
        <AnimatePresence mode="wait">
          {tabs.map((tab) =>
            tab.id === activeTab ? (
              <motion.div
                key={tab.id}
                id={`tabpanel-${tab.id}`}
                role="tabpanel"
                aria-labelledby={`tab-${tab.id}`}
                initial={{ opacity: 0, y: 15, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -15, scale: 0.98 }}
                transition={{ duration: 0.3, ease: "easeOut" }}
              >
                {tab.content}
              </motion.div>
            ) : null
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

// Alternative horizontal card-style tabs (like Mastra's feature cards)
interface CardTab {
  id: string
  label: string
  description: string
  icon: React.ReactNode
  content: React.ReactNode
}

interface CardTabsProps {
  tabs: CardTab[]
  className?: string
}

export function CardTabs({ tabs, className }: CardTabsProps) {
  const [activeTab, setActiveTab] = useState(tabs[0].id)
  const [hoveredTab, setHoveredTab] = useState<string | null>(null)

  return (
    <div className={cn("grid lg:grid-cols-[1fr_1.5fr] gap-6", className)}>
      {/* Tab cards column */}
      <div className="flex flex-row lg:flex-col gap-2 overflow-x-auto pb-2 lg:pb-0 lg:overflow-visible no-visible-scrollbar">
        {tabs.map((tab, index) => {
          const isActive = activeTab === tab.id
          const isHovered = hoveredTab === tab.id
          
          return (
            <motion.button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              onMouseEnter={() => setHoveredTab(tab.id)}
              onMouseLeave={() => setHoveredTab(null)}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.3, delay: index * 0.05 }}
              className={cn(
                "relative flex-shrink-0 lg:flex-shrink flex items-start gap-3 p-4 rounded-xl text-left transition-all duration-300",
                "border-2 min-w-[200px] lg:min-w-0",
                isActive
                  ? "bg-accent/10 border-accent"
                  : isHovered
                    ? "bg-muted/50 border-muted-foreground/30"
                    : "bg-card/30 border-border hover:bg-muted/30"
              )}
            >
              {/* Connecting line indicator */}
              {isActive && (
                <motion.div
                  layoutId="card-tab-connector"
                  className="hidden lg:block absolute right-0 top-1/2 -translate-y-1/2 translate-x-full w-6 h-0.5 bg-accent"
                  transition={{ type: "spring", bounce: 0.2, duration: 0.5 }}
                />
              )}

              <div className={cn(
                "flex items-center justify-center w-10 h-10 rounded-lg shrink-0 transition-colors",
                isActive 
                  ? "bg-accent/20 text-accent" 
                  : "bg-muted text-muted-foreground"
              )}>
                {tab.icon}
              </div>
              
              <div className="min-w-0">
                <h4 className={cn(
                  "font-semibold text-sm transition-colors truncate",
                  isActive ? "text-foreground" : "text-muted-foreground"
                )}>
                  {tab.label}
                </h4>
                <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2 hidden lg:block">
                  {tab.description}
                </p>
              </div>
            </motion.button>
          )
        })}
      </div>

      {/* Content panel */}
      <div className="relative">
        {/* Connecting border */}
        <div className="hidden lg:block absolute left-0 top-0 bottom-0 w-px bg-border" />
        
        <AnimatePresence mode="wait">
          {tabs.map((tab) =>
            tab.id === activeTab ? (
              <motion.div
                key={tab.id}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.25 }}
                className="lg:pl-6"
              >
                {tab.content}
              </motion.div>
            ) : null
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
