"use client"

import { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Zap, Wrench, Plus, ArrowRight, Check, Copy } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const features = [
  {
    icon: Zap,
    title: "Zero config",
    description: "Auto-detects best provider: your API key → local Ollama → free Cerebras tier.",
  },
  {
    icon: Wrench,
    title: "20+ built-in tools",
    description: "Files, shell, browser, AST search, planning, memory, sub-agents, web search.",
  },
  {
    icon: Plus,
    title: "Add CodeGraph",
    description: "Install CodeGraph and agntk gains deep codebase understanding instantly.",
  },
]

const demoCommands = [
  { command: 'npx agntk "analyze this codebase"', description: "One-shot" },
  { command: 'npx agntk -n coder -i', description: "Interactive" },
  { command: 'npx agntk --mcp codegraph "explain auth"', description: "With CodeGraph" },
]

export function AgntkSection() {
  const [activeCommand, setActiveCommand] = useState(0)
  const [copied, setCopied] = useState(false)

  const copyCommand = async () => {
    await navigator.clipboard.writeText(demoCommands[activeCommand].command)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <section id="agntk" className="py-16 sm:py-20 md:py-24 px-4 sm:px-6 bg-secondary/30 border-y border-border">
      <div className="max-w-5xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center mb-6"
        >
          <span className="inline-block px-3 py-1 text-xs font-mono rounded-full bg-accent/10 text-accent border border-accent/20 mb-3 sm:mb-4">
            Open Source
          </span>
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold mb-3 sm:mb-4 text-balance">
            Don&apos;t have Claude Code or Cursor? Try agntk.
          </h2>
          <p className="text-sm sm:text-base text-muted-foreground max-w-2xl mx-auto">
            A zero-config AI agent CLI with 20+ built-in tools. Free tier included.
          </p>
        </motion.div>

        {/* Interactive command demo */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="max-w-xl mx-auto mb-10 sm:mb-12"
        >
          {/* Command tabs */}
          <div className="flex flex-wrap gap-1.5 sm:gap-2 mb-3 sm:mb-4 justify-center">
            {demoCommands.map((cmd, i) => (
              <motion.button
                key={i}
                onClick={() => setActiveCommand(i)}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className={cn(
                  "px-2.5 sm:px-3 py-1 sm:py-1.5 text-[10px] sm:text-xs rounded-full transition-all",
                  activeCommand === i 
                    ? "bg-accent text-accent-foreground" 
                    : "bg-muted text-muted-foreground hover:text-foreground"
                )}
              >
                {cmd.description}
              </motion.button>
            ))}
          </div>

          {/* Terminal display */}
          <motion.div 
            className="rounded-xl border bg-card overflow-hidden shadow-lg"
            whileHover={{ scale: 1.01 }}
            transition={{ duration: 0.2 }}
          >
            <div className="flex items-center justify-between px-3 sm:px-4 py-2 border-b bg-muted/50">
              <div className="flex items-center gap-2">
                <div className="flex gap-1.5">
                  <div className="w-2 h-2 sm:w-3 sm:h-3 rounded-full bg-destructive/80" />
                  <div className="w-2 h-2 sm:w-3 sm:h-3 rounded-full bg-yellow-500/80" />
                  <div className="w-2 h-2 sm:w-3 sm:h-3 rounded-full bg-accent/80" />
                </div>
                <span className="text-xs sm:text-sm text-muted-foreground font-mono ml-2">Terminal</span>
              </div>
              <button
                onClick={copyCommand}
                className="p-1.5 rounded-md hover:bg-muted transition-colors"
                aria-label="Copy command"
              >
                {copied ? (
                  <Check className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-accent" />
                ) : (
                  <Copy className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground" />
                )}
              </button>
            </div>
            <div className="p-3 sm:p-4 font-mono text-xs sm:text-sm">
              <AnimatePresence mode="wait">
                <motion.div
                  key={activeCommand}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="flex items-center gap-2"
                >
                  <span className="text-accent">$</span>
                  <span className="text-foreground break-all">{demoCommands[activeCommand].command}</span>
                  <motion.span
                    animate={{ opacity: [1, 0] }}
                    transition={{ duration: 0.5, repeat: Infinity, repeatType: "reverse" }}
                    className="w-1.5 sm:w-2 h-4 sm:h-5 bg-accent shrink-0"
                  />
                </motion.div>
              </AnimatePresence>
            </div>
          </motion.div>
        </motion.div>

        {/* Feature cards */}
        <div className="grid sm:grid-cols-3 gap-4 sm:gap-6 mb-10 sm:mb-12">
          {features.map((feature, i) => {
            const Icon = feature.icon
            return (
              <motion.div
                key={feature.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.1 }}
                whileHover={{ y: -4 }}
                className="group p-4 sm:p-6 rounded-xl border border-border bg-card hover:border-accent/30 transition-all"
              >
                <div className="flex items-center justify-center w-10 h-10 sm:w-12 sm:h-12 rounded-lg bg-accent/10 border border-accent/20 mb-3 sm:mb-4 group-hover:scale-110 transition-transform">
                  <Icon className="h-5 w-5 sm:h-6 sm:w-6 text-accent" />
                </div>
                <h3 className="text-base sm:text-lg font-semibold mb-1.5 sm:mb-2">{feature.title}</h3>
                <p className="text-xs sm:text-sm text-muted-foreground">{feature.description}</p>
              </motion.div>
            )
          })}
        </div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.3 }}
          className="text-center"
        >
          <Button variant="outline" size="lg" className="group text-sm sm:text-base" asChild>
            <a href="https://github.com/Phoenixrr2113/codebase-graph" target="_blank" rel="noopener noreferrer">
              Install agntk
              <ArrowRight className="ml-2 h-3.5 w-3.5 sm:h-4 sm:w-4 transition-transform group-hover:translate-x-1" />
            </a>
          </Button>
          <p className="mt-3 sm:mt-4 text-xs sm:text-sm text-muted-foreground max-w-xl mx-auto">
            agntk is open source (MIT). CodeGraph is a paid add-on that makes any model understand your codebase.
          </p>
        </motion.div>
      </div>
    </section>
  )
}
