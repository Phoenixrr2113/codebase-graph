import { Navigation } from "@/components/landing/navigation"
import { HeroSection } from "@/components/landing/hero-section"
import { ProblemSection } from "@/components/landing/problem-section"
import { HowItWorksSection } from "@/components/landing/how-it-works-section"
import { FeaturesGridSection } from "@/components/landing/features-grid-section"
import { IntegrationsSection } from "@/components/landing/integrations-section"
import { ArchitectureSection } from "@/components/landing/architecture-section"
import { TechCredibilityBar, Footer } from "@/components/landing/footer-section"

export default function LandingPage() {
  return (
    <main className="min-h-screen">
      <Navigation />
      <HeroSection />
      <ProblemSection />
      <HowItWorksSection />
      <FeaturesGridSection />
      <IntegrationsSection />
      <ArchitectureSection />
      <TechCredibilityBar />
      <Footer />
    </main>
  )
}
