"use client"

import { motion } from "framer-motion"
import { AlertTriangle, GitCommitHorizontal } from "lucide-react"

const actions = [
  { name: "impact", detail: "Bounded static blast radius from a persisted symbol." },
  { name: "import_cycles", detail: "Canonical cycles within one project root." },
  { name: "call_hierarchy", detail: "Direct callers, callees, or both." },
  { name: "dead_code", detail: "Unreferenced export candidates, not runtime proof." },
  { name: "hotspots", detail: "Change frequency ranked with complexity or degree." },
  { name: "change_coupling", detail: "Files that changed together in indexed history." },
  { name: "ownership", detail: "Per-file contributors ranked from indexed git authorship." },
]

export function AnalysisSection() {
  return (
    <section id="analysis" className="border-y border-border/70 bg-card/30 px-4 py-20 sm:px-6 lg:py-28">
      <div className="mx-auto max-w-6xl">
        <div className="grid gap-8 lg:grid-cols-[0.8fr_1.2fr]">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">Analysis</p>
            <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-5xl">Seven bounded answers, with their limits attached.</h2>
            <p className="mt-5 text-sm leading-7 text-muted-foreground sm:text-base">
              The analyze tool does not collapse uncertainty into a score. Responses include display-ready caveats and truncation metadata. Git-backed results also include <code>historyCoverage</code>.
            </p>

            <div className="mt-6 rounded-xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm leading-6 text-amber-100">
              <div className="flex items-center gap-2 font-medium">
                <AlertTriangle className="size-4" aria-hidden="true" />
                Evidence boundaries stay visible
              </div>
              <p className="mt-2 text-amber-100/80">Static results do not prove runtime behavior. Ownership, hotspots, and coupling cover indexed history only.</p>
            </div>

            <div className="mt-4 rounded-xl border border-border bg-background/70 p-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <GitCommitHorizontal className="size-4 text-accent" aria-hidden="true" />
                Persisted history window
              </div>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                First sync defaults to 365 days and at most 10,000 commits. Later requests are widen-only. MCP reindex, REST parse, and CLI extraction expose the history options.
              </p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {actions.map((action, index) => (
              <motion.article
                key={action.name}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.04 }}
                className="rounded-xl border border-border bg-background/75 p-4 last:sm:col-span-2"
              >
                <h3 className="font-mono text-sm font-medium text-accent">{action.name}</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{action.detail}</p>
              </motion.article>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
