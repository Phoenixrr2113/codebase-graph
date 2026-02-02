"use client"

import type React from "react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ArrowRight, Check } from "lucide-react"

export function CtaSection() {
  const [email, setEmail] = useState("")
  const [submitted, setSubmitted] = useState(false)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (email) {
      setSubmitted(true)
    }
  }

  return (
    <section id="waitlist" className="relative overflow-hidden py-20 md:py-32">
      {/* Background */}
      <div className="absolute inset-0 bg-gradient-to-b from-primary/10 via-primary/5 to-transparent" />
      <div className="absolute left-1/2 top-1/2 h-[500px] w-[500px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/20 blur-[150px]" />

      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight md:text-4xl lg:text-5xl">
            Stop Doing Tasks
            <br />
            <span className="text-primary">Start Delegating Them</span>
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            Join the waitlist and be among the first to get your time back.
          </p>

          {submitted ? (
            <div className="mt-8 flex items-center justify-center gap-2 rounded-xl border border-primary/30 bg-primary/10 p-6">
              <Check className="h-5 w-5 text-primary" />
              <span className="font-medium text-primary">You&apos;re on the list! We&apos;ll be in touch soon.</span>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="mx-auto mt-8 flex max-w-md flex-col gap-3 sm:flex-row">
              <Input
                type="email"
                placeholder="Enter your email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-12 flex-1 bg-card"
                required
              />
              <Button type="submit" size="lg" className="glow-primary gap-2">
                Get Early Access
                <ArrowRight className="h-4 w-4" />
              </Button>
            </form>
          )}

          <p className="mt-4 text-xs text-muted-foreground">Free to try. No credit card required.</p>
        </div>
      </div>
    </section>
  )
}
