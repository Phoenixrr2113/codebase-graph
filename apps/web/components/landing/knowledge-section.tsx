"use client"

import { motion } from "framer-motion"
import { BookOpenCheck, CloudCog, Search } from "lucide-react"

const capabilities = [
  {
    icon: Search,
    title: "Search with graph context",
    copy: "Semantic results can include callers, callees, complexity, and linked project knowledge. Optional Voyage reranking can refine vector order when configured.",
  },
  {
    icon: BookOpenCheck,
    title: "Knowledge with time",
    copy: "Add text, URLs, and supported documents to the same graph. Valid and invalid timestamps preserve fact timelines and supersession instead of overwriting context silently.",
  },
  {
    icon: CloudCog,
    title: "Cloud only by choice",
    copy: "Voyage and OpenRouter embeddings are opt-in profiles. Switching an existing graph to a different provider or dimension requires an explicit re-embed migration.",
  },
]

export function KnowledgeSection() {
  return (
    <section className="px-4 py-20 sm:px-6 lg:py-28" aria-labelledby="knowledge-title">
      <div className="mx-auto max-w-6xl">
        <div className="rounded-2xl border border-border bg-gradient-to-br from-accent/10 via-card to-card p-6 sm:p-10">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">Search and knowledge</p>
            <h2 id="knowledge-title" className="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-5xl">Semantic by default, local without a key.</h2>
            <p className="mt-5 text-sm leading-7 text-muted-foreground sm:text-base">
              With no cloud embedding key configured, CodeGraph uses <code>nomic-ai/nomic-embed-text-v1.5</code> locally at 768-dimensional output. The model downloads on first use and stays cached for later runs.
            </p>
          </div>

          <div className="mt-10 grid gap-px overflow-hidden rounded-xl border border-border bg-border md:grid-cols-3">
            {capabilities.map((capability, index) => (
              <motion.article
                key={capability.title}
                initial={{ opacity: 0 }}
                whileInView={{ opacity: 1 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.08 }}
                className="bg-background p-5 sm:p-6"
              >
                <capability.icon className="size-5 text-accent" aria-hidden="true" />
                <h3 className="mt-5 text-lg font-medium">{capability.title}</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{capability.copy}</p>
              </motion.article>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
