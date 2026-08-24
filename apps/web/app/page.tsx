import { AnalysisSection } from "@/components/landing/analysis-section"
import { AuroraBackground } from "@/components/landing/aurora-background"
import { ExplorerSection } from "@/components/landing/explorer-section"
import { Footer, TechnicalBar } from "@/components/landing/footer-section"
import { HeroSection } from "@/components/landing/hero-section"
import { KnowledgeSection } from "@/components/landing/knowledge-section"
import { Navigation } from "@/components/landing/navigation"
import { PlatformSection } from "@/components/landing/platform-section"
import { ReleaseSection } from "@/components/landing/release-section"
import { SetupSection } from "@/components/landing/setup-section"

export default function LandingPage() {
  return (
    <div className="relative min-h-screen overflow-x-clip">
      <AuroraBackground />
      <Navigation />
      <main>
        <HeroSection />
        <SetupSection />
        <ExplorerSection />
        <AnalysisSection />
        <KnowledgeSection />
        <PlatformSection />
        <ReleaseSection />
      </main>
      <TechnicalBar />
      <Footer />
    </div>
  )
}
