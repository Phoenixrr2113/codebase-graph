"use client"

import { useState } from "react"
import {
  KeyRound,
  Plus,
  Search,
  Eye,
  EyeOff,
  Trash2,
  Edit2,
  Globe,
  Mail,
  CreditCard,
  ShoppingBag,
  Briefcase,
  X,
  ExternalLink,
  Copy,
  Check,
} from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type CredentialCategory = "all" | "websites" | "email" | "finance" | "shopping" | "work"

interface Credential {
  id: string
  name: string
  category: CredentialCategory
  username: string
  password: string
  url?: string
  lastUsed: string
  icon: string
}

const credentials: Credential[] = [
  {
    id: "1",
    name: "Zillow",
    category: "websites",
    username: "marcus@example.com",
    password: "••••••••••••",
    url: "zillow.com",
    lastUsed: "2 hours ago",
    icon: "Z",
  },
  {
    id: "2",
    name: "LinkedIn",
    category: "work",
    username: "marcus.doe",
    password: "••••••••••••",
    url: "linkedin.com",
    lastUsed: "5 hours ago",
    icon: "in",
  },
  {
    id: "3",
    name: "Gmail",
    category: "email",
    username: "marcus.doe@gmail.com",
    password: "••••••••••••",
    url: "mail.google.com",
    lastUsed: "1 hour ago",
    icon: "G",
  },
  {
    id: "4",
    name: "Bank of America",
    category: "finance",
    username: "marcusdoe",
    password: "••••••••••••",
    url: "bankofamerica.com",
    lastUsed: "Yesterday",
    icon: "B",
  },
  {
    id: "5",
    name: "Amazon",
    category: "shopping",
    username: "marcus@example.com",
    password: "••••••••••••",
    url: "amazon.com",
    lastUsed: "3 days ago",
    icon: "a",
  },
  {
    id: "6",
    name: "Realtor.com",
    category: "websites",
    username: "marcus.investor",
    password: "••••••••••••",
    url: "realtor.com",
    lastUsed: "4 hours ago",
    icon: "R",
  },
]

const categories = [
  { id: "all" as const, label: "All", icon: KeyRound },
  { id: "websites" as const, label: "Websites", icon: Globe },
  { id: "email" as const, label: "Email", icon: Mail },
  { id: "finance" as const, label: "Finance", icon: CreditCard },
  { id: "shopping" as const, label: "Shopping", icon: ShoppingBag },
  { id: "work" as const, label: "Work", icon: Briefcase },
]

