import { Briefcase, Home, ShoppingCart, FileText, Mail, TrendingUp } from "lucide-react"

const useCases = [
  {
    icon: Briefcase,
    title: "Job Hunting",
    description: "Apply to dozens of positions while you prep for interviews",
    example: '"Apply to 50 remote frontend jobs on LinkedIn and Indeed. Customize each cover letter."',
  },
  {
    icon: Home,
    title: "Real Estate",
    description: "Monitor listings, analyze deals, even draft offers",
    example: '"Find rental properties in Austin under $300K with good cash flow potential."',
  },
  {
    icon: ShoppingCart,
    title: "Price Monitoring",
    description: "Track competitor prices and get alerts on changes",
    example: '"Watch these 10 competitor products and alert me when prices drop."',
  },
  {
    icon: Mail,
    title: "Email & Outreach",
    description: "Draft, personalize, and send follow-ups at scale",
    example: '"Follow up with everyone who downloaded our whitepaper last week."',
  },
  {
    icon: FileText,
    title: "Research & Reports",
    description: "Gather data from multiple sources and compile summaries",
    example: '"Every Friday, compile a report on industry news from these 5 sites."',
  },
  {
    icon: TrendingUp,
    title: "Data Entry & Admin",
    description: "Move data between systems, update records, file paperwork",
    example: '"Sync new Salesforce leads to our spreadsheet every morning."',
  },
]

export function UseCases() {
  return (
    <section className="py-20 md:py-32">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-3xl font-bold tracking-tight md:text-4xl">What Will You Automate?</h2>
          <p className="mt-4 text-lg text-muted-foreground">If you can describe it, ControlAI can probably do it.</p>
        </div>

        <div className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {useCases.map((useCase) => (
            <div
              key={useCase.title}
              className="group rounded-2xl border border-border bg-card p-6 transition-all hover:border-primary/30"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                <useCase.icon className="h-6 w-6" />
              </div>
              <h3 className="mt-4 text-lg font-semibold">{useCase.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{useCase.description}</p>
              <p className="mt-4 rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">{useCase.example}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
