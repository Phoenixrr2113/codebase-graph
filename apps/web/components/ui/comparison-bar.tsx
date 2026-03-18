"use client"

import { useRef } from "react"
import { motion, useInView } from "framer-motion"
import { cn } from "@/lib/utils"

interface ComparisonItem {
  label: string
  value: number
  color?: string
  highlight?: boolean
}

interface ComparisonBarProps {
  items: ComparisonItem[]
  maxValue?: number
  valueLabel?: string
  className?: string
}

export function ComparisonBar({ 
  items, 
  maxValue, 
  valueLabel = "",
  className 
}: ComparisonBarProps) {
  const ref = useRef<HTMLDivElement>(null)
  const isInView = useInView(ref, { once: true, margin: "-50px" })
  const max = maxValue || Math.max(...items.map(i => i.value))

  return (
    <div ref={ref} className={cn("space-y-4", className)}>
      {items.map((item, i) => {
        const percentage = (item.value / max) * 100

        return (
          <div key={item.label} className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className={cn(
                "font-medium",
                item.highlight ? "text-accent" : "text-foreground"
              )}>
                {item.label}
              </span>
              <span className={cn(
                "font-mono",
                item.highlight ? "text-accent" : "text-muted-foreground"
              )}>
                {item.value.toLocaleString()} {valueLabel}
              </span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={isInView ? { width: `${percentage}%` } : {}}
                transition={{ duration: 1, delay: i * 0.15, ease: "easeOut" }}
                className={cn(
                  "h-full rounded-full",
                  item.highlight 
                    ? "bg-accent" 
                    : item.color 
                      ? item.color 
                      : "bg-muted-foreground/30"
                )}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

interface TokenComparisonProps {
  className?: string
}

export function TokenComparison({ className }: TokenComparisonProps) {
  const items: ComparisonItem[] = [
    { label: "CodeGraph", value: 175301, highlight: true },
    { label: "Azure", value: 67559, color: "bg-blue-500/50" },
    { label: "GCP", value: 42637, color: "bg-yellow-500/50" },
    { label: "AWS", value: 38370, color: "bg-orange-500/50" },
  ]

  return (
    <div className={cn("p-6 rounded-xl border border-border bg-card", className)}>
      <div className="mb-4">
        <h3 className="font-semibold mb-1">Token efficiency per dollar</h3>
        <p className="text-sm text-muted-foreground">More tokens = more context = better results</p>
      </div>
      <ComparisonBar items={items} valueLabel="tokens" />
    </div>
  )
}
