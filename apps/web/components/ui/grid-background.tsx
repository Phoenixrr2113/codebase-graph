"use client"

import { cn } from "@/lib/utils"

interface GridBackgroundProps {
  children?: React.ReactNode
  className?: string
  containerClassName?: string
}

export function GridBackground({
  children,
  className,
  containerClassName,
}: GridBackgroundProps) {
  return (
    <div
      className={cn(
        "relative flex w-full items-center justify-center bg-background",
        containerClassName
      )}
    >
      <div
        className={cn(
          "absolute inset-0",
          "[background-size:40px_40px]",
          "[background-image:linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)]",
          className
        )}
      />
      {/* Radial fade */}
      <div className="pointer-events-none absolute inset-0 bg-background [mask-image:radial-gradient(ellipse_at_center,transparent_20%,black)]" />
      {children}
    </div>
  )
}

export function DotBackground({
  children,
  className,
  containerClassName,
}: GridBackgroundProps) {
  return (
    <div
      className={cn(
        "relative flex w-full items-center justify-center bg-background",
        containerClassName
      )}
    >
      <div
        className={cn(
          "absolute inset-0",
          "[background-size:20px_20px]",
          "[background-image:radial-gradient(var(--border)_1px,transparent_1px)]",
          className
        )}
      />
      <div className="pointer-events-none absolute inset-0 bg-background [mask-image:radial-gradient(ellipse_at_center,transparent_20%,black)]" />
      {children}
    </div>
  )
}
