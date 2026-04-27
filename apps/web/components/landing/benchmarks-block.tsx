"use client"

import { motion } from "framer-motion"
import { Activity } from "lucide-react"

// All numbers source: MEMORY.md "Current baseline (v6 Chunk 1, 2026-04-26)"
const benchmarks = [
  { value: "0.969", label: "MRR" },
  { value: "94%", label: "S@1" },
  { value: "100%", label: "S@5" },
  { value: "447ms", label: "Latency" },
]

export function BenchmarksBlock() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5 }}
      className="rounded-xl border border-border bg-card p-5 sm:p-6"
    >
      <div className="flex items-center gap-2 mb-4">
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-accent/10 border border-accent/20">
          <Activity className="h-4 w-4 text-accent" />
        </div>
        <h3 className="text-sm sm:text-base font-semibold">Internal benchmark</h3>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 mb-4">
        {benchmarks.map((b) => (
          <div key={b.label} className="text-center sm:text-left">
            <div className="text-xl sm:text-2xl font-bold tabular-nums">{b.value}</div>
            <div className="text-[11px] sm:text-xs text-muted-foreground mt-0.5">{b.label}</div>
          </div>
        ))}
      </div>
      <p className="text-[11px] sm:text-xs text-muted-foreground leading-relaxed">
        2,310-node test set, v6 Chunk 1 baseline (2026-04-26). CodeSearchNet public-benchmark
        numbers in progress — methodology link will appear here when published.
      </p>
    </motion.div>
  )
}
