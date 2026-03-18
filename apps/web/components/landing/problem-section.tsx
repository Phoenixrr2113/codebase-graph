"use client"

import { motion } from "framer-motion"
import { AlertTriangle, Search, ShieldX, Brain, Check, X } from "lucide-react"
import { GlowCard } from "@/components/ui/moving-border"

const painPoints = [
  {
    icon: AlertTriangle,
    title: "Impact blindness",
    description: '"What breaks if I change this function?" Your agent greps and hopes.',
  },
  {
    icon: ShieldX,
    title: "No structural awareness",
    description: '"What calls this function? What does it depend on?" Your agent can\'t see relationships.',
  },
  {
    icon: Brain,
    title: "No structural memory",
    description: "Your agent re-reads the same files every session. It never builds a map.",
  },
]

const beforeItems = [
  "grep -r 'processPayment' ./src",
  "??? relationships unknown",
  "??? which files call which?",
  "??? safe to refactor?",
]

const afterItems = [
  "Direct callers: 3 functions",
  "Transitive deps: 12 across 5 files",
  "Test coverage: 6 tests, 2 files",
  "Risk score: MEDIUM",
]

export function ProblemSection() {
  return (
    <section className="py-16 sm:py-20 md:py-24 px-4 sm:px-6">
      <div className="max-w-6xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center mb-10 sm:mb-12 md:mb-16"
        >
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold mb-3 sm:mb-4 text-balance">
            AI agents are flying blind in your codebase
          </h2>
        </motion.div>

        {/* Pain point cards */}
        <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-4 sm:gap-6 mb-10 sm:mb-12 md:mb-16">
          {painPoints.map((point, i) => (
            <motion.div
              key={point.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: i * 0.1 }}
            >
              <GlowCard className="h-full">
                <div className="p-4 sm:p-6">
                  <div className="flex items-center justify-center w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-destructive/10 mb-3 sm:mb-4">
                    <point.icon className="h-5 w-5 sm:h-6 sm:w-6 text-destructive" />
                  </div>
                  <h3 className="text-base sm:text-lg font-semibold mb-1.5 sm:mb-2">{point.title}</h3>
                  <p className="text-sm sm:text-base text-muted-foreground leading-relaxed">{point.description}</p>
                </div>
              </GlowCard>
            </motion.div>
          ))}
        </div>

        {/* Before/After Comparison - cleaner design inspired by Fern */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="grid md:grid-cols-2 gap-4 sm:gap-6"
        >
          {/* Before */}
          <motion.div 
            className="rounded-xl border border-destructive/30 bg-destructive/5 overflow-hidden shadow-lg"
            whileHover={{ scale: 1.01 }}
            transition={{ duration: 0.2 }}
          >
            <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-destructive/20 flex items-center gap-2">
              <div className="flex items-center justify-center w-6 h-6 rounded-full bg-destructive/20">
                <X className="h-3.5 w-3.5 text-destructive" />
              </div>
              <span className="font-semibold text-sm sm:text-base text-destructive">Without CodeGraph</span>
            </div>
            <div className="p-4 sm:p-6 space-y-2.5 sm:space-y-3">
              {beforeItems.map((item, i) => (
                <motion.div 
                  key={i} 
                  initial={{ opacity: 0, x: -10 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.3, delay: i * 0.1 }}
                  className="flex items-center gap-2.5 sm:gap-3 text-xs sm:text-sm font-mono"
                >
                  <Search className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground shrink-0" />
                  <span className={i === 0 ? "text-foreground" : "text-destructive/80"}>
                    {item}
                  </span>
                </motion.div>
              ))}
            </div>
          </motion.div>

          {/* After */}
          <motion.div 
            className="rounded-xl border border-accent/30 bg-accent/5 overflow-hidden shadow-lg"
            whileHover={{ scale: 1.01 }}
            transition={{ duration: 0.2 }}
          >
            <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-accent/20 flex items-center gap-2">
              <div className="flex items-center justify-center w-6 h-6 rounded-full bg-accent/20">
                <Check className="h-3.5 w-3.5 text-accent" />
              </div>
              <span className="font-semibold text-sm sm:text-base text-accent">With CodeGraph</span>
            </div>
            <div className="p-4 sm:p-6 space-y-2.5 sm:space-y-3">
              {afterItems.map((item, i) => (
                <motion.div 
                  key={i}
                  initial={{ opacity: 0, x: -10 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.3, delay: i * 0.1 }}
                  className="flex items-center gap-2.5 sm:gap-3 text-xs sm:text-sm font-mono"
                >
                  <Check className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-accent shrink-0" />
                  <span className="text-foreground">{item}</span>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </motion.div>
      </div>
    </section>
  )
}
