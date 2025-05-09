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
