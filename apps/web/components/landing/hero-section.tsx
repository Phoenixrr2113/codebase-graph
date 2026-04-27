"use client"

import { motion } from "framer-motion"
import { ArrowRight, Terminal, Github, BookOpen } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Spotlight } from "@/components/ui/spotlight"
import { AnimatedCounter } from "@/components/ui/animated-counter"
import { HeroGraphDemo } from "./hero-graph-demo"

// source: MEMORY.md "v6 Chunk 1 baseline (2026-04-26)"; CLAUDE.md tool list
// MRR rendered as static text because AnimatedCounter rounds to integer; the other two animate.
const animatedStats = [
  { value: 4, suffix: "", label: "MCP persona tools" },
  { value: 35, suffix: "+", label: "languages" },
]

export function HeroSection() {
  return (
    <section className="relative min-h-screen flex flex-col items-center justify-center px-4 sm:px-6 py-24 md:py-32 overflow-hidden">
      <Spotlight
        className="-top-40 left-0 md:left-60 md:-top-20"
        fill="hsl(var(--accent))"
      />

      {/* Grid background */}
      <div className="absolute inset-0 [background-size:30px_30px] md:[background-size:40px_40px] [background-image:linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] opacity-30" />
      <div className="pointer-events-none absolute inset-0 bg-background [mask-image:radial-gradient(ellipse_at_center,transparent_20%,black)]" />

      <div className="relative z-10 w-full max-w-6xl mx-auto">
        <div className="grid lg:grid-cols-2 gap-10 lg:gap-12 items-center">

          {/* LEFT COLUMN */}
          <div className="text-center lg:text-left">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="mb-6 inline-flex items-center gap-2 px-3 py-1.5 sm:px-4 rounded-full border border-accent/30 bg-accent/10 text-xs sm:text-sm text-accent"
            >
              <Terminal className="h-3.5 w-3.5" />
              MCP Server for AI Agents
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.1 }}
              className="text-3xl sm:text-4xl md:text-5xl lg:text-5xl xl:text-6xl font-bold tracking-tight text-balance leading-[1.1]"
            >
              A code knowledge graph your AI can{" "}
              <span className="text-accent">actually navigate</span>.
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="mt-5 sm:mt-6 text-base sm:text-lg text-muted-foreground max-w-xl mx-auto lg:mx-0 text-pretty leading-relaxed"
            >
              CodeGraph indexes your codebase into a queryable graph — functions, classes,
              relationships, knowledge — and exposes it through MCP tools your AI agent can
              use to search, understand, and remember.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.3 }}
              className="mt-8 flex flex-col sm:flex-row items-center lg:items-start justify-center lg:justify-start gap-3"
            >
              <Button
                size="lg"
                className="w-full sm:w-auto text-sm sm:text-base px-6 sm:px-8 h-11 sm:h-12 bg-accent text-accent-foreground hover:bg-accent/90 group"
                asChild
              >
                <a
                  href="https://github.com/Phoenixrr2113/codebase-graph"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Github className="mr-2 h-4 w-4" />
                  Star on GitHub
                  <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
                </a>
              </Button>
              <Button
                variant="outline"
                size="lg"
                className="w-full sm:w-auto text-sm sm:text-base px-6 sm:px-8 h-11 sm:h-12 group"
                asChild
              >
                <a
                  href="https://github.com/Phoenixrr2113/codebase-graph/blob/main/CLAUDE.md"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <BookOpen className="mr-2 h-4 w-4" />
                  Read the docs
                </a>
              </Button>
            </motion.div>

            {/* Stats row */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.6, delay: 0.5 }}
              className="mt-10 grid grid-cols-3 gap-3 sm:gap-4 max-w-md mx-auto lg:mx-0"
              role="list"
              aria-label="Verified product metrics"
            >
              {/* MRR is static (AnimatedCounter rounds to integer) */}
              <motion.div
                role="listitem"
                className="text-center lg:text-left p-3 rounded-xl bg-card/50 border border-border/50"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.55 }}
              >
                <div className="text-2xl sm:text-3xl font-bold text-foreground tabular-nums">
                  0.969
                </div>
                <div className="text-[11px] sm:text-xs text-muted-foreground mt-1.5 font-medium">
                  MRR (internal)
                </div>
              </motion.div>
              {animatedStats.map((stat, index) => (
                <motion.div
                  key={stat.label}
                  role="listitem"
                  className="text-center lg:text-left p-3 rounded-xl bg-card/50 border border-border/50"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, delay: 0.6 + index * 0.1 }}
                >
                  <div className="text-2xl sm:text-3xl font-bold text-foreground tabular-nums">
                    <AnimatedCounter value={stat.value} suffix={stat.suffix} />
                  </div>
                  <div className="text-[11px] sm:text-xs text-muted-foreground mt-1.5 font-medium">
                    {stat.label}
                  </div>
                </motion.div>
              ))}
            </motion.div>
          </div>

          {/* RIGHT COLUMN — App UI demo placeholder */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.6, delay: 0.4 }}
            className="rounded-xl border bg-card overflow-hidden shadow-2xl"
          >
            {/* Window chrome */}
            <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/50">
              <div className="flex gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-red-500/60" />
                <span className="w-2.5 h-2.5 rounded-full bg-yellow-500/60" />
                <span className="w-2.5 h-2.5 rounded-full bg-green-500/60" />
              </div>
              <span className="text-xs text-muted-foreground font-mono ml-2">
                Claude Desktop · Graph Explorer panel
              </span>
            </div>
            {/* Live cytoscape graph demo (sample auth-flow data) */}
            <div
              className="relative aspect-[16/10] bg-gradient-to-br from-accent/5 via-card to-accent/10 [background-image:linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] [background-size:24px_24px]"
              role="img"
              aria-label="Sample CodeGraph rendering of an auth-flow codebase: files containing functions, with CALLS and IMPORTS edges"
            >
              <HeroGraphDemo />
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  )
}
