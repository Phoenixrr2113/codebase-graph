"use client"

import { motion } from "framer-motion"
import { FileCode2, Layers, Database, Wrench, Monitor, ChevronRight, ChevronDown } from "lucide-react"
import { BenchmarksBlock } from "./benchmarks-block"

// source: CLAUDE.md "Pipeline: vector embeddings → FalkorDB HNSW → cross-encoder reranking → graph enrichment"
const flowSteps = [
  { icon: FileCode2, label: "Your codebase", sublabel: "any language" },
  { icon: Layers, label: "Tree-sitter parser", sublabel: "5 tier-1 + ~30 generic" },
  { icon: Database, label: "FalkorDB / Lite", sublabel: "vector + graph" },
  { icon: Wrench, label: "MCP router", sublabel: "4 persona tools" },
  { icon: Monitor, label: "Your AI host", sublabel: "Claude, Cursor, etc." },
]

// source: CLAUDE.md "Graph DB: FalkorDB (Docker) or FalkorDBLite (embedded)"
const stackNotes = [
  "FalkorDB (Docker) or FalkorDBLite (embedded — no Docker, requires redis-server).",
  "Embeddings: Voyage, OpenRouter, or local @huggingface/transformers (nomic-embed-text-v1.5).",
  "Reranker: Jina or Voyage. Cross-encoder, MRR-aware.",
  "Optional cloud APIs are pluggable; the embedded path is fully local.",
]

export function ArchitectureSection() {
  return (
    <section id="architecture" className="py-16 sm:py-20 md:py-24 px-4 sm:px-6">
      <div className="max-w-5xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center mb-10 sm:mb-12"
        >
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold mb-3 sm:mb-4">
            Architecture
          </h2>
          <p className="text-sm sm:text-base text-muted-foreground max-w-2xl mx-auto">
            FalkorDB-backed graph, tree-sitter parsers, pluggable embeddings and reranker, MCP at the edge.
          </p>
        </motion.div>

        {/* Flow */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="mb-10 sm:mb-12"
        >
          <div className="flex flex-col sm:flex-row flex-wrap items-center justify-center gap-2 sm:gap-0">
            {flowSteps.map((step, i) => (
              <div key={step.label} className="flex items-center">
                <div className="flex flex-col items-center p-3 sm:p-4 md:px-6">
                  <div className="flex items-center justify-center w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-card border border-border mb-2 sm:mb-3">
                    <step.icon className="h-5 w-5 sm:h-6 sm:w-6 text-accent" />
                  </div>
                  <div className="text-xs sm:text-sm font-medium text-center">{step.label}</div>
                  <div className="text-[10px] sm:text-xs text-muted-foreground text-center">{step.sublabel}</div>
                </div>
                {i < flowSteps.length - 1 && (
                  <>
                    <ChevronRight className="h-4 w-4 sm:h-5 sm:w-5 text-muted-foreground hidden sm:block" />
                    <ChevronDown className="h-4 w-4 text-muted-foreground sm:hidden" />
                  </>
                )}
              </div>
            ))}
          </div>
        </motion.div>

        {/* Stack notes */}
        <div className="grid md:grid-cols-2 gap-4 sm:gap-6 mb-8 sm:mb-10">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="p-5 sm:p-6 rounded-xl border border-border bg-card"
          >
            <h3 className="text-sm sm:text-base font-semibold mb-3">Stack</h3>
            <ul className="space-y-2 text-xs sm:text-sm text-muted-foreground leading-relaxed">
              {stackNotes.map((note) => (
                <li key={note} className="flex gap-2">
                  <span className="text-accent shrink-0">•</span>
                  <span>{note}</span>
                </li>
              ))}
            </ul>
          </motion.div>
          <BenchmarksBlock />
        </div>
      </div>
    </section>
  )
}
