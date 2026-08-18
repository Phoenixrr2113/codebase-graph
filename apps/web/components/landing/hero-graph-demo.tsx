"use client"

import { useEffect, useRef, useState } from "react"
import type cytoscape from "cytoscape"
import { cytoscapeStylesheet } from "@/lib/cytoscape-config"

// Sample auth-flow graph. Hand-curated; not pulled from a live database.
// Positions are pre-laid-out so the canvas paints instantly without a layout pass.
const sample = {
  nodes: [
    { id: "f-login", type: "File", label: "auth/login.ts", position: { x: 80, y: 80 } },
    { id: "f-mw", type: "File", label: "auth/middleware.ts", position: { x: 380, y: 80 } },
    { id: "f-session", type: "File", label: "auth/session.ts", position: { x: 230, y: 220 } },
    { id: "f-users", type: "File", label: "db/users.ts", position: { x: 80, y: 360 } },
    { id: "fn-login", type: "Function", label: "loginUser", position: { x: 80, y: 160 } },
    { id: "fn-validate", type: "Function", label: "validateCredentials", position: { x: 200, y: 160 } },
    { id: "fn-require", type: "Function", label: "requireAuth", position: { x: 380, y: 160 } },
    { id: "fn-verify", type: "Function", label: "verifyToken", position: { x: 480, y: 160 } },
    { id: "fn-create", type: "Function", label: "createSession", position: { x: 230, y: 300 } },
    { id: "fn-find", type: "Function", label: "findUserByEmail", position: { x: 80, y: 440 } },
    { id: "c-user", type: "Class", label: "User", position: { x: 200, y: 440 } },
    { id: "c-error", type: "Class", label: "AuthError", position: { x: 540, y: 80 } },
    { id: "i-jwt", type: "Interface", label: "JWTPayload", position: { x: 540, y: 220 } },
    { id: "t-session", type: "Type", label: "Session", position: { x: 380, y: 300 } },
  ],
  edges: [
    { source: "f-login", target: "fn-login", label: "CONTAINS" },
    { source: "f-login", target: "fn-validate", label: "CONTAINS" },
    { source: "f-mw", target: "fn-require", label: "CONTAINS" },
    { source: "f-mw", target: "fn-verify", label: "CONTAINS" },
    { source: "f-session", target: "fn-create", label: "CONTAINS" },
    { source: "f-users", target: "fn-find", label: "CONTAINS" },
    { source: "f-users", target: "c-user", label: "CONTAINS" },
    { source: "fn-login", target: "fn-validate", label: "CALLS" },
    { source: "fn-login", target: "fn-create", label: "CALLS" },
    { source: "fn-validate", target: "fn-find", label: "CALLS" },
    { source: "fn-require", target: "fn-verify", label: "CALLS" },
    { source: "fn-verify", target: "i-jwt", label: "CALLS" },
    { source: "fn-create", target: "t-session", label: "CALLS" },
    { source: "f-login", target: "f-users", label: "IMPORTS" },
    { source: "f-mw", target: "f-session", label: "IMPORTS" },
    { source: "fn-find", target: "c-user", label: "CALLS" },
    { source: "c-error", target: "i-jwt", label: "EXTENDS" },
  ],
}

const PULSE_ORDER = [
  "fn-login",
  "fn-validate",
  "fn-find",
  "c-user",
  "fn-create",
  "fn-require",
  "fn-verify",
]

export function HeroGraphDemo() {
  const containerRef = useRef<HTMLDivElement>(null)
  const cyRef = useRef<cytoscape.Core | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let mounted = true
    let pulseTimer: ReturnType<typeof setInterval> | null = null
    let pulseIndex = 0

    async function init() {
      if (!containerRef.current) return
      const cy = (await import("cytoscape")).default
      if (!mounted) return

      const elements = [
        ...sample.nodes.map((n) => ({
          data: { id: n.id, label: n.label, type: n.type },
          position: { ...n.position },
        })),
        ...sample.edges.map((e, i) => ({
          data: { id: `e${i}`, source: e.source, target: e.target, label: e.label },
        })),
      ]

      const instance = cy({
        container: containerRef.current,
        elements,
        style: cytoscapeStylesheet,
        layout: { name: "preset" } satisfies cytoscape.PresetLayoutOptions,
        userZoomingEnabled: false,
        userPanningEnabled: false,
        boxSelectionEnabled: false,
        autoungrabify: true,
      })

      instance.fit(undefined, 30)
      cyRef.current = instance
      setReady(true)

      pulseTimer = setInterval(() => {
        if (!cyRef.current) return
        const id = PULSE_ORDER[pulseIndex % PULSE_ORDER.length]
        pulseIndex += 1
        const node = cyRef.current.getElementById(id)
        if (!node || node.empty()) return

        cyRef.current.elements().removeClass("highlighted neighbor dimmed")
        const nbhd = node.neighborhood().add(node)
        cyRef.current.elements().not(nbhd).addClass("dimmed")
        nbhd.nodes().not(node).addClass("neighbor")
        node.addClass("highlighted")
      }, 1600)
    }

    init()

    return () => {
      mounted = false
      if (pulseTimer) clearInterval(pulseTimer)
      cyRef.current?.destroy()
      cyRef.current = null
    }
  }, [])

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="absolute inset-0" />
      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center text-xs font-mono text-muted-foreground">
          loading graph...
        </div>
      )}
    </div>
  )
}
