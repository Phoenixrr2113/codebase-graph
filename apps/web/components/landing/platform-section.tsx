"use client"

import { motion } from "framer-motion"
import { Apple, Database, HardDrive, Server } from "lucide-react"

const platforms = [
  {
    icon: Server,
    title: "Linux x64",
    status: "Embedded by default",
    copy: "The platform package bundles the server and graph module binaries. No separate Redis installation and no driver variable are required.",
  },
  {
    icon: Apple,
    title: "Apple silicon macOS",
    status: "Embedded with native libraries",
    copy: "Install Homebrew libomp and openssl@3. The remaining embedded server and module binaries ship with the platform package.",
  },
  {
    icon: Database,
    title: "Other platforms",
    status: "External FalkorDB",
    copy: "Configure an external FalkorDB endpoint. Explicit external configuration also takes precedence on otherwise supported embedded platforms.",
  },
]

export function PlatformSection() {
  return (
    <section id="platform" className="border-y border-border/70 bg-card/30 px-4 py-20 sm:px-6 lg:py-28">
      <div className="mx-auto max-w-6xl">
        <div className="grid gap-8 lg:grid-cols-2 lg:items-end">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">Storage and platform</p>
            <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-5xl">Embedded where the binaries are bundled. External everywhere else.</h2>
          </div>
          <div className="rounded-xl border border-border bg-background/70 p-5">
            <div className="flex items-center gap-2 text-sm font-medium">
              <HardDrive className="size-4 text-accent" aria-hidden="true" />
              Single-owner embedded storage
            </div>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              One process owns the FalkorDBLite lease. A second CodeGraph process attaches through the published socket, and closing an attached process does not release the owner&apos;s lease.
            </p>
          </div>
        </div>

        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {platforms.map((platform, index) => (
            <motion.article
              key={platform.title}
              initial={{ opacity: 0, y: 14 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.08 }}
              className="rounded-xl border border-border bg-background/75 p-5"
            >
              <platform.icon className="size-5 text-accent" aria-hidden="true" />
              <h3 className="mt-5 text-lg font-medium">{platform.title}</h3>
              <p className="mt-1 text-xs font-medium uppercase tracking-[0.12em] text-accent">{platform.status}</p>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">{platform.copy}</p>
            </motion.article>
          ))}
        </div>
      </div>
    </section>
  )
}
