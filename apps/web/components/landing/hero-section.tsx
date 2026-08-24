"use client"

import Image from "next/image"
import { motion } from "framer-motion"
import { ArrowRight, BookOpen, Github, ShieldCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Spotlight } from "@/components/ui/spotlight"

const stats = [
  { value: "5", label: "MCP tool groups" },
  { value: "25", label: "actions" },
  { value: "768", label: "local dimensions" },
]

export function HeroSection() {
  return (
    <section id="product" className="relative overflow-hidden px-4 pb-20 pt-28 sm:px-6 sm:pt-36 lg:pb-28">
      <Spotlight className="-top-40 left-0 md:-top-20 md:left-60" fill="hsl(var(--accent))" />
      <div className="absolute inset-0 opacity-25 [background-image:linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] [background-size:36px_36px]" />
      <div className="pointer-events-none absolute inset-0 bg-background [mask-image:radial-gradient(ellipse_at_center,transparent_10%,black_80%)]" />

      <div className="relative z-10 mx-auto max-w-6xl">
        <div className="mx-auto max-w-4xl text-center">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-6 inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent sm:text-sm"
          >
            <ShieldCheck className="size-4" aria-hidden="true" />
            Local-first. Source available. Built for MCP.
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.08 }}
            className="text-balance text-4xl font-semibold tracking-[-0.04em] sm:text-6xl lg:text-7xl"
          >
            Local-first code graph for AI agents and developers.
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.16 }}
            className="mx-auto mt-6 max-w-2xl text-pretty text-base leading-7 text-muted-foreground sm:text-lg"
          >
            CodeGraph indexes supported code structure, relationships, git history, and project knowledge into a queryable graph. Explore it in the dashboard or give an MCP client bounded tools for search, analysis, and recall.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.24 }}
            className="mt-8 flex flex-col justify-center gap-3 sm:flex-row"
          >
            <Button size="lg" className="h-12 bg-accent px-7 text-accent-foreground hover:bg-accent/90" asChild>
              <a href="https://github.com/Phoenixrr2113/codebase-graph" target="_blank" rel="noopener noreferrer">
                <Github className="mr-2 size-4" aria-hidden="true" />
                View source
                <ArrowRight className="ml-2 size-4" aria-hidden="true" />
              </a>
            </Button>
            <Button size="lg" variant="outline" className="h-12 px-7" asChild>
              <a href="https://github.com/Phoenixrr2113/codebase-graph#dashboard-first-in-a-browser" target="_blank" rel="noopener noreferrer">
                <BookOpen className="mr-2 size-4" aria-hidden="true" />
                Read setup
              </a>
            </Button>
          </motion.div>

          <motion.aside
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.35 }}
            className="mx-auto mt-5 max-w-2xl rounded-lg border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-left text-xs leading-5 text-amber-100 sm:text-sm"
            aria-label="Package publication status"
          >
            <strong>Not yet published to npm.</strong> The package is <code>@codegraph/mcp@0.1.0</code>. The <code>npx -y -p @codegraph/mcp codegraph-dashboard</code> and <code>npx -y -p @codegraph/mcp codegraph-mcp</code> commands activate at publication; use the source setup today.
          </motion.aside>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.32, duration: 0.6 }}
          className="mt-12 overflow-hidden rounded-2xl border border-border/80 bg-card/70 p-2 shadow-2xl shadow-accent/5 sm:p-3"
        >
          <Image
            src="/captures/explorer-symbols.jpg"
            alt="CodeGraph dashboard Graph Explorer in Symbols mode, showing the most-connected-first graph window with exact node and edge totals and paging controls"
            width={1800}
            height={1100}
            priority
            className="h-auto w-full rounded-xl border border-border"
          />
        </motion.div>

        <dl className="mx-auto mt-6 grid max-w-2xl grid-cols-3 divide-x divide-border rounded-xl border border-border bg-card/60 py-4">
          {stats.map((stat) => (
            <div key={stat.label} className="px-3 text-center">
              <dd className="text-xl font-semibold tabular-nums text-foreground sm:text-2xl">{stat.value}</dd>
              <dt className="mt-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground sm:text-xs">{stat.label}</dt>
            </div>
          ))}
        </dl>
      </div>
    </section>
  )
}
