"use client"

import { useEffect, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { Github, GitGraph, Menu, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const navLinks = [
  { label: "Product", href: "#product" },
  { label: "Setup", href: "#setup" },
  { label: "Explorer", href: "#explorer" },
  { label: "Analysis", href: "#analysis" },
  { label: "Platform", href: "#platform" },
]

export function Navigation() {
  const [isScrolled, setIsScrolled] = useState(false)
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const [activeSection, setActiveSection] = useState("product")

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20)
      for (const link of [...navLinks].reverse()) {
        const section = document.getElementById(link.href.slice(1))
        const sectionTop = section?.getBoundingClientRect().top
        if (sectionTop !== undefined && sectionTop <= 160) {
          setActiveSection(link.href.slice(1))
          return
        }
      }
    }
    handleScroll()
    window.addEventListener("scroll", handleScroll, { passive: true })
    return () => window.removeEventListener("scroll", handleScroll)
  }, [])

  return (
    <header className={cn(
      "fixed inset-x-0 top-0 z-50 border-b border-transparent transition-colors",
      isScrolled && "border-border bg-background/90 backdrop-blur-xl",
    )}>
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
        <a href="#product" className="flex items-center gap-2.5 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" aria-label="CodeGraph home">
          <span className="flex size-8 items-center justify-center rounded-lg border border-accent/20 bg-accent/10">
            <GitGraph className="size-4 text-accent" aria-hidden="true" />
          </span>
          <span className="font-semibold">CodeGraph</span>
        </a>

        <nav className="hidden items-center gap-1 rounded-full border border-border bg-card/70 p-1 md:flex" aria-label="Main navigation">
          {navLinks.map((link) => {
            const isActive = activeSection === link.href.slice(1)
            return (
              <a
                key={link.label}
                href={link.href}
                aria-current={isActive ? "location" : undefined}
                className={cn(
                  "rounded-full px-3 py-1.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent lg:px-4 lg:text-sm",
                  isActive ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {link.label}
              </a>
            )
          })}
        </nav>

        <Button variant="outline" size="sm" className="hidden md:inline-flex" asChild>
          <a href="https://github.com/Phoenixrr2113/codebase-graph" target="_blank" rel="noopener noreferrer">
            <Github className="mr-2 size-4" aria-hidden="true" />
            GitHub
          </a>
        </Button>

        <button
          type="button"
          className="rounded-md p-2 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent md:hidden"
          onClick={() => setIsMobileMenuOpen((open) => !open)}
          aria-expanded={isMobileMenuOpen}
          aria-controls="mobile-navigation"
          aria-label={isMobileMenuOpen ? "Close navigation" : "Open navigation"}
        >
          {isMobileMenuOpen ? <X className="size-5" aria-hidden="true" /> : <Menu className="size-5" aria-hidden="true" />}
        </button>
      </div>

      <AnimatePresence>
        {isMobileMenuOpen && (
          <motion.nav
            id="mobile-navigation"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden border-t border-border bg-background/95 px-4 py-3 backdrop-blur-xl md:hidden"
            aria-label="Mobile navigation"
          >
            <div className="mx-auto grid max-w-6xl gap-1">
              {navLinks.map((link) => (
                <a
                  key={link.label}
                  href={link.href}
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="rounded-md px-3 py-3 text-sm text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  {link.label}
                </a>
              ))}
              <a
                href="https://github.com/Phoenixrr2113/codebase-graph"
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 flex items-center gap-2 rounded-md border border-border px-3 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <Github className="size-4" aria-hidden="true" />
                GitHub
              </a>
            </div>
          </motion.nav>
        )}
      </AnimatePresence>
    </header>
  )
}
