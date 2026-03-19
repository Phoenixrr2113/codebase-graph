"use client"

import { motion } from "framer-motion"
import { Database, Route, Cpu, ArrowRight, ArrowDown, Check } from "lucide-react"

const bulletPoints = [
  {
    title: "Provider independence",
    description: "agntk routes to the cheapest/fastest model for each task. BYOK, local Ollama, or free tier.",
  },
  {
    title: "Context independence",
    description: "CodeGraph gives any model the codebase understanding that premium tools get for free.",
  },
  {
    title: "Your workflow doesn't stop",
    description: "Claude goes down? Point agntk at Qwen 3.5 via OpenRouter. CodeGraph feeds it context. You keep shipping.",
  },
]

export function FullStackSection() {
  return (
    <section className="py-16 sm:py-20 md:py-24 px-4 sm:px-6">
      <div className="max-w-5xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center mb-6"
        >
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold mb-3 sm:mb-4 text-balance">
            The context layer that makes cheap models smart
          </h2>
          <p className="text-sm sm:text-base text-muted-foreground max-w-2xl mx-auto">
            Claude Code is amazing. But what happens when caps tighten, prices change, or you need a fallback?
          </p>
        </motion.div>

        {/* Stack Visualization */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4 md:gap-8 p-4 sm:p-6 md:p-8 rounded-xl border border-border bg-card mb-10 sm:mb-12"
        >
          <StackItem 
            icon={Database} 
            label="CodeGraph" 
            sublabel="Knowledge graph" 
            highlight 
          />
          <StackArrow />
          <StackItem 
            icon={Route} 
            label="agntk" 
            sublabel="4-tier provider cascade" 
          />
          <StackArrow />
          <StackItem 
            icon={Cpu} 
            label="Any Model" 
            sublabel="OpenRouter / Ollama / Cerebras" 
          />
        </motion.div>

        {/* Bullet Points */}
        <div className="space-y-4 sm:space-y-6 max-w-3xl mx-auto">
          {bulletPoints.map((point, i) => (
            <motion.div
              key={point.title}
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: i * 0.1 }}
              whileHover={{ x: 4 }}
              className="flex items-start gap-3 sm:gap-4"
            >
              <div className="flex items-center justify-center w-5 h-5 sm:w-6 sm:h-6 rounded-full bg-accent/10 shrink-0 mt-0.5">
                <Check className="h-3 w-3 sm:h-4 sm:w-4 text-accent" />
              </div>
              <div>
                <h3 className="font-semibold text-sm sm:text-base mb-0.5 sm:mb-1">{point.title}</h3>
                <p className="text-xs sm:text-sm text-muted-foreground">{point.description}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}

function StackItem({ 
  icon: Icon, 
  label, 
  sublabel,
  highlight = false 
}: { 
  icon: React.ComponentType<{ className?: string }>
  label: string
  sublabel: string
  highlight?: boolean
}) {
  return (
    <motion.div 
      whileHover={{ scale: 1.05 }}
      transition={{ duration: 0.2 }}
      className="flex flex-col items-center gap-2 sm:gap-3 px-4 sm:px-6 py-3 sm:py-4 rounded-lg border border-border bg-muted/50"
    >
      <div className={`flex items-center justify-center w-10 h-10 sm:w-14 sm:h-14 rounded-lg ${highlight ? "bg-accent/20 border-accent/30" : "bg-card"} border transition-colors`}>
        <Icon className={`h-5 w-5 sm:h-7 sm:w-7 ${highlight ? "text-accent" : "text-muted-foreground"}`} />
      </div>
      <div className="text-center">
        <div className={`font-semibold text-sm sm:text-base ${highlight ? "text-accent" : "text-foreground"}`}>{label}</div>
        <div className="text-[10px] sm:text-xs text-muted-foreground">{sublabel}</div>
      </div>
    </motion.div>
  )
}

function StackArrow() {
  return (
    <>
      <div className="hidden sm:flex items-center text-muted-foreground">
        <ArrowRight className="h-4 w-4 sm:h-5 sm:w-5" />
      </div>
      <div className="sm:hidden text-muted-foreground">
        <ArrowDown className="h-4 w-4" />
      </div>
    </>
  )
}
