"use client"

import { motion } from "framer-motion"
import { Github, MessageCircle, FileText, ShoppingBag, GitGraph } from "lucide-react"

const techStats = [
  "42 languages",
  "Local-first architecture",
  "Knowledge graph powered",
  "AI-powered reranking",
  "Incremental indexing",
  "Zero cloud required",
]


const footerLinks = [
  { label: "Docs", href: "#", icon: FileText },
  { label: "GitHub", href: "https://github.com/agntk", icon: Github },
  { label: "Polar.sh", href: "https://polar.sh", icon: ShoppingBag },
  { label: "Discord", href: "#", icon: MessageCircle },
]

export function TechCredibilityBar() {
  return (
    <motion.section
      initial={{ opacity: 0 }}
      whileInView={{ opacity: 1 }}
      viewport={{ once: true }}
      transition={{ duration: 0.6 }}
      className="py-4 sm:py-6 px-4 sm:px-6 border-y border-border bg-muted/30 overflow-hidden"
    >
      <div className="max-w-5xl mx-auto">
        <div className="flex flex-wrap items-center justify-center gap-x-3 sm:gap-x-4 gap-y-1.5 sm:gap-y-2 text-[10px] sm:text-xs font-mono text-muted-foreground">
          {techStats.map((stat, i) => (
            <span key={stat} className="flex items-center gap-1.5 sm:gap-2">
              {i > 0 && <span className="hidden sm:inline text-border">|</span>}
              {stat}
            </span>
          ))}
        </div>
      </div>
    </motion.section>
  )
}

export function Footer() {
  return (
    <footer className="py-8 sm:py-12 px-4 sm:px-6">
      <div className="max-w-5xl mx-auto">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 sm:gap-6">
          {/* Logo */}
          <motion.div 
            whileHover={{ scale: 1.05 }}
            className="flex items-center gap-2 sm:gap-2.5"
          >
            <div className="flex items-center justify-center w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-accent/10 border border-accent/20">
              <GitGraph className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-accent" />
            </div>
            <span className="font-semibold text-sm sm:text-base">CodeGraph</span>
          </motion.div>

          {/* Links */}
          <nav className="flex items-center gap-3 sm:gap-5" aria-label="Footer links">
            {footerLinks.map((link) => (
              <motion.a
                key={link.label}
                href={link.href}
                target={link.href.startsWith("http") ? "_blank" : undefined}
                rel={link.href.startsWith("http") ? "noopener noreferrer" : undefined}
                whileHover={{ scale: 1.05, y: -1 }}
                whileTap={{ scale: 0.95 }}
                className="flex items-center gap-1.5 sm:gap-2 text-xs sm:text-sm text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-md p-1 -m-1"
                aria-label={link.label}
              >
                <link.icon className="h-4 w-4 sm:h-4 sm:w-4" />
                <span className="sr-only sm:not-sr-only">{link.label}</span>
              </motion.a>
            ))}
          </nav>
        </div>

        <div className="mt-6 sm:mt-8 pt-4 sm:pt-6 border-t border-border text-center">
          <p className="text-xs sm:text-sm text-muted-foreground">
            Built by a developer, for developers.
          </p>
          <p className="mt-1.5 sm:mt-2 text-[10px] sm:text-xs text-muted-foreground/70">
            2026 CodeGraph. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  )
}
