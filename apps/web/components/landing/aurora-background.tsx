"use client"

import { motion } from "framer-motion"

// Three drifting radial-gradient blobs that sit fixed behind the page.
// Low opacity so content stays readable; subtle long-loop drift breaks the
// flat-black-canvas feel without becoming distracting.
export function AuroraBackground() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
    >
      {/* Accent green - top left */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{
          opacity: [0.35, 0.5, 0.35],
          x: [0, 60, -20, 0],
          y: [0, -30, 40, 0],
        }}
        transition={{ duration: 22, repeat: Infinity, ease: "easeInOut" }}
        className="absolute -top-32 -left-32 h-[60vw] w-[60vw] max-h-[800px] max-w-[800px] rounded-full"
        style={{
          background:
            "radial-gradient(closest-side, oklch(0.65 0.18 145 / 0.35), transparent 75%)",
          filter: "blur(40px)",
        }}
      />
      {/* Cool indigo - bottom right */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{
          opacity: [0.25, 0.4, 0.25],
          x: [0, -50, 30, 0],
          y: [0, 30, -20, 0],
        }}
        transition={{ duration: 28, repeat: Infinity, ease: "easeInOut", delay: 4 }}
        className="absolute -bottom-32 -right-32 h-[55vw] w-[55vw] max-h-[700px] max-w-[700px] rounded-full"
        style={{
          background:
            "radial-gradient(closest-side, oklch(0.6 0.2 265 / 0.32), transparent 75%)",
          filter: "blur(60px)",
        }}
      />
      {/* Warm magenta - mid right */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{
          opacity: [0.18, 0.3, 0.18],
          x: [0, 40, -30, 0],
          y: [0, 50, -40, 0],
        }}
        transition={{ duration: 32, repeat: Infinity, ease: "easeInOut", delay: 9 }}
        className="absolute top-1/3 right-1/4 h-[40vw] w-[40vw] max-h-[500px] max-w-[500px] rounded-full"
        style={{
          background:
            "radial-gradient(closest-side, oklch(0.62 0.22 340 / 0.25), transparent 75%)",
          filter: "blur(80px)",
        }}
      />

      {/* Subtle grain overlay so the gradients don't look like flat washes */}
      <div
        className="absolute inset-0 opacity-[0.03] mix-blend-overlay"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
        }}
      />
    </div>
  )
}
