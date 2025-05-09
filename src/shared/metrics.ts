export interface MetricsData {
  lastUpdated: number;
  taskMetrics: TaskMetrics;
  tokenMetrics: TokenMetrics;
  toolMetrics: ToolMetrics;
  modelMetrics: ModelMetrics;
}

export interface TaskMetrics {
  totalTasks: number;
  completedTasks: number;
  averageCompletionTime: number; // in milliseconds
  tasksPerDay: { date: string; count: number }[];
}

export interface TokenMetrics {
  totalTokensIn: number;
  totalTokensOut: number;
  totalCost: number;
  usageByDay: { date: string; tokensIn: number; tokensOut: number; cost: number }[];
}

export interface ToolMetrics {
  tools: { name: string; count: number; successRate: number }[];
}

export interface ModelMetrics {
  models: { name: string; count: number }[];
  modeUsage: { plan: number; act: number };
}

// For storing raw data that will be used to calculate metrics
export interface RawMetricsData {
  tasks: {
    id: string;
    startTime: number;
    endTime?: number;
    completed: boolean;
    completedTs?: number;  // Timestamp when the task was completed
    model?: string;
    mode?: "plan" | "act";
  }[];
  tokenUsage: {
    taskId: string;
    tokensIn: number;
    tokensOut: number;
    model: string;
    timestamp: number;
    cost?: number;
    cacheWrites?: number;
    cacheReads?: number;
  }[];
  toolUsage: {
    taskId: string;
    tool: string;
    success: boolean;
    timestamp: number;
  }[];
  modeSwitches: {
    taskId: string;
    mode: "plan" | "act";
    timestamp: number;
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
