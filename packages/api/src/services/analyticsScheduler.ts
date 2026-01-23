/**
 * Analytics Scheduler Configuration
 * 
 * Configurable scheduling for analytics execution.
 * 
 * @module services/analyticsScheduler
 */

/**
 * Schedule trigger types
 */
export type TriggerType = 
  | 'ingestion'      // After parseProject completes
  | 'file_change'    // File watch detects change
  | 'git_commit'     // Git hook or poll
  | 'periodic'       // Cron-based
  | 'manual';        // API request

/**
 * Analysis types that can be scheduled
 */
export type ScheduledAnalysis = 
  | 'security'
  | 'complexity'
  | 'refactoring'
  | 'dataflow'
  | 'impact'
  | 'full';

/**
 * Periodic schedule configuration
 */
export interface PeriodicSchedule {
  /** Unique name for this schedule */
  name: string;
  /** Cron expression (e.g., "0 2 * * 0" for Sunday 2am) */
  cron: string;
  /** Which analyses to run */
  analyses: ScheduledAnalysis[];
  /** Whether this schedule is enabled */
  enabled: boolean;
}

/**
 * Full scheduler configuration
 */
export interface SchedulerConfig {
  /** Run analytics after project ingestion */
  onIngestion: {
    enabled: boolean;
    analyses: ScheduledAnalysis[];
  };
  
  /** Run analytics on file changes (from watch service) */
  onFileChange: {
    enabled: boolean;
    /** Debounce time in ms to batch rapid changes */
    debounceMs: number;
    /** Which analyses to run */
    analyses: ScheduledAnalysis[];
  };
  
  /** Run analytics on git commits */
  onGitCommit: {
    enabled: boolean;
    /** Only analyze changed files */
    deltaOnly: boolean;
    analyses: ScheduledAnalysis[];
  };
  
  /** Periodic schedules */
  periodic: PeriodicSchedule[];
}

/**
 * Default scheduler configuration
 */
export const DEFAULT_SCHEDULER_CONFIG: SchedulerConfig = {
  onIngestion: {
    enabled: true,
    analyses: ['security', 'complexity'],
  },
  onFileChange: {
    enabled: true,
    debounceMs: 5000,
    analyses: ['security', 'dataflow'],
  },
  onGitCommit: {
    enabled: false,  // Requires git hook setup
    deltaOnly: true,
    analyses: ['security'],
  },
  periodic: [
    {
      name: 'weekly-full-scan',
      cron: '0 2 * * 0',  // Sunday 2am
      analyses: ['full'],
      enabled: true,
    },
    {
      name: 'daily-security',
      cron: '0 6 * * *',  // Daily 6am
      analyses: ['security'],
      enabled: false,
    },
  ],
};

/**
 * Queued analysis job
 */
interface AnalysisJob {
  id: string;
  projectPath: string;
  filePath: string | undefined;
  analyses: ScheduledAnalysis[];
  trigger: TriggerType;
  createdAt: Date;
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: unknown;
  error?: string;
}

/**
 * Analytics Scheduler
 * 
 * Manages when and how analytics are executed.
 */
export class AnalyticsScheduler {
  private config: SchedulerConfig;
  private jobs: Map<string, AnalysisJob> = new Map();
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  private cronJobs: Map<string, NodeJS.Timeout> = new Map();
  private jobIdCounter = 0;
  
  // Callback for executing analysis
  private onExecute?: (job: AnalysisJob) => Promise<void>;

  constructor(config: Partial<SchedulerConfig> = {}) {
    this.config = {
      onIngestion: { ...DEFAULT_SCHEDULER_CONFIG.onIngestion, ...config.onIngestion },
      onFileChange: { ...DEFAULT_SCHEDULER_CONFIG.onFileChange, ...config.onFileChange },
      onGitCommit: { ...DEFAULT_SCHEDULER_CONFIG.onGitCommit, ...config.onGitCommit },
      periodic: config.periodic ?? DEFAULT_SCHEDULER_CONFIG.periodic,
    };
  }

  /**
   * Set the execution callback
   */
  setExecuteCallback(callback: (job: AnalysisJob) => Promise<void>): void {
    this.onExecute = callback;
  }

  /**
   * Queue analysis after ingestion
   */
  async onIngestionComplete(projectPath: string): Promise<string | null> {
    if (!this.config.onIngestion.enabled) return null;
    
    return this.queueJob({
      projectPath,
      analyses: this.config.onIngestion.analyses,
      trigger: 'ingestion',
    });
  }

  /**
   * Queue analysis for file change (with debouncing)
   */
  queueFileChange(projectPath: string, filePath: string): void {
    if (!this.config.onFileChange.enabled) return;
    
    const key = `file:${filePath}`;
    
    // Clear existing timer for this file
    const existingTimer = this.debounceTimers.get(key);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }
    
    // Set new debounced timer
    const timer = setTimeout(() => {
      this.debounceTimers.delete(key);
      this.queueJob({
        projectPath,
        filePath,
        analyses: this.config.onFileChange.analyses,
        trigger: 'file_change',
      });
    }, this.config.onFileChange.debounceMs);
    
