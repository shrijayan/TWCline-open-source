export interface FileEditStatistics {
	totalSuggestions: number
	acceptedSuggestions: number
	promptQuality?: number
	totalLinesWritten?: number
	totalLinesCommitted?: number
	commitRatio?: number
	lastCheckTimestamp?: number
}

export interface ModelUsageStats {
	modelId: string
	provider: string
	usageCount: number
	totalTokens: number
	inputTokens: number
	outputTokens: number
	cacheWriteTokens: number
	cacheReadTokens: number
	totalCost: number
	averageCostPerRequest: number
	lastUsed: number
	firstUsed: number
}

export interface ProviderUsageStats {
	provider: string
	usageCount: number
	totalTokens: number
	totalCost: number
	modelsUsed: string[]
	averageCostPerRequest: number
	lastUsed: number
	firstUsed: number
}

export interface CacheMetrics {
	totalCacheHits: number
	totalCacheMisses: number
	cacheHitRatio: number
	costSavedFromCache: number
	totalCacheWriteTokens: number
	totalCacheReadTokens: number
}

export interface MostUsedModel {
	modelId: string
	provider: string
	usageCount: number
	totalTokens: number
	totalCost: number
	percentageOfTotalUsage: number
}

export interface TokenUsageStatistics {
	totalTokensUsed: number
	totalInputTokens: number
	totalOutputTokens: number
	totalCacheWriteTokens: number
	totalCacheReadTokens: number
	totalCost: number
	totalRequests: number
	modelUsageBreakdown: Record<string, ModelUsageStats>
	providerUsageBreakdown: Record<string, ProviderUsageStats>
	mostUsedModel: MostUsedModel | null
	cacheMetrics: CacheMetrics
	lastUpdated: number
	trackingStartDate: number
	version: number
}

export interface UsageLogEntry {
	timestamp: number
	taskId: string
	modelId: string
	provider: string
	inputTokens: number
	outputTokens: number
	cacheWriteTokens: number
	cacheReadTokens: number
	totalCost: number
}

export interface StatisticsStorage {
	version: number
	statistics: TokenUsageStatistics
	rawUsageLog?: UsageLogEntry[]
}
