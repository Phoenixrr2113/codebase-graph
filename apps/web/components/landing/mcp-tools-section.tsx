"use client"

import { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Search, Brain, FolderTree, Terminal, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"

const tools = [
  {
    icon: Search,
    name: "Search",
    headline: "Find anything instantly",
    description: "Intelligent search with AI-powered reranking. Enriched results include complexity, callers, callees, and relationship data. Also provides deep context for any file or symbol.",
    capabilities: [
      "AI-powered reranking",
      "Enriched result metadata",
      "Caller & callee graphs",
      "Symbol context & relationships",
    ],
    example: {
      query: "Find all payment-related functions",
      result: "Found 12 matches across 5 files",
      details: [
        "processPayment() in payments/stripe.ts",
        "validateCard() in payments/validation.ts",
        "refundOrder() in payments/refunds.ts",
      ],
      latency: "47ms",
    },
    featured: true,
  },
  {
    icon: Brain,
    name: "Knowledge",
    headline: "Memory that persists",
    description: "Store decisions, architectural context, and conversations. Your AI assistant remembers what matters across sessions.",
    capabilities: [
      "Persistent memory",
      "Decision tracking",
      "Context recall",
      "Conversation history",
    ],
    example: {
      query: "Recall auth decisions",
      result: "3 relevant decisions found",
      details: [
        "Use JWT for API auth (Mar 2)",
        "Session timeout: 24h (Feb 28)",
        "OAuth2 for third-party (Feb 15)",
      ],
      latency: "31ms",
    },
  },
  {
    icon: FolderTree,
    name: "Codebase",
    headline: "Manage your projects",
    description: "Add projects, trigger re-indexing, monitor status. Full control over what CodeGraph knows about your code.",
    capabilities: [
      "Multi-project support",
      "Incremental re-indexing",
      "Status monitoring",
      "Source code access",
    ],
    example: {
      query: "Index status",
      result: "Ready - 847 files indexed",
      details: [
        "Functions: 1,247 extracted",
        "Classes: 89 mapped",
        "Last sync: 2 minutes ago",
      ],
      latency: "12ms",
    },
  },
  {
    icon: Terminal,
    name: "Query",
    headline: "Direct access for power users",
    description: "When you need precise control, query the knowledge graph directly. Read-only access with safety guardrails.",
    capabilities: [
      "Direct queries",
      "Custom traversals",
      "Advanced filtering",
      "Bulk operations",
    ],
    example: {
      query: "Functions with cyclomatic complexity > 15",
      result: "8 high-complexity functions",
      details: [
        "parseConfig() - complexity: 23",
        "routeHandler() - complexity: 19",
        "validateSchema() - complexity: 17",
      ],
      latency: "28ms",
    },
  },
]

export function MCPToolsSection() {
  const [activeToolIndex, setActiveToolIndex] = useState(0)
  const activeTool = tools[activeToolIndex]

  return (
    <section className="py-16 sm:py-20 md:py-24 px-4 sm:px-6">
      <div className="max-w-5xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center mb-10 sm:mb-12 md:mb-16"
        >
          <span className="inline-block px-3 py-1 rounded-full bg-accent/10 text-accent text-xs sm:text-sm font-medium mb-3 sm:mb-4">
            MCP Tools
          </span>
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold mb-3 sm:mb-4 text-balance">
            Powerful tools for your AI
          </h2>
          <p className="text-sm sm:text-base text-muted-foreground max-w-2xl mx-auto leading-relaxed">
            CodeGraph exposes your codebase through intelligent tools. Your AI editor picks the right one automatically based on what you ask.
          </p>
        </motion.div>

        {/* Interactive tool selector */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="grid lg:grid-cols-[280px_1fr] gap-4 sm:gap-6"
        >
          {/* Tool selector sidebar */}
          <div className="flex lg:flex-col gap-2 overflow-x-auto pb-2 lg:pb-0 lg:overflow-visible no-visible-scrollbar">
            {tools.map((tool, index) => {
              const Icon = tool.icon
              const isActive = index === activeToolIndex
              
              return (
                <motion.button
                  key={tool.name}
                  onClick={() => setActiveToolIndex(index)}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  className={cn(
                    "relative flex items-center gap-3 p-3 sm:p-4 rounded-xl text-left transition-all duration-300",
                    "border-2 min-w-[160px] sm:min-w-[200px] lg:min-w-0",
                    isActive
                      ? "bg-accent/10 border-accent shadow-lg shadow-accent/10"
                      : "bg-card/30 border-border hover:border-muted-foreground/30 hover:bg-muted/30"
                  )}
                >
                  {isActive && (
                    <motion.div
                      layoutId="tool-connector"
                      className="hidden lg:block absolute right-0 top-1/2 -translate-y-1/2 translate-x-full w-4 h-0.5 bg-accent"
                      transition={{ type: "spring", bounce: 0.2, duration: 0.5 }}
                    />
                  )}

                  <div className={cn(
                    "flex items-center justify-center w-9 h-9 sm:w-10 sm:h-10 rounded-lg shrink-0 transition-all duration-300",
                    isActive 
                      ? "bg-accent/20 text-accent scale-110" 
                      : "bg-muted text-muted-foreground"
                  )}>
                    <Icon className="h-4 w-4 sm:h-5 sm:w-5" />
                  </div>
                  
                  <div className="min-w-0">
                    <h4 className={cn(
                      "font-semibold text-sm transition-colors",
                      isActive ? "text-foreground" : "text-muted-foreground"
                    )}>
                      {tool.name}
                    </h4>
                    <p className="text-xs text-muted-foreground mt-0.5 hidden lg:block line-clamp-1">
                      {tool.headline}
                    </p>
                  </div>
                </motion.button>
              )
            })}
          </div>

          {/* Tool detail panel */}
          <div className="relative">
            <div className="hidden lg:block absolute left-0 top-0 bottom-0 w-px bg-border" />
            
            <AnimatePresence mode="wait">
              <motion.div
                key={activeTool.name}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.25 }}
                className="lg:pl-6"
              >
                <ToolDetail tool={activeTool} />
              </motion.div>
            </AnimatePresence>
          </div>
        </motion.div>

        <motion.p
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.3 }}
          className="mt-8 sm:mt-10 text-center text-xs sm:text-sm text-muted-foreground"
        >
          All tools work out of the box. AI-powered features activate when you bring your own LLM key.
        </motion.p>
      </div>
    </section>
  )
}

