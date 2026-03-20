"use client"

import { useState } from "react"
import { motion } from "framer-motion"
import { ArrowRight, Terminal, Check, Copy, Layers, Zap, MessageSquare } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Spotlight } from "@/components/ui/spotlight"
import { RotatingText } from "@/components/ui/typewriter"
import { AnimatedCounter } from "@/components/ui/animated-counter"
import { PuzzleTabs } from "@/components/ui/puzzle-tabs"

const stats = [
  { value: 42, suffix: "", label: "languages" },
  { value: 100, suffix: "%", label: "local & private" },
  { value: 5, suffix: "", label: "MCP tools" },
]

export function HeroSection() {
  const configTabs = [
    {
      id: "claude",
      label: "Claude Desktop",
      icon: <MessageSquare className="w-4 h-4" />,
      content: (
        <CodeBlockInteractive
          filename="claude_desktop_config.json"
          code={`{
  "mcpServers": {
    "codegraph": {
      "command": "./codegraph-mcp",
      "env": { "CODEGRAPH_DRIVER": "embedded" }
    }
  }
}`}
        />
      ),
    },
    {
      id: "cursor",
      label: "Cursor",
      icon: <Layers className="w-4 h-4" />,
      content: (
        <CodeBlockInteractive
          filename=".cursor/mcp.json"
          code={`{
  "mcpServers": {
    "codegraph": {
      "command": "codegraph-mcp",
      "args": ["--driver", "embedded"]
    }
  }
}`}
        />
      ),
    },
    {
      id: "agntk",
      label: "agntk",
      icon: <Zap className="w-4 h-4" />,
      content: (
        <CodeBlockInteractive
          filename="Terminal"
          code={`npx agntk --mcp codegraph "analyze this codebase"

# Or configure permanently
export AGNTK_MCP_SERVERS="codegraph"`}
        />
      ),
    },
  ]

  return (
    <section className="relative min-h-screen flex flex-col items-center justify-center px-4 sm:px-6 py-24 md:py-32 overflow-hidden">
      <Spotlight
        className="-top-40 left-0 md:left-60 md:-top-20"
        fill="hsl(var(--accent))"
      />
      
      {/* Grid background */}
      <div className="absolute inset-0 [background-size:30px_30px] md:[background-size:40px_40px] [background-image:linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] opacity-30" />
      <div className="pointer-events-none absolute inset-0 bg-background [mask-image:radial-gradient(ellipse_at_center,transparent_20%,black)]" />

      <div className="relative z-10 w-full max-w-5xl mx-auto text-center">
        {/* Badge */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="mb-6"
        >
          <span className="inline-flex items-center gap-2 px-3 py-1.5 sm:px-4 rounded-full border border-accent/30 bg-accent/10 text-xs sm:text-sm text-accent">
            <Terminal className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
            MCP Server for AI Agents
          </span>
        </motion.div>

        {/* Main headline with rotating text */}
        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl xl:text-7xl font-bold tracking-tight text-balance leading-[1.1]"
        >
          Your AI agent doesn&apos;t{" "}
          <span className="text-accent inline-block" aria-live="polite" aria-atomic="true">
            <RotatingText 
              words={["understand", "navigate", "search", "remember"]}
              interval={2500}
            />
          </span>
          <br className="hidden sm:block" />
          <span className="sm:hidden"> </span>
          your codebase.
        </motion.h1>

        {/* Subheadline */}
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="mt-5 sm:mt-6 text-base sm:text-lg md:text-xl text-muted-foreground max-w-3xl mx-auto text-pretty leading-relaxed px-2"
        >
          CodeGraph builds a queryable knowledge graph of every function, class, and relationship
          in your codebase — then gives your AI assistant the tools to search, understand, and navigate it.
        </motion.p>

        {/* CTA buttons */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.3 }}
          className="mt-8 sm:mt-10 flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4"
        >
          <Button 
            size="lg" 
            className="w-full sm:w-auto text-sm sm:text-base px-6 sm:px-8 h-11 sm:h-12 bg-accent text-accent-foreground hover:bg-accent/90 group" 
            asChild
          >
            <a href="https://polar.sh" target="_blank" rel="noopener noreferrer">
              Get CodeGraph — $39/seat
              <motion.span 
                className="ml-2"
                animate={{ x: [0, 4, 0] }}
                transition={{ duration: 1.5, repeat: Infinity }}
              >
                <ArrowRight className="h-4 w-4" />
              </motion.span>
            </a>
          </Button>
          <Button 
            variant="outline" 
            size="lg" 
            className="w-full sm:w-auto text-sm sm:text-base px-6 sm:px-8 h-11 sm:h-12 group" 
            asChild
          >
            <a href="#agntk">
              Try agntk free
              <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
            </a>
          </Button>
        </motion.div>

        {/* Interactive config tabs - Puzzle style */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.4 }}
          className="mt-12 sm:mt-14 w-full max-w-xl mx-auto"
        >
          <PuzzleTabs tabs={configTabs} autoRotate rotateInterval={6000} />
        </motion.div>

        {/* Animated stats row */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.5 }}
          className="mt-12 sm:mt-14 grid grid-cols-3 gap-3 sm:gap-4 md:gap-6 max-w-2xl mx-auto"
          role="list"
          aria-label="Product statistics"
        >
          {stats.map((stat, index) => (
            <motion.div 
              key={stat.label} 
              role="listitem"
              className="text-center p-3 sm:p-4 rounded-xl bg-card/50 border border-border/50 hover:border-accent/40 hover:bg-card/80 transition-all duration-300 cursor-default"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.5 + index * 0.1 }}
              whileHover={{ scale: 1.03, y: -3 }}
            >
              <div className="text-2xl sm:text-3xl md:text-4xl font-bold text-foreground tabular-nums">
                <AnimatedCounter value={stat.value} suffix={stat.suffix} />
              </div>
              <div className="text-xs sm:text-sm text-muted-foreground mt-1.5 font-medium">{stat.label}</div>
            </motion.div>
          ))}
        </motion.div>

        {/* Local-first badge */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.6 }}
          className="mt-6 sm:mt-8 text-xs sm:text-sm text-muted-foreground"
        >
          Local-first. No data leaves your machine.
        </motion.p>
      </div>
    </section>
  )
}

function CodeBlockInteractive({ filename, code }: { filename: string; code: string }) {
  const [copied, setCopied] = useState(false)

  const copyToClipboard = async () => {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <motion.div 
      className="rounded-xl border bg-card overflow-hidden text-left shadow-lg"
      whileHover={{ scale: 1.01 }}
      transition={{ duration: 0.2 }}
    >
      <div className="flex items-center justify-between px-3 sm:px-4 py-2 border-b bg-muted/50">
        <div className="flex items-center gap-2 text-xs sm:text-sm text-muted-foreground">
          <div className="flex gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500/60" />
            <span className="w-2.5 h-2.5 rounded-full bg-yellow-500/60" />
            <span className="w-2.5 h-2.5 rounded-full bg-green-500/60" />
          </div>
          <span className="font-mono ml-2 truncate">{filename}</span>
        </div>
        <button
          onClick={copyToClipboard}
          className="p-1.5 rounded-md hover:bg-muted transition-colors"
          aria-label="Copy code"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-accent" />
          ) : (
            <Copy className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground" />
          )}
        </button>
      </div>
      <pre className="p-3 sm:p-4 overflow-x-auto text-xs sm:text-sm">
        <code className="font-mono text-foreground">{code}</code>
      </pre>
    </motion.div>
  )
}
