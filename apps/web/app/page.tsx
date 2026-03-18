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
import { PricingSection } from "@/components/landing/pricing-section"
import { TechCredibilityBar, Footer } from "@/components/landing/footer-section"

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
      <div id="pricing">
        <PricingSection />
      </div>
      <TechCredibilityBar />
      <Footer />
    </main>
  )
}