function ToolDetail({ tool }: { tool: typeof tools[0] }) {
  const Icon = tool.icon
  const [showDemo, setShowDemo] = useState(false)
  const [demoStep, setDemoStep] = useState(0)

  const runDemo = () => {
    setShowDemo(true)
    setDemoStep(0)
    // Animate through steps
    const timer1 = setTimeout(() => setDemoStep(1), 500)
    const timer2 = setTimeout(() => setDemoStep(2), 1200)
    const timer3 = setTimeout(() => setDemoStep(3), 2000)
    return () => {
      clearTimeout(timer1)
      clearTimeout(timer2)
      clearTimeout(timer3)
    }
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex items-start gap-3 sm:gap-4">
        <div className="flex items-center justify-center w-12 h-12 sm:w-14 sm:h-14 rounded-xl bg-accent/10 border border-accent/20">
          <Icon className="h-6 w-6 sm:h-7 sm:w-7 text-accent" />
        </div>
        <div>
          <h3 className="text-xl sm:text-2xl font-bold">{tool.headline}</h3>
          <p className="text-sm sm:text-base text-muted-foreground mt-1">{tool.description}</p>
        </div>
      </div>

      {/* Capabilities */}
      <div>
        <h4 className="text-xs sm:text-sm font-medium text-muted-foreground mb-2 sm:mb-3">What it does</h4>
        <div className="grid grid-cols-2 gap-2">
          {tool.capabilities.map((cap, i) => (
            <motion.div
              key={cap}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.2, delay: i * 0.05 }}
              className="flex items-center gap-2 text-xs sm:text-sm"
            >
              <div className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
              <span>{cap}</span>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Interactive Example */}
      <div className="rounded-xl border bg-card overflow-hidden shadow-lg">
        <div className="flex items-center justify-between px-3 sm:px-4 py-2 border-b bg-muted/50">
          <div className="flex items-center gap-2">
            <div className="flex gap-1.5">
              <span className="w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full bg-red-500/60" />
              <span className="w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full bg-yellow-500/60" />
              <span className="w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full bg-green-500/60" />
            </div>
            <span className="text-xs text-muted-foreground ml-2">Example</span>
          </div>
          <motion.button
            onClick={runDemo}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            className="px-2.5 py-1 text-xs font-medium rounded-md bg-accent/10 text-accent hover:bg-accent/20 transition-colors"
          >
            {showDemo ? "Run again" : "Try it"}
          </motion.button>
        </div>
        
        <div className="p-3 sm:p-4 space-y-2 sm:space-y-3 font-mono">
          {/* Query */}
          <div className="flex items-start gap-2">
            <span className="text-accent">$</span>
            <span className="text-xs sm:text-sm text-muted-foreground">
              {tool.example.query}
            </span>
          </div>

          {/* Animated result */}
          <AnimatePresence>
            {showDemo && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.3 }}
                className="space-y-1.5 sm:space-y-2 overflow-hidden"
              >
                {demoStep >= 1 && (
                  <motion.div
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="flex items-center gap-2 text-xs text-muted-foreground"
                  >
                    <span className="text-yellow-500">...</span>
                    <span>Searching knowledge graph</span>
                  </motion.div>
                )}
                {demoStep >= 2 && (
                  <motion.div
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="flex items-center gap-2 text-xs text-muted-foreground"
                  >
                    <span className="text-yellow-500">...</span>
                    <span>Analyzing results</span>
                  </motion.div>
                )}
                {demoStep >= 3 && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="mt-2 sm:mt-3 p-2.5 sm:p-3 rounded-lg bg-accent/10 border border-accent/20 space-y-2"
                  >
                    {/* Result header with latency */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-xs sm:text-sm text-accent font-medium">
                        <ChevronRight className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                        {tool.example.result}
                      </div>
                      <span className="text-[10px] sm:text-xs text-muted-foreground bg-background/50 px-1.5 py-0.5 rounded font-mono">
                        {tool.example.latency}
                      </span>
                    </div>
                    
                    {/* Detailed results */}
                    <div className="space-y-1 pt-1 border-t border-accent/20">
                      {tool.example.details.map((detail, i) => (
                        <motion.div
                          key={detail}
                          initial={{ opacity: 0, x: -5 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ duration: 0.15, delay: i * 0.1 }}
                          className="text-[10px] sm:text-xs text-muted-foreground pl-4 sm:pl-5 flex items-center gap-1.5"
                        >
                          <span className="w-1 h-1 rounded-full bg-muted-foreground/50 shrink-0" />
                          {detail}
                        </motion.div>
                      ))}
                    </div>
                  </motion.div>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Static result when not demoing */}
          {!showDemo && (
            <motion.div 
              className="flex items-start gap-2"
              initial={{ opacity: 0.5 }}
              animate={{ opacity: 0.5 }}
            >
              <ChevronRight className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground shrink-0 mt-0.5" />
              <span className="text-xs sm:text-sm text-muted-foreground italic">
                Click &quot;Try it&quot; to see the result
              </span>
            </motion.div>
          )}
        </div>
      </div>
    </div>
  )
}
