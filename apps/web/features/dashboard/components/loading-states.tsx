"use client"

import { Skeleton } from "@/components/ui/skeleton"

export function DashboardSkeleton() {
  return (
    <div className="flex h-full flex-col gap-4 md:gap-6">
      {/* Hero skeleton */}
      <Skeleton className="h-40 w-full rounded-xl md:h-48" />

      {/* Stats grid skeleton */}
      <div className="grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-3 lg:grid-cols-5">
        {[...Array(5)].map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-lg" />
        ))}
      </div>

      {/* Charts skeleton */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-64 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>

      {/* Bottom cards skeleton */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-48 rounded-xl" />
        <Skeleton className="h-48 rounded-xl" />
        <Skeleton className="h-48 rounded-xl" />
      </div>
    </div>
  )
}

export function MissionsSkeleton() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <div>
          <Skeleton className="h-6 w-24" />
          <Skeleton className="mt-1 h-4 w-16" />
        </div>
        <Skeleton className="h-9 w-32" />
      </div>
      <div className="flex gap-3 border-b border-border px-6 py-3">
        <Skeleton className="h-9 w-48" />
        <div className="flex gap-1.5">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-8 w-20 rounded-lg" />
          ))}
        </div>
      </div>
      <div className="flex-1 space-y-3 p-4">
        {[...Array(4)].map((_, i) => (
          <Skeleton key={i} className="h-36 rounded-xl" />
        ))}
      </div>
    </div>
  )
}

export function DevicesSkeleton() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <div>
          <Skeleton className="h-6 w-20" />
          <Skeleton className="mt-1 h-4 w-24" />
        </div>
        <Skeleton className="h-9 w-36" />
      </div>
      <div className="flex-1 p-4">
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-40 rounded-lg" />
          ))}
        </div>
      </div>
    </div>
  )
}

export function ChatSkeleton() {
  return (
    <div className="flex h-full flex-col rounded-xl border border-border bg-card">
      <div className="flex items-center gap-3 border-b border-border p-4">
        <Skeleton className="h-10 w-10 rounded-full" />
        <div>
          <Skeleton className="h-5 w-32" />
          <Skeleton className="mt-1 h-3 w-16" />
        </div>
      </div>
      <div className="flex-1 space-y-4 p-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="flex gap-3">
            <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
            <Skeleton className="h-20 w-3/4 rounded-lg" />
          </div>
        ))}
      </div>
      <div className="border-t border-border p-4">
        <Skeleton className="h-12 w-full rounded-lg" />
      </div>
    </div>
  )
}

export function ActivitySkeleton() {
  return (
    <div className="flex h-full flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <div>
          <Skeleton className="h-6 w-20" />
          <Skeleton className="mt-1 h-4 w-32" />
        </div>
        <Skeleton className="h-8 w-28" />
      </div>
      <div className="flex gap-1.5 border-b border-border px-6 py-3">
        {[...Array(3)].map((_, i) => (
          <Skeleton key={i} className="h-8 w-24 rounded-lg" />
        ))}
      </div>
      <div className="flex-1 space-y-2 p-4">
        {[...Array(6)].map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-lg" />
        ))}
      </div>
    </div>
  )
}
