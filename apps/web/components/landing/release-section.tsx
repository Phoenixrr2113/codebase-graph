"use client"

import { motion } from "framer-motion"
import { Box, CheckCircle2, Snowflake } from "lucide-react"

const checks = [
  {
    icon: Box,
    title: "Exact artifact",
    copy: "The release gate installs the exact npm tarball it plans to publish, then records and rechecks its SHA-256 instead of testing workspace source in its place.",
  },
  {
    icon: CheckCircle2,
    title: "Installed-package matrix",
    copy: "25 installed-package assertions run across Linux x64 and macOS arm64 embedded lanes, with explicit Windows x64 external-storage guidance.",
  },
  {
    icon: Snowflake,
    title: "Optional cold-model lane",
    copy: "A Linux x64 lane can start from an empty local-model cache and prove download reporting plus a usable 768-dimensional vector index.",
  },
]

export function ReleaseSection() {
  return (
    <section className="px-4 py-20 sm:px-6 lg:py-28" aria-labelledby="release-title">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">Release confidence</p>
            <h2 id="release-title" className="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-5xl">Test the package users install.</h2>
          </div>
          <a
            href="https://github.com/Phoenixrr2113/codebase-graph/blob/main/docs/DISTRIBUTION-SETUP.md"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium text-accent underline decoration-accent/40 underline-offset-4 hover:decoration-accent focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Read the release gate
          </a>
        </div>

        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {checks.map((check, index) => (
            <motion.article
              key={check.title}
              initial={{ opacity: 0, y: 14 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.08 }}
              className="rounded-xl border border-border bg-card/70 p-5"
            >
              <check.icon className="size-5 text-accent" aria-hidden="true" />
              <h3 className="mt-5 text-lg font-medium">{check.title}</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{check.copy}</p>
            </motion.article>
          ))}
        </div>

        <div className="mt-6 rounded-xl border border-amber-400/30 bg-amber-400/10 p-5 text-sm leading-6 text-amber-100">
          <strong>Publication gate:</strong> <code>@agntk/codegraph-mcp@0.1.0</code> is not in the npm registry yet. The package defines both <code>codegraph-mcp</code> and <code>codegraph-dashboard</code> bins, but registry-based install copy becomes active only after publication is verified.
        </div>
      </div>
    </section>
  )
}
