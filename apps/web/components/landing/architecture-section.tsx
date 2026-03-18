"use client"

import { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { FileCode2, Layers, Database, Wrench, Monitor, ChevronRight, ChevronDown, Lock, Zap, HardDrive } from "lucide-react"
import { cn } from "@/lib/utils"

const capabilities = [
  "Functions & methods",
  "Classes & interfaces",
  "Components & hooks",
  "Import relationships",
  "Call graphs",
  "Type dependencies",
  "Data flow paths",
  "Git history",
]

const benefits = [
  {
    icon: Lock,
    title: "100% Local",
    description: "Your code never leaves your machine. No cloud, no uploads, complete privacy.",
  },
  {
    icon: Zap,
    title: "Instant Queries",
    description: "Sub-second responses. No API latency, no rate limits, no waiting.",
  },
  {
    icon: HardDrive,
    title: "Zero Dependencies",
    description: "Single binary. No Docker, no databases to manage, no infrastructure.",
  },
]

const flowSteps = [
  { icon: FileCode2, label: "Your Codebase", sublabel: "Any language" },
  { icon: Layers, label: "Smart Parser", sublabel: "Deep extraction" },
  { icon: Database, label: "Knowledge Graph", sublabel: "Local storage" },
  { icon: Wrench, label: "MCP Tools", sublabel: "Search & understand" },
  { icon: Monitor, label: "Your AI Editor", sublabel: "Claude, Cursor, etc." },
]

export function ArchitectureSection() {
  const [expandedSection, setExpandedSection] = useState<"capabilities" | null>(null)

  return (
    <section className="py-16 sm:py-20 md:py-24 px-4 sm:px-6">
      <div className="max-w-6xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center mb-10 sm:mb-12"
        >
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold mb-3 sm:mb-4">
            How it works
          </h2>
          <p className="text-sm sm:text-base text-muted-foreground max-w-2xl mx-auto">
            CodeGraph builds a comprehensive understanding of your codebase and exposes it through simple tools your AI can use.
          </p>
        </motion.div>

        {/* Flow Diagram - Simplified */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="mb-10 sm:mb-16"
        >
          <div className="flex flex-col sm:flex-row flex-wrap items-center justify-center gap-2 sm:gap-0">
            {flowSteps.map((step, i) => (
              <motion.div 
                key={step.label} 
                className="flex items-center"
                initial={{ opacity: 0, y: 10 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: i * 0.1 }}
              >
                <motion.div 
                  className="flex flex-col items-center p-3 sm:p-4 md:px-6 cursor-pointer group"
                  whileHover={{ y: -4 }}
                  transition={{ duration: 0.2 }}
                >
                  <div className="flex items-center justify-center w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-card border border-border mb-2 sm:mb-3 group-hover:border-accent/50 group-hover:bg-accent/5 transition-colors">
                    <step.icon className="h-5 w-5 sm:h-6 sm:w-6 text-accent" />
                  </div>
                  <div className="text-xs sm:text-sm font-medium text-center">{step.label}</div>
                  <div className="text-[10px] sm:text-xs text-muted-foreground text-center">{step.sublabel}</div>
                </motion.div>
                {i < flowSteps.length - 1 && (
                  <>
                    <ChevronRight className="h-4 w-4 sm:h-5 sm:w-5 text-muted-foreground hidden sm:block" />
                    <ChevronDown className="h-4 w-4 text-muted-foreground sm:hidden" />
                  </>
                )}
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/* Benefits Grid */}
        <div className="grid md:grid-cols-3 gap-4 sm:gap-6 mb-8 sm:mb-10">
          {benefits.map((benefit, i) => {
            const Icon = benefit.icon
            return (
              <motion.div
                key={benefit.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.1 }}
                whileHover={{ scale: 1.02 }}
                className="p-4 sm:p-6 rounded-xl border border-border bg-card hover:border-accent/30 transition-all"
              >
                <div className="flex items-center justify-center w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-accent/10 mb-3 sm:mb-4">
                  <Icon className="h-5 w-5 sm:h-6 sm:w-6 text-accent" />
                </div>
                <h3 className="font-semibold text-sm sm:text-base mb-1 sm:mb-2">{benefit.title}</h3>
                <p className="text-xs sm:text-sm text-muted-foreground">{benefit.description}</p>
              </motion.div>
            )
          })}
        </div>

        {/* What CodeGraph Understands - Collapsed */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="rounded-xl border border-border bg-card overflow-hidden"
        >
          <button
            onClick={() => setExpandedSection(expandedSection === "capabilities" ? null : "capabilities")}
            className="w-full flex items-center justify-between p-4 sm:p-6 text-left hover:bg-muted/30 transition-colors"
          >
            <h3 className="text-sm sm:text-base font-semibold">
              What CodeGraph extracts from your code
            </h3>
            <ChevronDown className={cn(
              "h-4 w-4 sm:h-5 sm:w-5 text-muted-foreground transition-transform",
              expandedSection === "capabilities" && "rotate-180"
            )} />
          </button>
          <AnimatePresence initial={false}>
            {expandedSection === "capabilities" && (
              <motion.div
                initial={{ height: 0 }}
                animate={{ height: "auto" }}
                exit={{ height: 0 }}
                className="overflow-hidden"
              >
                <div className="px-4 pb-4 sm:px-6 sm:pb-6 flex flex-wrap gap-1.5 sm:gap-2">
                  {capabilities.map((cap, i) => (
                    <motion.span
                      key={cap}
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ duration: 0.2, delay: i * 0.02 }}
                      className="px-2.5 sm:px-3 py-1 sm:py-1.5 text-xs sm:text-sm rounded-lg bg-muted text-foreground"
                    >
                      {cap}
                    </motion.span>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        <motion.p
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.5 }}
          className="mt-6 sm:mt-8 text-center text-sm sm:text-base md:text-lg font-semibold"
        >
          Everything runs locally. Your code never leaves your machine.
        </motion.p>
      </div>
    </section>
  )
}
