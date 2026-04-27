import { Navigation } from "@/components/landing/navigation"
import { HeroSection } from "@/components/landing/hero-section"
import { ProblemSection } from "@/components/landing/problem-section"
import { HowItWorksSection } from "@/components/landing/how-it-works-section"
import { MCPToolsSection } from "@/components/landing/mcp-tools-section"
import { SearchStrategiesSection } from "@/components/landing/search-strategies-section"
import { LanguageSupportSection } from "@/components/landing/language-support-section"
import { PerformanceSection } from "@/components/landing/performance-section"
import { ArchitectureSection } from "@/components/landing/architecture-section"
import { AgntkSection } from "@/components/landing/agntk-section"
import { FullStackSection } from "@/components/landing/full-stack-section"
// Pricing section disabled until open-core monetization model is decided.
// See docs/v6-execution-plan.md Chunk 5.
// import { PricingSection } from "@/components/landing/pricing-section"
import { TechCredibilityBar, NewsletterSection, Footer } from "@/components/landing/footer-section"

export default function LandingPage() {
  return (
    <main className="min-h-screen">
      <Navigation />
      <HeroSection />
      <ProblemSection />
      <HowItWorksSection />
      <MCPToolsSection />
      <SearchStrategiesSection />
      <div id="languages">
        <LanguageSupportSection />
      </div>
      <PerformanceSection />
      <ArchitectureSection />
      <AgntkSection />
      <FullStackSection />
      {/* Pricing section disabled — see docs/v6-execution-plan.md Chunk 5 */}
      <TechCredibilityBar />
      <NewsletterSection />
      <Footer />
    </main>
  )
}
