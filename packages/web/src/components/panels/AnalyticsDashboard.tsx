'use client';

/**
 * AnalyticsDashboard Component
 * Tabbed dashboard showing security findings, complexity hotspots, and summary analytics.
 * Uses types from the API service that match the actual server response shapes.
 */

import { useState, useMemo } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  getAnalyticsSummary,
  getSecurityAnalysis,
  getComplexityHotspots,
  runAnalysis,
} from '@/services/api';
import type {
  AnalyticsSummary,
  SecurityFinding,
  SecurityAnalysisResult,
  ComplexityEntry,
  ComplexityResult,
} from '@/services/api';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Shield, Activity, Play, AlertTriangle, Loader2 } from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AnalyticsDashboardProps {
  projectPath: string | undefined;
  className?: string;
}

type Tab = 'overview' | 'security' | 'complexity';

// ---------------------------------------------------------------------------
// Severity helpers
// ---------------------------------------------------------------------------

const SEVERITY_CONFIG: Record<string, { label: string; bg: string; text: string; border: string }> = {
  critical: { label: 'Critical', bg: 'bg-red-500/15', text: 'text-red-400', border: 'border-red-500/30' },
  high: { label: 'High', bg: 'bg-orange-500/15', text: 'text-orange-400', border: 'border-orange-500/30' },
  medium: { label: 'Medium', bg: 'bg-yellow-500/15', text: 'text-yellow-400', border: 'border-yellow-500/30' },
  low: { label: 'Low', bg: 'bg-slate-500/15', text: 'text-slate-400', border: 'border-slate-500/30' },
};

