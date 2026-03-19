"use client"

import { motion } from "framer-motion"
import { Zap, RefreshCw, Search, Target } from "lucide-react"

const highlights = [
  {
    icon: Zap,
    metric: "Seconds",
    label: "to index",
    description: "Full codebase indexing in seconds, not minutes",
  },
  {
    icon: RefreshCw,
    metric: "Instant",
    label: "incremental updates",
    description: "Only changed files re-indexed on save",
  },
  {
    icon: Search,
    metric: "Sub-second",
    label: "queries",
    description: "Fast responses, even for complex searches",
  },
  {
    icon: Target,
    metric: "93%+",
    label: "accuracy",
    description: "Industry-leading accuracy with AI-powered reranking",
  },
]

const scalingInfo = [
  { size: "Small projects", files: "~300 files", indexTime: "Seconds", queryTime: "Instant" },
  { size: "Medium projects", files: "~1,000 files", indexTime: "Under a minute", queryTime: "Instant" },
  { size: "Large monorepos", files: "5,000+ files", indexTime: "A few minutes", queryTime: "Sub-second" },
]

export function PerformanceSection() {
  return (
    <section className="py-16 sm:py-20 md:py-24 px-4 sm:px-6 bg-muted/30">
      <div className="max-w-5xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center mb-10 sm:mb-12"
        >
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold mb-3 sm:mb-4">
            Fast enough for real-time
          </h2>
          <p className="text-sm sm:text-base text-muted-foreground max-w-2xl mx-auto">
            CodeGraph is optimized for developer workflows. Index once, query instantly, update incrementally.
          </p>
        </motion.div>

        {/* Highlight Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-10 sm:mb-16">
          {highlights.map((item, i) => {
            const Icon = item.icon
            return (
              <motion.div
                key={item.label}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.1 }}
                whileHover={{ scale: 1.02 }}
                className="group relative overflow-hidden rounded-xl border border-border bg-card p-4 sm:p-6 text-center hover:border-accent/30 transition-all"
              >
                <div className="absolute inset-0 bg-gradient-to-br from-accent/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                <div className="relative z-10">
                  <div className="flex items-center justify-center w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-accent/10 mx-auto mb-3 sm:mb-4">
                    <Icon className="h-5 w-5 sm:h-6 sm:w-6 text-accent" />
                  </div>
                  <div className="text-xl sm:text-2xl md:text-3xl font-bold text-accent mb-1">
                    {item.metric}
                  </div>
                  <div className="font-medium text-xs sm:text-sm mb-1">{item.label}</div>
                  <div className="text-[10px] sm:text-xs text-muted-foreground line-clamp-2">{item.description}</div>
                </div>
              </motion.div>
            )
          })}
        </div>

        {/* Scaling Info */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="p-4 sm:p-6 rounded-xl border border-border bg-card"
        >
          <h3 className="font-semibold text-sm sm:text-base mb-3 sm:mb-4">Scales with your codebase</h3>
          <div className="overflow-x-auto no-visible-scrollbar -mx-4 px-4 sm:mx-0 sm:px-0">
            <table className="w-full text-xs sm:text-sm min-w-[320px]">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 text-muted-foreground font-medium">Project Size</th>
                  <th className="text-left py-2 text-muted-foreground font-medium">Files</th>
                  <th className="text-left py-2 text-muted-foreground font-medium">Initial Index</th>
                  <th className="text-left py-2 text-muted-foreground font-medium">Queries</th>
                </tr>
              </thead>
              <tbody>
                {scalingInfo.map((row, i) => (
                  <tr key={row.size} className={i < scalingInfo.length - 1 ? "border-b border-border/50" : ""}>
                    <td className="py-2 font-medium">{row.size}</td>
                    <td className="py-2 text-muted-foreground">{row.files}</td>
                    <td className="py-2 text-accent">{row.indexTime}</td>
                    <td className="py-2 text-foreground">{row.queryTime}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </motion.div>

        <motion.p
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.3 }}
          className="mt-6 sm:mt-8 text-xs sm:text-sm text-muted-foreground text-center max-w-3xl mx-auto"
        >
          Performance varies based on hardware and codebase complexity. These are typical results on modern developer machines.
        </motion.p>
      </div>
    </section>
  )
}
