"use client"

import { useState, useEffect } from "react"
import { useTheme } from "next-themes"
import {
  User,
  Bell,
  Monitor,
  Shield,
  Palette,
  CreditCard,
  Check,
  Smartphone,
  Laptop,
  Trash2,
  Globe,
  Key,
  LogOut,
} from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"

type SettingsSection = "profile" | "notifications" | "devices" | "security" | "appearance" | "billing"

const settingsSections = [
  { id: "profile" as const, label: "Profile", icon: User },
  { id: "notifications" as const, label: "Notifications", icon: Bell },
  { id: "devices" as const, label: "Devices", icon: Monitor },
  { id: "security" as const, label: "Security", icon: Shield },
  { id: "appearance" as const, label: "Appearance", icon: Palette },
  { id: "billing" as const, label: "Billing", icon: CreditCard },
]

export function SettingsPanel() {
  const [activeSection, setActiveSection] = useState<SettingsSection>("profile")

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto pt-12 md:pt-0">
      <div className="sticky top-0 z-10 -mx-4 bg-background/95 px-4 pb-4 backdrop-blur supports-[backdrop-filter]:bg-background/60 md:-mx-6 md:px-6">
        <h1 className="mb-4 text-xl font-semibold text-foreground">Settings</h1>
        <div className="flex gap-1 overflow-x-auto pb-1">
          {settingsSections.map((section) => {
            const Icon = section.icon
            const isActive = activeSection === section.id

            return (
              <button
                key={section.id}
                onClick={() => setActiveSection(section.id)}
                className={cn(
                  "flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4" />
                {section.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Settings Content */}
      <div className="flex-1">
        {activeSection === "profile" && <ProfileSettings />}
        {activeSection === "notifications" && <NotificationSettings />}
        {activeSection === "devices" && <DeviceSettings />}
        {activeSection === "security" && <SecuritySettings />}
        {activeSection === "appearance" && <AppearanceSettings />}
        {activeSection === "billing" && <BillingSettings />}
      </div>
    </div>
  )
}

function ProfileSettings() {
  return (
    <div className="space-y-4">
      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-base">Profile Information</CardTitle>
          <CardDescription>Update your account details and preferences</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-primary/10 text-2xl font-semibold text-primary">
              JD
            </div>
            <div>
              <Button variant="outline" size="sm">
                Change Avatar
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">First Name</label>
              <input
                type="text"
                defaultValue="John"
                className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Last Name</label>
              <input
                type="text"
                defaultValue="Doe"
                className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Email</label>
            <input
              type="email"
              defaultValue="john@example.com"
              className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Timezone</label>
            <select className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground outline-none focus:border-primary">
              <option>America/New_York (EST)</option>
              <option>America/Los_Angeles (PST)</option>
              <option>Europe/London (GMT)</option>
            </select>
          </div>

          <div className="flex justify-end pt-2">
            <Button>Save Changes</Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-destructive/50 bg-card">
        <CardHeader>
          <CardTitle className="text-base text-destructive">Danger Zone</CardTitle>
          <CardDescription>Irreversible account actions</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-foreground">Delete Account</p>
            <p className="text-xs text-muted-foreground">Permanently delete your account and all data</p>
          </div>
          <Button variant="destructive" size="sm" className="w-full sm:w-auto">
            <Trash2 className="mr-2 h-4 w-4" />
            Delete Account
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

function NotificationSettings() {
  const [emailNotifications, setEmailNotifications] = useState(true)
  const [pushNotifications, setPushNotifications] = useState(true)
  const [missionUpdates, setMissionUpdates] = useState(true)
  const [approvalRequests, setApprovalRequests] = useState(true)
  const [weeklyDigest, setWeeklyDigest] = useState(false)

  return (
    <div className="space-y-4">
      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-base">Notification Channels</CardTitle>
          <CardDescription>Choose how you want to receive notifications</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">Email Notifications</p>
              <p className="text-xs text-muted-foreground">Receive updates via email</p>
            </div>
            <Switch checked={emailNotifications} onCheckedChange={setEmailNotifications} />
          </div>
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">Push Notifications</p>
              <p className="text-xs text-muted-foreground">Browser and mobile push alerts</p>
            </div>
            <Switch checked={pushNotifications} onCheckedChange={setPushNotifications} />
          </div>
        </CardContent>
      </Card>

      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-base">Notification Types</CardTitle>
          <CardDescription>Select which events trigger notifications</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">Mission Updates</p>
              <p className="text-xs text-muted-foreground">Progress and status changes</p>
            </div>
            <Switch checked={missionUpdates} onCheckedChange={setMissionUpdates} />
          </div>
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">Approval Requests</p>
              <p className="text-xs text-muted-foreground">When agent needs your decision</p>
            </div>
            <Switch checked={approvalRequests} onCheckedChange={setApprovalRequests} />
          </div>
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">Weekly Digest</p>
              <p className="text-xs text-muted-foreground">Summary of agent activity</p>
            </div>
            <Switch checked={weeklyDigest} onCheckedChange={setWeeklyDigest} />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function DeviceSettings() {
  const devices = [
    { name: "MacBook Pro", type: "Desktop Agent", lastActive: "Currently active", status: "connected" },
    { name: "Pixel 7", type: "Android (WebUSB)", lastActive: "2 hours ago", status: "connected" },
    { name: "Windows Workstation", type: "Desktop Agent", lastActive: "3 days ago", status: "disconnected" },
  ]

  return (
    <div className="space-y-4">
      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-base">Connected Devices</CardTitle>
          <CardDescription>Devices the agent can control for autonomous tasks</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {devices.map((device, index) => (
            <div
              key={index}
              className="flex flex-col gap-3 rounded-lg border border-border p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-secondary">
                  {device.type === "Desktop Agent" ? (
                    <Laptop className="h-5 w-5 text-muted-foreground" />
                  ) : (
                    <Smartphone className="h-5 w-5 text-muted-foreground" />
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">{device.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {device.type} • {device.lastActive}
                  </p>
                </div>
              </div>
              <div className="flex items-center justify-between gap-2 sm:justify-end">
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-xs font-medium",
                    device.status === "connected" ? "bg-primary/10 text-primary" : "bg-secondary text-muted-foreground",
                  )}
                >
                  {device.status === "connected" ? "Connected" : "Disconnected"}
                </span>
                <Button variant="ghost" size="sm" className="text-muted-foreground">
                  Remove
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="border-dashed border-border bg-card">
        <CardContent className="flex flex-col items-center justify-center py-8">
          <Monitor className="mb-3 h-8 w-8 text-muted-foreground" />
          <p className="mb-1 text-sm font-medium text-foreground">Add New Device</p>
          <p className="mb-4 text-center text-xs text-muted-foreground">
            Connect another device for the agent to control
          </p>
          <Button variant="outline" size="sm">
            <Globe className="mr-2 h-4 w-4" />
            Connect Device
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

function SecuritySettings() {
  const [twoFactor, setTwoFactor] = useState(false)

  return (
    <div className="space-y-4">
      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-base">Password</CardTitle>
          <CardDescription>Update your password regularly for better security</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Current Password</label>
            <input
              type="password"
              className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">New Password</label>
            <input
              type="password"
              className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Confirm New Password</label>
            <input
              type="password"
              className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
            />
          </div>
          <div className="flex justify-end pt-2">
            <Button>Update Password</Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-base">Two-Factor Authentication</CardTitle>
          <CardDescription>Add an extra layer of security to your account</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-secondary">
                <Key className="h-5 w-5 text-muted-foreground" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">Authenticator App</p>
                <p className="text-xs text-muted-foreground">Use an app like Google Authenticator</p>
              </div>
            </div>
            <Switch checked={twoFactor} onCheckedChange={setTwoFactor} />
          </div>
        </CardContent>
      </Card>

      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-base">Sessions</CardTitle>
          <CardDescription>Manage your active sessions across devices</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" className="w-full bg-transparent">
            <LogOut className="mr-2 h-4 w-4" />
            Sign Out All Other Sessions
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

const accentColors = [
  { name: "green", value: "#00ff88", cssValue: "oklch(0.85 0.2 155)" },
  { name: "blue", value: "#3b82f6", cssValue: "oklch(0.6 0.2 250)" },
  { name: "purple", value: "#a855f7", cssValue: "oklch(0.65 0.25 295)" },
  { name: "orange", value: "#f59e0b", cssValue: "oklch(0.8 0.15 85)" },
  { name: "red", value: "#ef4444", cssValue: "oklch(0.55 0.22 25)" },
]

function AppearanceSettings() {
  const { theme, setTheme, resolvedTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  const [accentColor, setAccentColor] = useState("#00ff88")

  useEffect(() => {
    setMounted(true)
    const savedAccent = localStorage.getItem("controlai-accent-color")
    if (savedAccent) {
      setAccentColor(savedAccent)
      applyAccentColor(savedAccent)
    }
  }, [])

  const applyAccentColor = (hexColor: string) => {
    const colorConfig = accentColors.find((c) => c.value === hexColor)
    if (colorConfig) {
      document.documentElement.style.setProperty("--primary", colorConfig.cssValue)
      document.documentElement.style.setProperty("--ring", colorConfig.cssValue)
      document.documentElement.style.setProperty("--sidebar-primary", colorConfig.cssValue)
      document.documentElement.style.setProperty("--sidebar-ring", colorConfig.cssValue)
    }
  }

  const handleAccentChange = (color: string) => {
    setAccentColor(color)
    applyAccentColor(color)
    localStorage.setItem("controlai-accent-color", color)
  }

  if (!mounted) {
    return (
      <div className="space-y-4">
        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle className="text-base">Theme</CardTitle>
            <CardDescription>Choose your preferred color scheme</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-2 sm:gap-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-20 animate-pulse rounded-lg bg-secondary" />
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-base">Theme</CardTitle>
          <CardDescription>Choose your preferred color scheme</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            {(["dark", "light", "system"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTheme(t)}
                className={cn(
                  "relative flex flex-col items-center gap-2 rounded-lg border p-3 transition-colors sm:p-4",
                  theme === t ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground",
                )}
              >
                <div
                  className={cn(
                    "h-10 w-10 rounded-lg sm:h-12 sm:w-12",
                    t === "dark"
                      ? "bg-zinc-900"
                      : t === "light"
                        ? "bg-zinc-100"
                        : "bg-gradient-to-br from-zinc-100 to-zinc-900",
                  )}
                />
                <span className="text-xs font-medium capitalize text-foreground sm:text-sm">{t}</span>
                {theme === t && (
                  <div className="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary sm:right-2 sm:top-2 sm:h-5 sm:w-5">
                    <Check className="h-2.5 w-2.5 text-primary-foreground sm:h-3 sm:w-3" />
                  </div>
                )}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-base">Accent Color</CardTitle>
          <CardDescription>Customize the primary accent color</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            {accentColors.map((color) => (
              <button
                key={color.value}
                onClick={() => handleAccentChange(color.value)}
                className={cn(
                  "h-8 w-8 rounded-full ring-2 ring-offset-2 ring-offset-background transition-all",
                  accentColor === color.value ? "ring-foreground" : "ring-transparent hover:ring-muted-foreground",
                )}
                style={{ backgroundColor: color.value }}
                title={color.name}
              />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function BillingSettings() {
  return (
    <div className="space-y-4">
      <Card className="border-primary/50 bg-card">
        <CardHeader>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-base">Pro Plan</CardTitle>
              <CardDescription>Your current subscription</CardDescription>
            </div>
            <span className="w-fit rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">Active</span>
          </div>
        </CardHeader>
        <CardContent>
          <div className="mb-4 flex items-baseline gap-1">
            <span className="text-3xl font-bold text-foreground">$49</span>
            <span className="text-muted-foreground">/month</span>
          </div>
          <ul className="mb-4 space-y-2">
            <li className="flex items-center gap-2 text-sm text-muted-foreground">
              <Check className="h-4 w-4 text-primary" />
              Unlimited missions
            </li>
            <li className="flex items-center gap-2 text-sm text-muted-foreground">
              <Check className="h-4 w-4 text-primary" />
              Up to 10 connected devices
            </li>
            <li className="flex items-center gap-2 text-sm text-muted-foreground">
              <Check className="h-4 w-4 text-primary" />
              Priority support
            </li>
          </ul>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button variant="outline" className="bg-transparent">
              Change Plan
            </Button>
            <Button variant="ghost" className="text-muted-foreground">
              Cancel Subscription
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-base">Payment Method</CardTitle>
          <CardDescription>Manage your billing information</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3 rounded-lg border border-border p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-secondary">
                <CreditCard className="h-5 w-5 text-muted-foreground" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">•••• •••• •••• 4242</p>
                <p className="text-xs text-muted-foreground">Expires 12/25</p>
              </div>
            </div>
            <Button variant="ghost" size="sm" className="text-muted-foreground">
              Update
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-base">Billing History</CardTitle>
          <CardDescription>Download past invoices</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {[
            { date: "Dec 1, 2024", amount: "$49.00" },
            { date: "Nov 1, 2024", amount: "$49.00" },
            { date: "Oct 1, 2024", amount: "$49.00" },
          ].map((invoice, index) => (
            <div key={index} className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
              <div>
                <p className="text-sm font-medium text-foreground">{invoice.date}</p>
                <p className="text-xs text-muted-foreground">{invoice.amount}</p>
              </div>
              <Button variant="ghost" size="sm" className="text-muted-foreground">
                Download
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