export function VaultPanel() {
  const [activeCategory, setActiveCategory] = useState<CredentialCategory>("all")
  const [searchQuery, setSearchQuery] = useState("")
  const [showAddModal, setShowAddModal] = useState(false)
  const [visiblePasswords, setVisiblePasswords] = useState<Set<string>>(new Set())
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const filteredCredentials = credentials.filter((cred) => {
    const matchesCategory = activeCategory === "all" || cred.category === activeCategory
    const matchesSearch =
      cred.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      cred.username.toLowerCase().includes(searchQuery.toLowerCase())
    return matchesCategory && matchesSearch
  })

  const togglePasswordVisibility = (id: string) => {
    const newVisible = new Set(visiblePasswords)
    if (newVisible.has(id)) {
      newVisible.delete(id)
    } else {
      newVisible.add(id)
    }
    setVisiblePasswords(newVisible)
  }

  const copyToClipboard = (id: string, text: string) => {
    navigator.clipboard.writeText(text)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const getCategoryIcon = (category: CredentialCategory) => {
    const cat = categories.find((c) => c.id === category)
    return cat?.icon || Globe
  }

  return (
    <div className="flex h-full flex-col gap-6 overflow-hidden pt-14 md:pt-0">
      {/* Header with search and filter */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold text-foreground">Credential Vault</h1>
            <p className="text-sm text-muted-foreground">Securely store credentials for the agent to access</p>
          </div>
          <Button className="gap-2 shrink-0" onClick={() => setShowAddModal(true)}>
            <Plus className="h-4 w-4" />
            Add Credential
          </Button>
        </div>

        {/* Search and Category Filter Row */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search credentials..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-lg border border-border bg-secondary py-2 pl-10 pr-4 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary"
            />
          </div>

          {/* Category Tabs */}
          <div className="flex gap-1 overflow-x-auto pb-1 sm:pb-0">
            {categories.map((category) => {
              const Icon = category.icon
              const count =
                category.id === "all"
                  ? credentials.length
                  : credentials.filter((c) => c.category === category.id).length

              return (
                <button
                  key={category.id}
                  onClick={() => setActiveCategory(category.id)}
                  className={cn(
                    "flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors",
                    activeCategory === category.id
                      ? "bg-primary text-primary-foreground"
                      : "bg-secondary text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span>{category.label}</span>
                  <span
                    className={cn(
                      "text-xs",
                      activeCategory === category.id ? "text-primary-foreground/70" : "text-muted-foreground",
                    )}
                  >
                    {count}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* Credentials List */}
      <div className="flex-1 overflow-y-auto">
        {filteredCredentials.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-secondary">
              <KeyRound className="h-6 w-6 text-muted-foreground" />
            </div>
            <div>
              <p className="font-medium text-foreground">No credentials found</p>
              <p className="text-sm text-muted-foreground">
                {searchQuery ? "Try a different search term" : "Add your first credential to get started"}
              </p>
            </div>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filteredCredentials.map((credential) => {
              const CategoryIcon = getCategoryIcon(credential.category)
              const isPasswordVisible = visiblePasswords.has(credential.id)

              return (
                <Card
                  key={credential.id}
                  className="group border-border bg-card transition-all hover:border-primary/30"
                >
                  <CardContent className="p-4">
                    {/* Header */}
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-primary/20 to-primary/5 text-sm font-bold text-primary">
                          {credential.icon}
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium text-foreground truncate">{credential.name}</p>
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <CategoryIcon className="h-3 w-3" />
                            <span className="capitalize">{credential.category}</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                        <button className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground">
                          <Edit2 className="h-3.5 w-3.5" />
                        </button>
                        <button className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Credentials */}
                    <div className="mt-4 space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-xs text-muted-foreground">Username</p>
                          <p className="text-sm text-foreground truncate">{credential.username}</p>
                        </div>
                        <button
                          onClick={() => copyToClipboard(`user-${credential.id}`, credential.username)}
                          className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
                        >
                          {copiedId === `user-${credential.id}` ? (
                            <Check className="h-3.5 w-3.5 text-primary" />
                          ) : (
                            <Copy className="h-3.5 w-3.5" />
                          )}
                        </button>
                      </div>

                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-xs text-muted-foreground">Password</p>
                          <p className="text-sm font-mono text-foreground">
                            {isPasswordVisible ? "MyS3cur3P@ss!" : "••••••••••••"}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            onClick={() => togglePasswordVisibility(credential.id)}
                            className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
                          >
                            {isPasswordVisible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                          </button>
                          <button
                            onClick={() => copyToClipboard(`pass-${credential.id}`, "MyS3cur3P@ss!")}
                            className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
                          >
                            {copiedId === `pass-${credential.id}` ? (
                              <Check className="h-3.5 w-3.5 text-primary" />
                            ) : (
                              <Copy className="h-3.5 w-3.5" />
                            )}
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Footer */}
                    <div className="mt-4 flex items-center justify-between border-t border-border pt-3">
                      <span className="text-xs text-muted-foreground">Used {credential.lastUsed}</span>
                      {credential.url && (
                        <a
                          href={`https://${credential.url}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
                        >
                          {credential.url}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}
      </div>

      {/* Add Credential Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <Card className="w-full max-w-md border-border bg-card">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-lg">Add Credential</CardTitle>
                <CardDescription>Store a new credential for the agent to use</CardDescription>
              </div>
              <button
                onClick={() => setShowAddModal(false)}
                className="rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
              >
                <X className="h-5 w-5" />
              </button>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Name</label>
                <input
                  type="text"
                  placeholder="e.g., Zillow, LinkedIn"
                  className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Category</label>
                <select className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground outline-none focus:border-primary">
                  {categories
                    .filter((c) => c.id !== "all")
                    .map((cat) => (
                      <option key={cat.id} value={cat.id}>
                        {cat.label}
                      </option>
                    ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Website URL</label>
                <input
                  type="url"
                  placeholder="https://example.com"
                  className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Username / Email</label>
                <input
                  type="text"
                  placeholder="your@email.com"
                  className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Password</label>
                <input
                  type="password"
                  placeholder="••••••••••••"
                  className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary"
                />
              </div>
              <div className="flex gap-3 pt-2">
                <Button variant="outline" className="flex-1 bg-transparent" onClick={() => setShowAddModal(false)}>
                  Cancel
                </Button>
                <Button className="flex-1" onClick={() => setShowAddModal(false)}>
                  Add Credential
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