    this.debounceTimers.set(key, timer);
  }

  /**
   * Queue analysis for git commit
   */
  async onGitCommit(projectPath: string, changedFiles: string[]): Promise<string[]> {
    if (!this.config.onGitCommit.enabled) return [];
    
    const jobIds: string[] = [];
    
    if (this.config.onGitCommit.deltaOnly) {
      // Queue individual file analyses
      for (const filePath of changedFiles) {
        const jobId = await this.queueJob({
          projectPath,
          filePath,
          analyses: this.config.onGitCommit.analyses,
          trigger: 'git_commit',
        });
        if (jobId) jobIds.push(jobId);
      }
    } else {
      // Queue full project analysis
      const jobId = await this.queueJob({
        projectPath,
        analyses: this.config.onGitCommit.analyses,
        trigger: 'git_commit',
      });
      if (jobId) jobIds.push(jobId);
    }
    
    return jobIds;
  }

  /**
   * Start periodic schedules
   */
  startPeriodicSchedules(projectPath: string): void {
    for (const schedule of this.config.periodic) {
      if (!schedule.enabled) continue;
      
      // Parse cron and schedule (simplified - production would use node-cron)
      const interval = this.cronToMs(schedule.cron);
      if (interval <= 0) continue;
      
      const timer = setInterval(() => {
        this.queueJob({
          projectPath,
          analyses: schedule.analyses,
          trigger: 'periodic',
        });
      }, interval);
      
      this.cronJobs.set(schedule.name, timer);
    }
  }

  /**
   * Stop all periodic schedules
   */
  stopPeriodicSchedules(): void {
    for (const timer of this.cronJobs.values()) {
      clearInterval(timer);
    }
    this.cronJobs.clear();
  }

  /**
   * Queue a job and optionally execute immediately
   */
  private async queueJob(params: {
    projectPath: string;
    filePath?: string;
    analyses: ScheduledAnalysis[];
    trigger: TriggerType;
  }): Promise<string> {
    const job: AnalysisJob = {
      id: `job-${++this.jobIdCounter}`,
      projectPath: params.projectPath,
      filePath: params.filePath,
      analyses: params.analyses,
      trigger: params.trigger,
      createdAt: new Date(),
      status: 'pending',
    };
    
    this.jobs.set(job.id, job);
    
    // Execute immediately if callback is set
    if (this.onExecute) {
      job.status = 'running';
      try {
        await this.onExecute(job);
        job.status = 'completed';
      } catch (error) {
        job.status = 'failed';
        job.error = error instanceof Error ? error.message : 'Unknown error';
      }
    }
    
    return job.id;
  }

  /**
   * Get job status
   */
  getJob(jobId: string): AnalysisJob | undefined {
    return this.jobs.get(jobId);
  }

  /**
   * Get recent jobs
   */
  getRecentJobs(limit = 10): AnalysisJob[] {
    return [...this.jobs.values()]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }

  /**
   * Get current configuration
   */
  getConfig(): SchedulerConfig {
    return this.config;
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<SchedulerConfig>): void {
    if (config.onIngestion) {
      this.config.onIngestion = { ...this.config.onIngestion, ...config.onIngestion };
    }
    if (config.onFileChange) {
      this.config.onFileChange = { ...this.config.onFileChange, ...config.onFileChange };
    }
    if (config.onGitCommit) {
      this.config.onGitCommit = { ...this.config.onGitCommit, ...config.onGitCommit };
    }
    if (config.periodic) {
      this.config.periodic = config.periodic;
    }
  }

  /**
   * Simple cron to milliseconds converter
   * Only supports basic patterns for now
   */
  private cronToMs(cron: string): number {
    const parts = cron.split(' ');
    if (parts.length !== 5) return 0;
    
    // Very simplified - real implementation would use node-cron
    // "0 * * * *" = hourly
    // "0 0 * * *" = daily
    // "0 0 * * 0" = weekly
    
    const [min, hour, dayOfMonth, , dayOfWeek] = parts;
    
    if (dayOfWeek !== '*' && dayOfWeek !== undefined) {
      return 7 * 24 * 60 * 60 * 1000; // Weekly
    }
    if (dayOfMonth !== '*') {
      return 30 * 24 * 60 * 60 * 1000; // Monthly (approx)
    }
    if (hour !== '*') {
      return 24 * 60 * 60 * 1000; // Daily
    }
    if (min !== '*') {
      return 60 * 60 * 1000; // Hourly
    }
    
    return 60 * 1000; // Every minute (fallback)
  }
}

// Singleton instance
let schedulerInstance: AnalyticsScheduler | null = null;

/**
 * Get or create the analytics scheduler singleton
 */
export function getAnalyticsScheduler(config?: Partial<SchedulerConfig>): AnalyticsScheduler {
  if (!schedulerInstance) {
    schedulerInstance = new AnalyticsScheduler(config);
  }
  return schedulerInstance;
}
