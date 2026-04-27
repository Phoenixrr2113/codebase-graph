"use client"

import { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { FileCode2, Database, Sparkles, Check, ChevronRight } from "lucide-react"
import { TerminalBlock } from "./code-block"
import { cn } from "@/lib/utils"

// source: CLAUDE.md "5 tier-1 language plugins" + MEMORY.md
const steps = [
  {
    number: "01",
    icon: FileCode2,
    title: "Parse",
    description: "Tree-sitter extracts every function, class, type, and import. 5 tier-1 plugins (TypeScript, Python, Go, Rust, Markdown) plus generic coverage for ~30 more languages.",
  },
  {
    number: "02",
    icon: Database,
    title: "Graph",
    description: "Nodes and edges land in FalkorDB (Docker) or FalkorDBLite (embedded, no Docker). Vector indexes for semantic search; structural edges for CALLS, IMPORTS, EXTENDS, IMPLEMENTS.",
  },
  {
    number: "03",
    icon: Sparkles,
    title: "Query",
    description: "Four MCP persona tools — search, knowledge, codebase, query — give your AI agent vector search, knowledge recall, project management, and raw Cypher. Cross-encoder reranking and graph enrichment included.",
  },
]

export function HowItWorksSection() {
  return (
    <section id="how-it-works" className="py-16 sm:py-20 md:py-24 px-4 sm:px-6 bg-muted/30">
      <div className="max-w-5xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center mb-12 md:mb-16"
        >
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold mb-3 sm:mb-4">
            Parse. Graph. Query.
          </h2>
          <p className="text-sm sm:text-base text-muted-foreground max-w-2xl mx-auto">
            Three pipelines, one graph. Your AI agent queries it through MCP tools.
          </p>
        </motion.div>

        <div className="space-y-12 sm:space-y-16 md:space-y-20">
          {/* Step 1: Parse — show indexing pipeline animation */}
          <StepRow step={steps[0]} index={0}>
            <IndexingDemo />
          </StepRow>

          {/* Step 2: Graph — show a graph illustration */}
          <StepRow step={steps[1]} index={1} reverse>
            <GraphIllustration />
          </StepRow>

          {/* Step 3: Query — interactive MCP tool call */}
          <StepRow step={steps[2]} index={2}>
            <ImpactAnalysisDemo />
          </StepRow>
        </div>
      </div>
    </section>
  )
}

function StepRow({ 
  step, 
  index, 
  children, 
  reverse = false 
}: { 
  step: typeof steps[0]
  index: number
  children: React.ReactNode
  reverse?: boolean 
}) {
  const Icon = step.icon

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5, delay: index * 0.1 }}
      className="grid lg:grid-cols-2 gap-6 sm:gap-8 items-center"
    >
      <div className={cn(reverse && "lg:order-2")}>
        <div className="flex items-start gap-3 sm:gap-4">
          <div className="flex items-center justify-center w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-accent/10 border border-accent/20 shrink-0">
            <Icon className="h-5 w-5 sm:h-6 sm:w-6 text-accent" />
          </div>
          <div>
            <div className="text-xs sm:text-sm text-accent font-mono mb-1">Step {step.number}</div>
            <h3 className="text-xl sm:text-2xl font-bold mb-2 sm:mb-3">{step.title}</h3>
            <p className="text-sm sm:text-base text-muted-foreground leading-relaxed">{step.description}</p>
          </div>
        </div>
      </div>

      <div className={cn(reverse && "lg:order-1")}>
        {children}
      </div>
    </motion.div>
  )
}

