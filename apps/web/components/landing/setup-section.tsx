"use client"

import Image from "next/image"
import { motion } from "framer-motion"
import { FolderOpen, Gauge, Server } from "lucide-react"

const steps = [
  {
    number: "01",
    icon: Server,
    title: "Start one process",
    copy: "codegraph-dashboard serves the API and dashboard from the same origin. On supported systems it opens embedded storage without a separate Redis install.",
  },
  {
    number: "02",
    icon: FolderOpen,
    title: "Browse to a folder",
    copy: "Use the guided setup to confirm storage and the active embedding profile, then choose the code folder you want to index.",
  },
  {
    number: "03",
    icon: Gauge,
    title: "Watch real progress",
    copy: "Structure lands first. Embeddings continue automatically with file counts, phases, and local model download progress when a model is not cached.",
  },
]

export function SetupSection() {
  return (
    <section id="setup" className="border-y border-border/70 bg-card/30 px-4 py-20 sm:px-6 lg:py-28">
      <div className="mx-auto max-w-6xl">
        <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:items-end">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">Zero-config first run</p>
            <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-5xl">From folder to navigable graph in one guided flow.</h2>
          </div>
          <p className="max-w-2xl text-sm leading-7 text-muted-foreground sm:text-base">
            The dashboard reports what it is doing instead of hiding first-run work. Storage ownership, embedding provider and dimension, structure progress, model download state, and final counts remain visible.
          </p>
        </div>

        <ol className="mt-10 grid gap-4 md:grid-cols-3">
          {steps.map((step, index) => (
            <motion.li
              key={step.title}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.08 }}
              className="rounded-xl border border-border bg-background/70 p-5"
            >
              <div className="flex items-center justify-between">
                <step.icon className="size-5 text-accent" aria-hidden="true" />
                <span className="font-mono text-xs text-muted-foreground">{step.number}</span>
              </div>
              <h3 className="mt-6 text-lg font-medium">{step.title}</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{step.copy}</p>
            </motion.li>
          ))}
        </ol>

        <div className="mt-8 grid gap-4 lg:grid-cols-[1.12fr_0.88fr]">
          <figure className="overflow-hidden rounded-xl border border-border bg-card p-2">
            <Image
              src="/captures/guided-setup.jpg"
              alt="CodeGraph guided setup showing embedded FalkorDBLite ownership, the local 768-dimensional embedding profile, and the Browse project control"
              width={1440}
              height={1000}
              className="h-auto w-full rounded-lg"
            />
            <figcaption className="px-2 pb-1 pt-3 text-xs text-muted-foreground">A fresh local setup before the first project is indexed.</figcaption>
          </figure>
          <figure className="overflow-hidden rounded-xl border border-border bg-card p-2">
            <Image
              src="/captures/indexing-progress.jpg"
              alt="CodeGraph guided setup reporting live structure indexing progress while writing graph data"
              width={1440}
              height={1000}
              className="h-auto w-full rounded-lg"
            />
            <figcaption className="px-2 pb-1 pt-3 text-xs text-muted-foreground">Real indexing progress from this repository.</figcaption>
          </figure>
        </div>
      </div>
    </section>
  )
}
