import { Navigation } from "@/components/landing/navigation"
import { HeroSection } from "@/components/landing/hero-section"
import { ProblemSection } from "@/components/landing/problem-section"
import { HowItWorksSection } from "@/components/landing/how-it-works-section"
import { FeaturesGridSection } from "@/components/landing/features-grid-section"
import { features } from "@/components/landing/features-data"
import { IntegrationsSection } from "@/components/landing/integrations-section"
import { integrations } from "@/components/landing/integrations-data"
import { ArchitectureSection } from "@/components/landing/architecture-section"
import { TechCredibilityBar, Footer } from "@/components/landing/footer-section"
import { AuroraBackground } from "@/components/landing/aurora-background"
import { highlight } from "@/lib/highlight"

export default async function LandingPage() {
  const featuresHighlighted = await Promise.all(
    features.map((f) => highlight(f.snippet, "ts"))
  )
  const integrationsHighlightedEntries = await Promise.all(
    integrations.map(async (i) => [i.id, await highlight(i.snippet, i.lang)] as const)
  )
  const integrationsHighlighted = Object.fromEntries(integrationsHighlightedEntries)

  return (
    <main className="min-h-screen relative">
      <AuroraBackground />
      <Navigation />
      <HeroSection />
      <ProblemSection />
      <HowItWorksSection />
      <FeaturesGridSection highlighted={featuresHighlighted} />
      <IntegrationsSection highlighted={integrationsHighlighted} />
      <ArchitectureSection />
      <TechCredibilityBar />
      <Footer />
    </main>
  )
}
