"use client"

import { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Check, ArrowRight, Sparkles, Zap } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const agntkFeatures = [
  "Open source (MIT)",
  "20+ built-in tools",
  "4-tier provider cascade",
  "Persistent agent memory",
  "Sub-agents with live streaming",
  "HTTP server + WebSocket client",
]

const codeGraphFeatures = [
  "One-time purchase",
  "Compiled binary (all platforms)",
  "5 MCP tools",
  "42 languages supported",
  "FalkorDBLite embedded",
  "Knowledge graph + memory",
  "94.4% search accuracy",
  "Enriched search results",
  "Cross-encoder reranking",
  "Free updates for 1 year",
]

export function PricingSection() {
  const [hoveredCard, setHoveredCard] = useState<"agntk" | "codegraph" | null>(null)

  return (
    <section className="py-16 sm:py-20 md:py-24 px-4 sm:px-6 bg-muted/30">
      <div className="max-w-5xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center mb-10 sm:mb-12"
        >
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold mb-3 sm:mb-4">
            Simple pricing
          </h2>
          <p className="text-sm sm:text-base text-muted-foreground">No subscriptions. No usage limits. Own your tools.</p>
        </motion.div>

        <div className="grid md:grid-cols-2 gap-4 sm:gap-6">
          {/* agntk Card */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            onMouseEnter={() => setHoveredCard("agntk")}
            onMouseLeave={() => setHoveredCard(null)}
            className={cn(
              "relative overflow-hidden rounded-2xl border p-5 sm:p-6 transition-all duration-300",
              hoveredCard === "agntk" 
                ? "bg-card border-muted-foreground/30 shadow-xl" 
                : "bg-card border-border"
            )}
          >
            <div className="mb-5 sm:mb-6">
              <div className="flex items-center justify-between mb-3 sm:mb-4">
                <div className="flex items-center gap-2">
                  <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-muted">
                    <Zap className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <h3 className="text-xl sm:text-2xl font-bold">agntk</h3>
                </div>
                <span className="px-3 py-1 text-xs sm:text-sm font-semibold rounded-full bg-muted text-muted-foreground">
                  Free
                </span>
              </div>
              <p className="text-xs sm:text-sm text-muted-foreground">The AI agent CLI for everyone</p>
            </div>

            <ul className="space-y-2.5 sm:space-y-3 mb-5 sm:mb-6">
              {agntkFeatures.map((feature, i) => (
                <motion.li 
                  key={feature} 
                  initial={{ opacity: 0, x: -10 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.3, delay: i * 0.05 }}
                  className="flex items-start gap-2"
                >
                  <Check className="h-4 w-4 sm:h-5 sm:w-5 text-muted-foreground shrink-0 mt-0.5" />
                  <span className="text-xs sm:text-sm text-muted-foreground">{feature}</span>
                </motion.li>
              ))}
            </ul>

            <Button variant="outline" className="w-full group" asChild>
              <a href="https://npmjs.com/package/agntk" target="_blank" rel="noopener noreferrer">
                <span className="text-xs sm:text-sm">npm install agntk</span>
                <ArrowRight className="ml-2 h-3.5 w-3.5 sm:h-4 sm:w-4 transition-transform group-hover:translate-x-1" />
              </a>
            </Button>
          </motion.div>

          {/* CodeGraph Card */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.1 }}
            onMouseEnter={() => setHoveredCard("codegraph")}
            onMouseLeave={() => setHoveredCard(null)}
            className={cn(
              "relative overflow-hidden rounded-2xl border p-5 sm:p-6 transition-all duration-300",
              hoveredCard === "codegraph" 
                ? "bg-card border-accent shadow-xl shadow-accent/10" 
                : "bg-card border-accent/50"
            )}
          >
            {/* Gradient overlay */}
            <div className="absolute inset-0 bg-gradient-to-br from-accent/10 via-transparent to-transparent pointer-events-none" />
            
            {/* Popular badge */}
            <div className="absolute top-3 sm:top-4 right-3 sm:right-4">
              <motion.div
                animate={{ scale: hoveredCard === "codegraph" ? [1, 1.1, 1] : 1 }}
                transition={{ duration: 0.5 }}
                className="flex items-center gap-1 px-2 py-1 rounded-full bg-accent/20 text-accent text-xs font-medium"
              >
                <Sparkles className="h-3 w-3" />
                <span className="hidden sm:inline">Most Popular</span>
                <span className="sm:hidden">Popular</span>
              </motion.div>
            </div>

            <div className="relative mb-5 sm:mb-6">
              <div className="flex items-center justify-between mb-3 sm:mb-4">
                <div className="flex items-center gap-2">
                  <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-accent/10">
                    <Sparkles className="h-4 w-4 text-accent" />
                  </div>
                  <h3 className="text-xl sm:text-2xl font-bold">CodeGraph</h3>
                </div>
                <div className="text-right">
                  <span className="text-2xl sm:text-3xl font-bold text-accent">$39</span>
                  <span className="text-xs sm:text-sm text-muted-foreground">/seat</span>
                </div>
              </div>
              <p className="text-xs sm:text-sm text-muted-foreground">Deep codebase understanding for AI</p>
            </div>

            <ul className="relative space-y-2.5 sm:space-y-3 mb-5 sm:mb-6 max-h-[220px] sm:max-h-[260px] overflow-y-auto pr-2 no-visible-scrollbar">
              {codeGraphFeatures.map((feature, i) => (
                <motion.li 
                  key={feature}
                  initial={{ opacity: 0, x: -10 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.3, delay: i * 0.03 }}
                  className="flex items-start gap-2"
                >
                  <Check className="h-4 w-4 sm:h-5 sm:w-5 text-accent shrink-0 mt-0.5" />
                  <span className="text-xs sm:text-sm">{feature}</span>
                </motion.li>
              ))}
            </ul>

            <Button className="w-full bg-accent text-accent-foreground hover:bg-accent/90 group" asChild>
              <a href="https://polar.sh" target="_blank" rel="noopener noreferrer">
                <span className="text-xs sm:text-sm">Buy on Polar.sh</span>
                <motion.span
                  className="ml-2"
                  animate={{ x: hoveredCard === "codegraph" ? [0, 4, 0] : 0 }}
                  transition={{ duration: 1, repeat: hoveredCard === "codegraph" ? Infinity : 0 }}
                >
                  <ArrowRight className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                </motion.span>
              </a>
            </Button>
          </motion.div>
        </div>

        {/* Comparison note */}
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.3 }}
          className="mt-8 sm:mt-12 p-4 sm:p-6 rounded-2xl border border-border bg-card/50"
        >
          <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
            <div>
              <h4 className="font-semibold mb-1 text-sm sm:text-base">Use together for maximum power</h4>
              <p className="text-xs sm:text-sm text-muted-foreground">
                CodeGraph works standalone in Claude Code, Cursor, or any MCP-compatible editor. 
                Pair with agntk for provider-independent AI development.
              </p>
            </div>
            <div className="flex items-center gap-2 sm:gap-3 shrink-0 text-xs sm:text-sm">
              <span className="text-muted-foreground">agntk</span>
              <span className="text-muted-foreground">+</span>
              <span className="text-accent font-medium">CodeGraph</span>
              <span className="text-muted-foreground">=</span>
              <span className="font-medium whitespace-nowrap">Full stack AI</span>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  )
}