function IndexingDemo() {
  const [phase, setPhase] = useState<"idle" | "parsing" | "indexing" | "complete">("idle")
  const [progress, setProgress] = useState(0)

  const runDemo = () => {
    setPhase("parsing")
    setProgress(0)

    let p = 0
    const parseInterval = setInterval(() => {
      p += Math.random() * 20
      if (p >= 100) {
        clearInterval(parseInterval)
        setProgress(100)
        setPhase("indexing")
        
        setTimeout(() => {
          setPhase("complete")
        }, 800)
      } else {
        setProgress(Math.min(p, 95))
      }
    }, 100)
  }

  return (
    <motion.div 
      className="rounded-xl border bg-card overflow-hidden shadow-lg"
      whileHover={{ scale: 1.01 }}
      transition={{ duration: 0.2 }}
    >
      <div className="flex items-center justify-between px-3 sm:px-4 py-2 border-b bg-muted/50">
        <div className="flex items-center gap-2">
          <div className="flex gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500/60" />
            <span className="w-2.5 h-2.5 rounded-full bg-yellow-500/60" />
            <span className="w-2.5 h-2.5 rounded-full bg-green-500/60" />
          </div>
          <span className="text-xs sm:text-sm text-muted-foreground font-mono ml-2">Terminal</span>
        </div>
        {phase === "idle" && (
          <motion.button
            onClick={runDemo}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            className="px-3 py-1 text-xs font-medium rounded-lg bg-accent text-accent-foreground hover:bg-accent/90 transition-colors"
          >
            Run Demo
          </motion.button>
        )}
        {phase === "complete" && (
          <button
            onClick={() => {
              setPhase("idle")
              setProgress(0)
            }}
            className="px-3 py-1 text-xs font-medium rounded-lg bg-muted text-muted-foreground hover:bg-muted/80 transition-colors"
          >
            Reset
          </button>
        )}
      </div>
      <div className="p-3 sm:p-4 font-mono text-xs sm:text-sm space-y-2 min-h-[140px] sm:min-h-[160px]">
        <div className="text-muted-foreground">
          <span className="text-accent">$</span> pnpm --filter @codegraph/cli start extract ./src
        </div>
        
        <AnimatePresence mode="wait">
          {phase === "idle" && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="text-muted-foreground/50 text-xs sm:text-sm"
            >
              Click &quot;Run Demo&quot; to see indexing in action
            </motion.div>
          )}

          {(phase === "parsing" || phase === "indexing" || phase === "complete") && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="space-y-2"
            >
              <div className="flex items-center gap-2">
                {phase === "parsing" ? (
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                    className="w-3 h-3 sm:w-4 sm:h-4 border-2 border-accent border-t-transparent rounded-full"
                  />
                ) : (
                  <Check className="h-3 w-3 sm:h-4 sm:w-4 text-accent" />
                )}
                <span className="text-xs sm:text-sm">Parsing files...</span>
              </div>

              {phase !== "parsing" && (
                <div className="flex items-center gap-2">
                  {phase === "indexing" ? (
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                      className="w-3 h-3 sm:w-4 sm:h-4 border-2 border-accent border-t-transparent rounded-full"
                    />
                  ) : (
                    <Check className="h-3 w-3 sm:h-4 sm:w-4 text-accent" />
                  )}
                  <span className="text-xs sm:text-sm">Building knowledge graph...</span>
                </div>
              )}

              {phase === "complete" && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="pt-2 border-t border-border mt-2"
                >
                  <div className="text-accent flex items-center gap-2 text-xs sm:text-sm">
                    <Check className="h-3 w-3 sm:h-4 sm:w-4" />
                    Indexing complete. Ready to query.
                  </div>
                </motion.div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  )
}

function GraphIllustration() {
  return (
    <motion.div
      className="rounded-xl border bg-card overflow-hidden shadow-lg"
      whileHover={{ scale: 1.01 }}
      transition={{ duration: 0.2 }}
    >
      <div className="flex items-center justify-between px-3 sm:px-4 py-2 border-b bg-muted/50">
        <div className="flex items-center gap-2">
          <div className="flex gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500/60" />
            <span className="w-2.5 h-2.5 rounded-full bg-yellow-500/60" />
            <span className="w-2.5 h-2.5 rounded-full bg-green-500/60" />
          </div>
          <span className="text-xs sm:text-sm text-muted-foreground font-mono ml-2">FalkorDB</span>
        </div>
      </div>
      <div className="p-4 sm:p-6 font-mono text-xs sm:text-sm">
        <div className="text-muted-foreground mb-2">Sample relationships:</div>
        <ul className="space-y-1 text-foreground">
          <li><span className="text-accent">(:Function)</span> -[:CALLS]-&gt; <span className="text-accent">(:Function)</span></li>
          <li><span className="text-accent">(:File)</span> -[:IMPORTS]-&gt; <span className="text-accent">(:File)</span></li>
          <li><span className="text-accent">(:Class)</span> -[:EXTENDS]-&gt; <span className="text-accent">(:Class)</span></li>
          <li><span className="text-accent">(:Function)</span> -[:ABOUT]-&gt; <span className="text-accent">(:Entity)</span></li>
          <li><span className="text-accent">(:Person)</span> -[:SAID]-&gt; <span className="text-accent">(:Fact)</span></li>
        </ul>
      </div>
    </motion.div>
  )
}

function ImpactAnalysisDemo() {
  const [isExpanded, setIsExpanded] = useState(false)

  return (
    <TerminalBlock title="MCP Tool Call">
      <div className="space-y-3">
        <div className="text-muted-foreground text-xs sm:text-sm font-mono">
          search({"{"} action: <span className="text-accent">&quot;context&quot;</span>, symbol: <span className="text-accent">&quot;processPayment&quot;</span> {"}"})
        </div>
        <div className="border-t border-border pt-3">
          <motion.button
            onClick={() => setIsExpanded(!isExpanded)}
            whileHover={{ x: 2 }}
            className="flex items-center gap-2 text-accent mb-2 hover:underline text-xs sm:text-sm font-mono"
          >
            <ChevronRight className={cn("h-3 w-3 sm:h-4 sm:w-4 transition-transform", isExpanded && "rotate-90")} />
            Result: enriched context
          </motion.button>

          <AnimatePresence>
            {isExpanded && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="space-y-2 text-xs sm:text-sm overflow-hidden font-mono"
              >
                <div>
                  <span className="text-muted-foreground">callers:</span>
                  <ul className="ml-3 mt-1 text-foreground space-y-0.5">
                    <li>• checkout.ts:42</li>
                    <li>• orders.ts:118</li>
                    <li>• subscriptions.ts:67</li>
                  </ul>
                </div>
                <div className="flex flex-wrap gap-1 sm:gap-2">
                  <span className="text-muted-foreground">callees:</span>
                  <span className="text-foreground">7 functions across 3 files</span>
                </div>
                <div>
                  <span className="text-muted-foreground">linkedKnowledge:</span>
                  <span className="text-foreground ml-2">2 entities, 1 SAID fact</span>
                </div>
                <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border">
                  <span className="text-muted-foreground">complexity:</span>
                  <span className="text-foreground">cyclomatic 12, importerCount 3</span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {!isExpanded && (
            <p className="text-xs text-muted-foreground">Click to expand result</p>
          )}
        </div>
      </div>
    </TerminalBlock>
  )
}
