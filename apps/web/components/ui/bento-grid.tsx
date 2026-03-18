"use client"

import { motion } from "framer-motion"
import { cn } from "@/lib/utils"

interface BentoGridProps {
  children: React.ReactNode
  className?: string
}

export function BentoGrid({ children, className }: BentoGridProps) {
  return (
    <div className={cn(
      "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4",
      className
    )}>
      {children}
    </div>
  )
}

interface BentoCardProps {
  title: string
  description?: string
  icon?: React.ReactNode
  header?: React.ReactNode
  children?: React.ReactNode
  className?: string
  colSpan?: 1 | 2 | 3
  rowSpan?: 1 | 2
}

export function BentoCard({
  title,
  description,
  icon,
  header,
  children,
  className,
  colSpan = 1,
  rowSpan = 1,
}: BentoCardProps) {
  const colSpanClass = {
    1: "",
    2: "md:col-span-2",
    3: "md:col-span-2 lg:col-span-3",
  }[colSpan]

  const rowSpanClass = {
    1: "",
    2: "row-span-2",
  }[rowSpan]

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      whileHover={{ y: -2 }}
      transition={{ duration: 0.3 }}
      className={cn(
        "group relative overflow-hidden rounded-xl border border-border bg-card p-6",
        "hover:border-accent/30 hover:shadow-lg hover:shadow-accent/5 transition-all duration-300",
        colSpanClass,
        rowSpanClass,
        className
      )}
    >
      {/* Hover gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-br from-accent/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
      
      <div className="relative z-10">
        {header && (
          <div className="mb-4">
            {header}
          </div>
        )}
        
        <div className="flex items-start gap-3">
          {icon && (
            <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-accent/10 border border-accent/20 shrink-0 group-hover:scale-110 transition-transform duration-300">
              {icon}
            </div>
          )}
          <div>
            <h3 className="font-semibold text-foreground mb-1">{title}</h3>
            {description && (
              <p className="text-sm text-muted-foreground leading-relaxed">{description}</p>
            )}
          </div>
        </div>

        {children && (
          <div className="mt-4">
            {children}
          </div>
        )}
      </div>
    </motion.div>
  )
}
