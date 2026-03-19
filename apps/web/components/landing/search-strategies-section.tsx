"use client"

import { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Zap, Sparkles, Play, Check } from "lucide-react"
import { cn } from "@/lib/utils"

const strategies = [
  {
    icon: Zap,
    name: "Local Mode",
    tagline: "Zero config, instant results",
    description: "Uses local embeddings with text matching and graph signals. No API keys needed — works out of the box.",
    useCase: "Quick search without external dependencies",
    demo: {
      query: "find all payment handlers",
      result: "15 matches across 4 files",
    },
  },
  {
    icon: Sparkles,
    name: "Cloud-Enhanced",
    tagline: "Maximum precision",
    description: "Cloud embeddings with AI-powered reranking. Returns enriched results with complexity, callers, and relationship data. Industry-leading accuracy.",
    useCase: "High-accuracy search with rich context",
    demo: {
      query: "error handling patterns",
      result: "10 matches, enriched with caller/callee data",
    },
  },
]

export function SearchStrategiesSection() {
  const [activeStrategy, setActiveStrategy] = useState<number | null>(null)
  const [demoRunning, setDemoRunning] = useState(false)

  const runDemo = (index: number) => {
    if (demoRunning) return
    setActiveStrategy(index)
    setDemoRunning(true)

    setTimeout(() => {
      setDemoRunning(false)
    }, 800)
  }

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
            One search pipeline, two modes
          </h2>
          <p className="text-sm sm:text-base text-muted-foreground max-w-2xl mx-auto">
            Works instantly with local embeddings. Add your cloud API keys to unlock AI-powered reranking for maximum accuracy.
          </p>
        </motion.div>

        <div className="grid sm:grid-cols-2 gap-3 sm:gap-4 max-w-3xl mx-auto">
          {strategies.map((strategy, i) => {
            const Icon = strategy.icon
            const isActive = activeStrategy === i

            return (
              <motion.div
                key={strategy.name}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.05 }}
              >
                <motion.button
                  onClick={() => runDemo(i)}
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.99 }}
                  className={cn(
                    "w-full text-left p-4 sm:p-5 rounded-xl border transition-all",
                    isActive 
                      ? "bg-card border-accent shadow-lg shadow-accent/10" 
                      : "bg-card border-border hover:border-accent/30"
                  )}
                >
                  <div className="flex items-start justify-between mb-2 sm:mb-3">
                    <div className="flex items-center gap-2">
                      <div className={cn(
                        "p-1.5 sm:p-2 rounded-lg transition-colors",
                        isActive ? "bg-accent/20" : "bg-muted"
                      )}>
                        <Icon className={cn(
                          "h-3.5 w-3.5 sm:h-4 sm:w-4",
                          isActive ? "text-accent" : "text-muted-foreground"
                        )} />
                      </div>
                      <div>
                        <span className="font-semibold text-sm sm:text-base block">{strategy.name}</span>
                        <span className="text-[10px] sm:text-xs text-accent">{strategy.tagline}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 sm:gap-2">
                      <Play className={cn(
                        "h-3 w-3 sm:h-3.5 sm:w-3.5",
                        isActive ? "text-accent" : "text-muted-foreground"
                      )} />
                    </div>
                  </div>

                  <p className="text-xs sm:text-sm text-muted-foreground mb-2 sm:mb-3 line-clamp-2">{strategy.description}</p>

                  <div className="text-[10px] sm:text-xs">
                    <span className="text-muted-foreground">Best for: </span>
                    <span className="text-foreground">{strategy.useCase}</span>
                  </div>

                  {/* Demo output */}
                  <AnimatePresence>
                    {isActive && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        className="mt-3 sm:mt-4 pt-3 sm:pt-4 border-t border-border overflow-hidden"
                      >
                        <div className="text-[10px] sm:text-xs space-y-2">
                          <div className="text-muted-foreground">
                            <span className="text-accent">Query:</span> {strategy.demo.query}
                          </div>
                          <motion.div
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ duration: 0.3, delay: 0.2 }}
                            className="flex items-center gap-1.5"
                          >
                            <Check className="h-3 w-3 text-accent" />
                            <span className="text-accent font-medium">{strategy.demo.result}</span>
                          </motion.div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.button>
              </motion.div>
            )
          })}
        </div>

        <motion.p
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.3 }}
          className="mt-6 sm:mt-8 text-center text-xs sm:text-sm text-muted-foreground"
        >
          Local mode works instantly with no setup. Cloud-enhanced mode activates when you add your API keys.
        </motion.p>
      </div>
    </section>
  )
}
