"use client"

import { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { cn } from "@/lib/utils"

interface Tab {
  id: string
  label: string
  icon?: React.ReactNode
  content: React.ReactNode
}

interface AnimatedTabsProps {
  tabs: Tab[]
  className?: string
  contentClassName?: string
}

export function AnimatedTabs({ tabs, className, contentClassName }: AnimatedTabsProps) {
  const [activeTab, setActiveTab] = useState(tabs[0].id)

  return (
    <div className={className}>
      <div className="flex items-center gap-1 p-1 rounded-lg bg-muted/50 border border-border">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "relative px-4 py-2 text-sm font-medium rounded-md transition-colors",
              activeTab === tab.id 
                ? "text-foreground" 
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {activeTab === tab.id && (
              <motion.div
                layoutId="active-tab-bg"
                className="absolute inset-0 bg-background border border-border rounded-md shadow-sm"
                transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
              />
            )}
            <span className="relative z-10 flex items-center gap-2">
              {tab.icon}
              {tab.label}
            </span>
          </button>
        ))}
      </div>

      <div className={cn("mt-4", contentClassName)}>
        <AnimatePresence mode="wait">
          {tabs.map((tab) => 
            tab.id === activeTab ? (
              <motion.div
                key={tab.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
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

interface ProgressTabsProps {
  tabs: Tab[]
  autoProgress?: boolean
  interval?: number
  className?: string
}

export function ProgressTabs({ 
  tabs, 
  autoProgress = true, 
  interval = 5000,
  className 
}: ProgressTabsProps) {
  const [activeIndex, setActiveIndex] = useState(0)
  const [progress, setProgress] = useState(0)

  // Auto-progress effect
  useState(() => {
    if (!autoProgress) return

    const progressInterval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 100) {
          setActiveIndex((idx) => (idx + 1) % tabs.length)
          return 0
        }
        return prev + (100 / (interval / 50))
      })
    }, 50)

    return () => clearInterval(progressInterval)
  })

  return (
    <div className={className}>
      <div className="flex flex-col md:flex-row gap-2">
        {tabs.map((tab, i) => (
          <button
            key={tab.id}
            onClick={() => {
              setActiveIndex(i)
              setProgress(0)
            }}
            className={cn(
              "relative flex-1 p-4 text-left rounded-lg border transition-all",
              i === activeIndex
                ? "bg-card border-accent/50"
                : "bg-transparent border-border hover:border-muted-foreground/30"
            )}
          >
            <div className="flex items-center gap-3">
              {tab.icon && (
                <div className={cn(
                  "flex items-center justify-center w-8 h-8 rounded-lg",
                  i === activeIndex ? "bg-accent/10 text-accent" : "bg-muted text-muted-foreground"
                )}>
                  {tab.icon}
                </div>
              )}
              <span className={cn(
                "font-medium",
                i === activeIndex ? "text-foreground" : "text-muted-foreground"
              )}>
                {tab.label}
              </span>
            </div>
            
            {/* Progress bar */}
            {i === activeIndex && autoProgress && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-muted overflow-hidden rounded-b-lg">
                <motion.div
                  className="h-full bg-accent"
                  initial={{ width: "0%" }}
                  animate={{ width: `${progress}%` }}
                  transition={{ duration: 0.05, ease: "linear" }}
                />
              </div>
            )}
          </button>
        ))}
      </div>

      <div className="mt-6">
        <AnimatePresence mode="wait">
          <motion.div
            key={tabs[activeIndex].id}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.3 }}
          >
            {tabs[activeIndex].content}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}
