"use client"

import Image from "next/image"
import { motion } from "framer-motion"
import { Expand, Layers3, Rows3 } from "lucide-react"

const explorerDetails = [
  {
    icon: Layers3,
    title: "Choose the level",
    copy: "Switch between Files and Symbols. Files mode adds an Externals visibility toggle for unresolved module nodes.",
  },
  {
    icon: Rows3,
    title: "Move through exact totals",
    copy: "Windows are ordered most connected first. Use Previous and Next for pages, or Load next to append another window without losing the current graph.",
  },
  {
    icon: Expand,
    title: "Expand in place",
    copy: "Select a node and add its neighbors around it. Existing positions, pan, and zoom stay intact so exploration keeps its spatial context.",
  },
]

export function ExplorerSection() {
  return (
    <section id="explorer" className="px-4 py-20 sm:px-6 lg:py-28">
      <div className="mx-auto max-w-6xl">
        <div className="max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">Explorer proof</p>
          <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-5xl">A large graph stays countable, pageable, and oriented.</h2>
          <p className="mt-5 text-sm leading-7 text-muted-foreground sm:text-base">
            CodeGraph reports exact totals while rendering bounded windows. On this final project-scoped index, the explorer counted 19,055 visible nodes. Its 1,000-node compact response was 305,248 bytes instead of 750,767 bytes, 59% smaller than the legacy wire format.
          </p>
        </div>

        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {explorerDetails.map((detail, index) => (
            <motion.article
              key={detail.title}
              initial={{ opacity: 0, y: 14 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.08 }}
              className="rounded-xl border border-border bg-card/70 p-5"
            >
              <detail.icon className="size-5 text-accent" aria-hidden="true" />
              <h3 className="mt-5 text-lg font-medium">{detail.title}</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{detail.copy}</p>
            </motion.article>
          ))}
        </div>

        <div className="mt-8 grid gap-4 lg:grid-cols-2">
          <figure className="overflow-hidden rounded-xl border border-border bg-card p-2 lg:col-span-2">
            <Image
              src="/captures/explorer-symbols.jpg"
              alt="CodeGraph Graph Explorer in Symbols mode with exact loaded and total counts, most-connected-first ordering, Previous and Next paging, and Load next controls"
              width={1800}
              height={1100}
              className="h-auto w-full rounded-lg"
            />
            <figcaption className="px-2 pb-1 pt-3 text-xs text-muted-foreground">Symbols mode over this repository, captured from the real dashboard.</figcaption>
          </figure>
          <figure className="overflow-hidden rounded-xl border border-border bg-card p-2">
            <Image
              src="/captures/explorer-files.jpg"
              alt="CodeGraph Graph Explorer in Files mode with the Externals visibility toggle and exact file graph totals"
              width={1800}
              height={1100}
              className="h-auto w-full rounded-lg"
            />
            <figcaption className="px-2 pb-1 pt-3 text-xs text-muted-foreground">Files mode makes the Externals control explicit.</figcaption>
          </figure>
          <figure className="overflow-hidden rounded-xl border border-border bg-card p-2">
            <Image
              src="/captures/explorer-expansion.jpg"
              alt="CodeGraph Graph Explorer after in-place neighbor expansion, with the selected node and its newly added neighbors visible in the preserved viewport"
              width={1800}
              height={1100}
              className="h-auto w-full rounded-lg"
            />
            <figcaption className="px-2 pb-1 pt-3 text-xs text-muted-foreground">Neighbor expansion adds context without resetting the viewport.</figcaption>
          </figure>
        </div>
      </div>
    </section>
  )
}
