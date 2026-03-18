"use client"

import React from "react"
import { motion } from "framer-motion"
import { cn } from "@/lib/utils"

interface MovingBorderProps {
  children: React.ReactNode
  duration?: number
  className?: string
  containerClassName?: string
  borderClassName?: string
  as?: React.ElementType
}

export function MovingBorder({
  children,
  duration = 2000,
  className,
  containerClassName,
  borderClassName,
  as: Component = "div",
}: MovingBorderProps) {
  return (
    <Component
      className={cn(
        "relative p-[1px] overflow-hidden rounded-lg bg-transparent",
        containerClassName
      )}
    >
      <div
        className={cn(
          "absolute inset-0",
          borderClassName
        )}
        style={{
          background: `linear-gradient(var(--angle, 0deg), var(--accent), transparent, transparent, var(--accent))`,
          animation: `rotate ${duration}ms linear infinite`,
        }}
      />
      <div
        className={cn(
          "relative bg-card rounded-[inherit] z-10",
          className
        )}
      >
        {children}
      </div>
    </Component>
  )
}

// Glow card with hover effect
interface GlowCardProps {
  children: React.ReactNode
  className?: string
}

export function GlowCard({ children, className }: GlowCardProps) {
  return (
    <div className={cn("group relative", className)}>
      <div className="absolute -inset-0.5 bg-gradient-to-r from-accent/50 to-accent/30 rounded-lg blur opacity-0 group-hover:opacity-100 transition duration-500" />
      <div className="relative bg-card border border-border rounded-lg">
        {children}
      </div>
    </div>
  )
}
