"use client"

import { useState } from "react"
import { motion } from "framer-motion"
import { Check, ArrowRight, Sparkles, MessageSquare } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const codeGraphFeatures = [
  "One-time purchase",
  "Compiled binary (all platforms)",
  "MCP tools for any AI editor",
  "42 languages supported",
  "Embedded graph database",
  "Knowledge graph + memory",
  "Industry-leading search accuracy",
  "Enriched search results",
  "AI-powered result reranking",
  "Free updates for 1 year",
]


const customFeatures = [
  "Everything in CodeGraph",
  "Volume licensing",
  "Custom integrations",
  "Priority support",
  "Custom language support",
  "On-premise deployment",
  "Dedicated onboarding",
  "SLA guarantees",
]

export function PricingSection() {
  const [hoveredCard, setHoveredCard] = useState<"codegraph" | "custom" | null>(null)

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

        <div className="grid md:grid-cols-2 gap-4 sm:gap-6 max-w-5xl mx-auto">
          {/* CodeGraph Card — Most Popular */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
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

            <div className="relative mb-5 sm:mb-6">
              <div className="flex items-center gap-2 mb-2">
                <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-accent/10">
                  <Sparkles className="h-4 w-4 text-accent" />
                </div>
                <h3 className="text-xl sm:text-2xl font-bold">CodeGraph</h3>
                <motion.div
                  animate={{ scale: hoveredCard === "codegraph" ? [1, 1.1, 1] : 1 }}
                  transition={{ duration: 0.5 }}
                  className="flex items-center gap-1 px-2 py-1 rounded-full bg-accent/20 text-accent text-xs font-medium"
                >
                  <Sparkles className="h-3 w-3" />
                  <span>Most Popular</span>
                </motion.div>
              </div>
              <div className="mb-3">
                <span className="text-3xl sm:text-4xl font-bold text-accent">$39</span>
                <span className="text-sm text-muted-foreground">/seat</span>
              </div>
              <p className="text-xs sm:text-sm text-muted-foreground">Deep codebase understanding for AI</p>
            </div>

            <ul className="relative space-y-2.5 sm:space-y-3 mb-5 sm:mb-6">
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

          {/* Custom Card */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.1 }}
            onMouseEnter={() => setHoveredCard("custom")}
            onMouseLeave={() => setHoveredCard(null)}
            className={cn(
              "relative overflow-hidden rounded-2xl border p-5 sm:p-6 transition-all duration-300",
              hoveredCard === "custom" 
                ? "bg-card border-muted-foreground/30 shadow-xl" 
                : "bg-card border-border"
            )}
          >
            <div className="mb-5 sm:mb-6">
              <div className="flex items-center gap-2 mb-2">
                <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-muted">
                  <MessageSquare className="h-4 w-4 text-muted-foreground" />
                </div>
                <h3 className="text-xl sm:text-2xl font-bold">Custom</h3>
              </div>
              <div className="mb-3">
                <span className="text-3xl sm:text-4xl font-bold">Let&apos;s talk</span>
              </div>
              <p className="text-xs sm:text-sm text-muted-foreground">For teams with specific requirements</p>
            </div>

            <ul className="space-y-2.5 sm:space-y-3 mb-5 sm:mb-6">
              {customFeatures.map((feature, i) => (
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
              <a href="mailto:contact@codegraph.dev">
                <span className="text-xs sm:text-sm">Get in touch</span>
                <ArrowRight className="ml-2 h-3.5 w-3.5 sm:h-4 sm:w-4 transition-transform group-hover:translate-x-1" />
              </a>
            </Button>
          </motion.div>
        </div>
      </div>
    </section>
  )
}
