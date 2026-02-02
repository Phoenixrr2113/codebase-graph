import { LandingHero } from "@/features/landing/components/hero"
import { ProblemSection } from "@/features/landing/components/problem-section"
import { SolutionSection } from "@/features/landing/components/solution-section"
import { HowItWorks } from "@/features/landing/components/how-it-works"
import { PlatformCapabilities } from "@/features/landing/components/platform-capabilities"
import { UseCases } from "@/features/landing/components/use-cases"
import { Pricing } from "@/features/landing/components/pricing"
import { CtaSection } from "@/features/landing/components/cta-section"
import { LandingFooter } from "@/features/landing/components/footer"
import { LandingNav } from "@/features/landing/components/nav"

export default function Home() {
  return (
    <main className="min-h-screen bg-background">
      <LandingNav />
      <LandingHero />
      <ProblemSection />
      <SolutionSection />
      <HowItWorks />
      <UseCases />
      <PlatformCapabilities />
      <Pricing />
      <CtaSection />
      <LandingFooter />
    </main>
  )
}
