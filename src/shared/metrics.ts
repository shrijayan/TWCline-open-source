export interface MetricsData {
  lastUpdated: number;
  userId?: string;                   // User identifier
  sessionId?: string;                // Current session identifier
  clientVersion?: string;            // Extension version
  timestamp: number;                 // Timestamp of the update
  taskMetrics: TaskMetrics;
  tokenMetrics: TokenMetrics;
  toolMetrics: ToolMetrics;
  modelMetrics: ModelMetrics;
  systemInfo?: SystemInfo;
}

export interface TaskMetrics {
  totalTasks: number;                // Total number of tasks initiated
  completedTasks: number;            // Number of tasks marked as completed
  abandonedTasks?: number;           // Number of tasks abandoned
  averageCompletionTimeMs: number;   // Average time to complete tasks in milliseconds
  medianCompletionTimeMs?: number;   // Median time to complete tasks in milliseconds
  taskCompletionRate?: number;       // Percentage of tasks completed (completedTasks/totalTasks)
  
  // Daily task metrics
  tasksPerDay: Array<{
    date: string;                    // ISO date string (YYYY-MM-DD)
    count: number;                   // Number of tasks on this day
    completedCount?: number;         // Number of completed tasks on this day
  }>;
  
  // Task duration distribution
  taskDurationDistribution?: {
    lessThan1Min: number;            // Tasks completed in less than 1 minute
    oneToFiveMin: number;            // Tasks completed in 1-5 minutes
    fiveToFifteenMin: number;        // Tasks completed in 5-15 minutes
    fifteenToThirtyMin: number;      // Tasks completed in 15-30 minutes
    thirtyToSixtyMin: number;        // Tasks completed in 30-60 minutes
    moreThanSixtyMin: number;        // Tasks completed in more than 60 minutes
  };
}

export interface TokenMetrics {
  totalTokensIn: number;             // Total input tokens sent to AI models
  totalTokensOut: number;            // Total output tokens received from AI models
  totalCost: number;                 // Estimated cost of token usage
  averageTokensPerTask?: number;     // Average tokens used per task
  
  // Additional fields for comprehensive metrics
  lastUpdated?: number;              // Timestamp of last update
  timestamp?: number;                // Timestamp of the metrics
  taskMetrics?: TaskMetrics;         // Task metrics
  tokenMetrics?: TokenMetrics;       // Self-reference for token metrics
  toolMetrics?: ToolMetrics;         // Tool metrics
  modelMetrics?: ModelMetrics;       // Model metrics
  
  // Cache metrics
  cacheReads?: number;               // Number of cache reads
  cacheWrites?: number;              // Number of cache writes
  cacheHitRate?: number;             // Cache hit rate (cacheReads/(cacheReads+cacheWrites))
  
  // Daily token usage
  usageByDay: Array<{
    date: string;                    // ISO date string (YYYY-MM-DD)
    tokensIn: number;                // Input tokens on this day
    tokensOut: number;               // Output tokens on this day
    cost: number;                    // Cost on this day
    cacheReads?: number;             // Cache reads on this day
    cacheWrites?: number;            // Cache writes on this day
  }>;
  
  // Token usage by model
  usageByModel?: Array<{
    model: string;                   // Model name
    tokensIn: number;                // Input tokens for this model
    tokensOut: number;               // Output tokens for this model
    cost: number;                    // Cost for this model
  }>;
}

export interface ToolMetrics {
  // Tool usage statistics
  tools: Array<{
    name: string;                    // Tool name
    count: number;                   // Number of times tool was used
    successCount?: number;           // Number of successful tool uses
    failureCount?: number;           // Number of failed tool uses
    successRate: number;             // Success rate (successCount/count)
    averageExecutionTimeMs?: number; // Average execution time in milliseconds
  }>;
  
  // Tool usage by task
  toolUsageByTask?: Array<{
    taskId: string;                  // Task identifier
    toolName: string;                // Tool name
    success: boolean;                // Whether the tool use was successful
    executionTimeMs?: number;        // Execution time in milliseconds
    timestamp: number;               // Timestamp of tool use
  }>;
  
  // Most used tools
  mostUsedTools?: Array<string>;     // Names of the most frequently used tools
  
  // Least successful tools
  leastSuccessfulTools?: Array<string>; // Names of tools with lowest success rates
}

export interface ModelMetrics {
  // Model usage statistics
  models: Array<{
    name: string;                    // Model name
    count: number;                   // Number of times model was used
    tokensIn?: number;               // Input tokens for this model
    tokensOut?: number;              // Output tokens for this model
    cost?: number;                   // Cost for this model
    averageResponseTimeMs?: number;  // Average response time in milliseconds
  }>;
  
  // Mode usage statistics
  modeUsage: {
    plan: number;                    // Number of times Plan mode was used
    act: number;                     // Number of times Act mode was used
    planToActSwitches?: number;      // Number of switches from Plan to Act
    actToPlanSwitches?: number;      // Number of switches from Act to Plan
  };
  
  // Model usage by task
  modelUsageByTask?: Array<{
    taskId: string;                  // Task identifier
    model: string;                   // Model name
    mode: "plan" | "act";            // Mode used
    timestamp: number;               // Timestamp of model use
  }>;
}

export interface SystemInfo {
  os?: string;                       // Operating system
  osVersion?: string;                // OS version
  vscodeVersion?: string;            // VSCode version
  cpuArchitecture?: string;          // CPU architecture
  memoryMB?: number;                 // System memory in MB
  locale?: string;                   // User locale
  timezone?: string;                 // User timezone
}

// For storing raw data that will be used to calculate metrics
export interface RawMetricsData {
  tasks: {
    id: string;                      // Task identifier
    startTime: number;               // Task start timestamp
    endTime?: number;                // Task end timestamp (null if not completed)
    completed: boolean;              // Whether the task was completed
    completedTs?: number;            // Timestamp when the task was completed
    model?: string;                  // Model used for the task
    mode?: "plan" | "act";           // Mode used for the task
    durationMs?: number;             // Task duration in milliseconds
    toolUses?: number;               // Number of tool uses in this task
    toolSuccesses?: number;          // Number of successful tool uses in this task
  }[];
  tokenUsage: {
    taskId: string;                  // Task identifier
    tokensIn: number;                // Input tokens for this task
    tokensOut: number;               // Output tokens for this task
    model: string;                   // Model used
    timestamp: number;               // Timestamp of token usage
    cost?: number;                   // Cost for this token usage
    cacheWrites?: number;            // Number of cache writes
    cacheReads?: number;             // Number of cache reads
  }[];
  toolUsage: {
    taskId: string;                  // Task identifier
    tool: string;                    // Tool name
    success: boolean;                // Whether the tool use was successful
    timestamp: number;               // Timestamp of tool use
    executionTimeMs?: number;        // Execution time in milliseconds
  }[];
  modeSwitches: {
    taskId: string;                  // Task identifier
    mode: "plan" | "act";            // Mode switched to
    timestamp: number;               // Timestamp of mode switch
  }[];
}

// For tracking task metadata to optimize incremental updates
export interface TaskMetadataIndex {
  [taskId: string]: {
    lastModified: number;
    messageCount: number;
    hasTokenData: boolean;
    hasCompletionStatus: boolean;
  }
}

// For caching metrics data and metadata
export interface MetricsCache {
  lastCalculationTime: number;
  taskMetadataIndex: TaskMetadataIndex;
  rawData: RawMetricsData;
  processedMetrics: MetricsData;
}