function SeverityBadge({ severity }: { severity: string }) {
  const fallback = { label: severity, bg: 'bg-slate-500/15', text: 'text-slate-400', border: 'border-slate-500/30' };
  const config = SEVERITY_CONFIG[severity.toLowerCase()] ?? fallback;
  return (
    <span
      className={cn(
        'inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium rounded border',
        config.bg,
        config.text,
        config.border,
      )}
    >
      {config.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function Skeleton({ className }: { className?: string }) {
  return <div className={cn('bg-slate-800/50 rounded animate-pulse', className)} />;
}

function CardSkeleton() {
  return (
    <div className="p-3 rounded-lg border border-slate-800 bg-slate-900/50 space-y-2">
      <Skeleton className="h-3 w-20" />
      <Skeleton className="h-6 w-12" />
    </div>
  );
}

function RowSkeleton() {
  return (
    <div className="flex items-center gap-3 px-3 py-2">
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-4 w-48 flex-1" />
      <Skeleton className="h-4 w-14" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AnalyticsDashboard({ projectPath, className }: AnalyticsDashboardProps) {
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const enabled = Boolean(projectPath);

  // ---- Queries ----
  const summaryQuery = useQuery({
    queryKey: ['analytics', 'summary', projectPath],
    queryFn: () => getAnalyticsSummary(projectPath!),
    enabled,
  });

  const securityQuery = useQuery({
    queryKey: ['analytics', 'security', projectPath],
    queryFn: () => getSecurityAnalysis(projectPath!),
    enabled,
  });

  const complexityQuery = useQuery({
    queryKey: ['analytics', 'complexity', projectPath],
    queryFn: () => getComplexityHotspots(projectPath!),
    enabled,
  });

  // ---- Run Analysis mutation ----
  const analysisMutation = useMutation({
    mutationFn: () => runAnalysis(projectPath!),
    onSuccess: () => {
      summaryQuery.refetch();
      securityQuery.refetch();
      complexityQuery.refetch();
    },
  });

  // ---- Derived data ----
  const summary: AnalyticsSummary | undefined = summaryQuery.data;

  const securityFindings = useMemo<SecurityFinding[]>(() => {
    const raw: SecurityAnalysisResult | undefined = securityQuery.data;
    if (!raw) return [];
    return raw.findings ?? [];
  }, [securityQuery.data]);

  const complexityEntries = useMemo<ComplexityEntry[]>(() => {
    const raw: ComplexityResult | undefined = complexityQuery.data;
    if (!raw) return [];
    return raw.hotspots ?? [];
  }, [complexityQuery.data]);

  // Sort complexity descending
  const sortedComplexity = useMemo(
    () => [...complexityEntries].sort((a, b) => b.complexity - a.complexity),
    [complexityEntries],
  );

  // ---- Tab definitions ----
  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: 'overview', label: 'Overview', icon: <Activity className="w-3 h-3" /> },
    { key: 'security', label: 'Security', icon: <Shield className="w-3 h-3" /> },
    { key: 'complexity', label: 'Complexity', icon: <AlertTriangle className="w-3 h-3" /> },
  ];

  return (
    <div className={cn('h-full min-h-0 flex flex-col', className)}>
      {/* Header */}
      <div className="shrink-0 p-3 border-b border-slate-800">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-medium text-slate-300">Analytics</h2>
          <Button
            size="sm"
            className="h-7 text-xs"
            disabled={analysisMutation.isPending || !projectPath}
            onClick={() => analysisMutation.mutate()}
          >
            {analysisMutation.isPending ? (
              <>
                <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                Running...
              </>
            ) : (
              <>
                <Play className="w-3 h-3 mr-1" />
                Run Analysis
              </>
            )}
          </Button>
        </div>

        {/* Analysis error */}
        {analysisMutation.error && (
          <div className="mb-2 px-2 py-1.5 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded">
            {analysisMutation.error.message}
          </div>
        )}

        {/* Tab toggle */}
        <div className="flex items-center gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                'px-2 py-1 text-xs rounded transition-colors flex items-center gap-1.5',
                activeTab === tab.key
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-400 hover:text-white',
              )}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-3">
          {activeTab === 'overview' && (
            <OverviewTab
              summary={summary}
              isLoading={summaryQuery.isLoading}
              securityCount={securityFindings.length}
              complexityCount={sortedComplexity.length}
            />
          )}
          {activeTab === 'security' && (
            <SecurityTab
              findings={securityFindings}
              isLoading={securityQuery.isLoading}
            />
          )}
          {activeTab === 'complexity' && (
            <ComplexityTab
              entries={sortedComplexity}
              isLoading={complexityQuery.isLoading}
            />
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overview tab
// ---------------------------------------------------------------------------

interface OverviewTabProps {
  summary: AnalyticsSummary | undefined;
  isLoading: boolean;
  securityCount: number;
  complexityCount: number;
}

function OverviewTab({ summary, isLoading, securityCount, complexityCount }: OverviewTabProps) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-3">
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  if (!summary && securityCount === 0 && complexityCount === 0) {
    return <EmptyState />;
  }

  // Build severity breakdown from the flat fields on the summary
  const severities: Record<string, number> = {};
  if (summary?.security) {
    const sec = summary.security;
    if (sec.critical > 0) severities['critical'] = sec.critical;
    if (sec.high > 0) severities['high'] = sec.high;
    if (sec.medium > 0) severities['medium'] = sec.medium;
    if (sec.low > 0) severities['low'] = sec.low;
  }

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3">
        {/* Total security findings */}
        <SummaryCard
          label="Security Findings"
          value={summary?.security?.total ?? securityCount}
          icon={<Shield className="w-4 h-4 text-red-400" />}
        />
        {/* Complexity hotspots */}
        <SummaryCard
          label="Complexity Hotspots"
          value={summary?.complexity?.hotspots ?? complexityCount}
          icon={<AlertTriangle className="w-4 h-4 text-amber-400" />}
        />
        {/* Average complexity */}
        {summary?.complexity?.avgComplexity != null && (
          <SummaryCard
            label="Avg Complexity"
            value={summary.complexity.avgComplexity.toFixed(1)}
            icon={<Activity className="w-4 h-4 text-cyan-400" />}
          />
        )}
        {/* Max complexity */}
        {summary?.complexity?.maxComplexity != null && (
          <SummaryCard
            label="Max Complexity"
            value={summary.complexity.maxComplexity}
            icon={<AlertTriangle className="w-4 h-4 text-red-400" />}
          />
        )}
      </div>

      {/* Severity breakdown */}
      {Object.keys(severities).length > 0 && (
        <div>
          <h3 className="text-xs uppercase tracking-wider text-slate-500 mb-2">
            Findings by Severity
          </h3>
          <div className="space-y-1.5">
            {Object.entries(severities).map(([sev, count]) => (
              <div
                key={sev}
                className="flex items-center justify-between px-3 py-1.5 rounded bg-slate-900/50 border border-slate-800"
              >
                <SeverityBadge severity={sev} />
                <span className="text-sm text-slate-300 font-medium">{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
}) {
  return (
    <div className="p-3 rounded-lg border border-slate-800 bg-slate-900/50">
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <span className="text-[10px] uppercase tracking-wider text-slate-500">{label}</span>
      </div>
      <div className="text-lg font-semibold text-slate-200">{value}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Security tab
// ---------------------------------------------------------------------------

interface SecurityTabProps {
  findings: SecurityFinding[];
  isLoading: boolean;
}

function SecurityTab({ findings, isLoading }: SecurityTabProps) {
  if (isLoading) {
    return (
      <div className="space-y-2">
        {[...Array(4)].map((_, i) => (
          <RowSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (findings.length === 0) {
    return (
      <div className="text-center py-8 space-y-2">
        <Shield className="w-8 h-8 mx-auto text-emerald-600" />
        <p className="text-xs text-slate-500">No security findings detected</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="text-xs text-slate-500 mb-1">
        {findings.length} finding{findings.length !== 1 ? 's' : ''}
      </div>
      {findings.map((f, idx) => (
        <div
          key={`${f.name}-${idx}`}
          className="p-3 rounded-lg border border-slate-800 bg-slate-900/50 space-y-1.5"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm text-slate-200 font-medium truncate">{f.name}</span>
            <SeverityBadge severity={f.severity} />
          </div>
          {f.filePath && (
            <div className="text-xs text-slate-500 font-mono truncate">{f.filePath}</div>
          )}
          {f.description && (
            <div className="text-xs text-slate-400 leading-relaxed">{f.description}</div>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Complexity tab
// ---------------------------------------------------------------------------

interface ComplexityTabProps {
  entries: ComplexityEntry[];
  isLoading: boolean;
}

function ComplexityTab({ entries, isLoading }: ComplexityTabProps) {
  if (isLoading) {
    return (
      <div className="space-y-2">
        {[...Array(4)].map((_, i) => (
          <RowSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (entries.length === 0) {
    return <EmptyState />;
  }

  return (
    <div className="space-y-1">
      {/* Table header */}
      <div className="grid grid-cols-[1fr_auto_auto] gap-2 px-3 py-1.5 text-[10px] uppercase tracking-wider text-slate-600 border-b border-slate-800">
        <span>Function / File</span>
        <span className="w-16 text-right">Complexity</span>
        <span className="w-14 text-right">Lines</span>
      </div>

      {/* Table rows */}
      {entries.map((entry, idx) => (
        <div
          key={`${entry.name}-${idx}`}
          className="grid grid-cols-[1fr_auto_auto] gap-2 px-3 py-2 rounded hover:bg-slate-800/50 transition-colors"
        >
          <div className="min-w-0">
            <div className="text-sm text-slate-300 truncate">{entry.name}</div>
            {entry.filePath && (
              <div className="text-xs text-slate-600 font-mono truncate">{entry.filePath}</div>
            )}
          </div>
          <div className="w-16 text-right">
            <span
              className={cn(
                'text-sm font-medium',
                entry.complexity >= 20
                  ? 'text-red-400'
                  : entry.complexity >= 10
                    ? 'text-amber-400'
                    : 'text-emerald-400',
              )}
            >
              {entry.complexity}
            </span>
          </div>
          <div className="w-14 text-right text-sm text-slate-500">
            {entry.lines ?? '-'}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState() {
  return (
    <div className="text-center py-8 space-y-2">
      <Activity className="w-8 h-8 mx-auto text-slate-600" />
      <p className="text-xs text-slate-500">
        Run Analysis to populate data
      </p>
    </div>
  );
}

export default AnalyticsDashboard;
