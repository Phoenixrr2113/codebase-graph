"use client"

import { motion } from "framer-motion"
import { FileText, Github, GitGraph, LockKeyhole, Scale, ShieldAlert } from "lucide-react"

const technicalDetails = [
  "5 MCP tool groups",
  "25 actions",
  "TypeScript, Python, Go, Rust, Markdown",
  "Generic tree-sitter coverage",
  "MIT licensed",
]

const footerLinks = [
  { label: "Source", href: "https://github.com/Phoenixrr2113/codebase-graph", icon: Github },
  { label: "README", href: "https://github.com/Phoenixrr2113/codebase-graph/blob/main/README.md", icon: FileText },
  { label: "Issues", href: "https://github.com/Phoenixrr2113/codebase-graph/issues", icon: ShieldAlert },
  { label: "Security", href: "https://github.com/Phoenixrr2113/codebase-graph/blob/main/SECURITY.md", icon: LockKeyhole },
  { label: "License", href: "https://github.com/Phoenixrr2113/codebase-graph/blob/main/LICENSE", icon: Scale },
]

export function TechnicalBar() {
  return (
    <section className="border-y border-border bg-muted/30 px-4 py-5 sm:px-6" aria-label="Technical details">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-4 gap-y-2 font-mono text-[11px] text-muted-foreground sm:text-xs">
        {technicalDetails.map((detail, index) => (
          <span key={detail} className="flex items-center gap-4">
            {index > 0 && <span className="hidden text-border sm:inline" aria-hidden="true">/</span>}
            {detail}
          </span>
        ))}
      </div>
    </section>
  )
}

export function Footer() {
  return (
    <footer className="px-4 py-10 sm:px-6 sm:py-14">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-col gap-8 sm:flex-row sm:items-center sm:justify-between">
          <motion.a href="#product" whileHover={{ scale: 1.02 }} className="flex items-center gap-2.5 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
            <span className="flex size-8 items-center justify-center rounded-lg border border-accent/20 bg-accent/10">
              <GitGraph className="size-4 text-accent" aria-hidden="true" />
            </span>
            <span>
              <span className="block font-semibold">CodeGraph</span>
              <span className="block text-xs text-muted-foreground">Local-first code intelligence</span>
            </span>
          </motion.a>

          <nav className="flex flex-wrap gap-x-5 gap-y-3" aria-label="Technical links">
            {footerLinks.map((link) => (
              <a
                key={link.label}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 rounded text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <link.icon className="size-4" aria-hidden="true" />
                {link.label}
              </a>
            ))}
          </nav>
        </div>

        <div className="mt-8 border-t border-border pt-6 text-xs text-muted-foreground">
          <p>MIT licensed. Built in the open by CodeGraph contributors.</p>
        </div>
      </div>
    </footer>
  )
}
