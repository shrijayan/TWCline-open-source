import * as vscode from "vscode"
import { ApiStreamUsageChunk } from "@api/transform/stream"
import {
	TokenUsageStatistics,
	ModelUsageStats,
	ProviderUsageStats,
	CacheMetrics,
	MostUsedModel,
	UsageLogEntry,
	StatisticsStorage,
} from "@shared/Statistics"
import { getGlobalState, updateGlobalState } from "@core/storage/state"

export class StatisticsService {
	private static instance: StatisticsService
	private context: vscode.ExtensionContext

	private constructor(context: vscode.ExtensionContext) {
		this.context = context
	}

	static getInstance(context: vscode.ExtensionContext): StatisticsService {
		if (!StatisticsService.instance) {
			StatisticsService.instance = new StatisticsService(context)
		}
		return StatisticsService.instance
	}

	async recordTokenUsage(usage: ApiStreamUsageChunk, modelId: string, provider: string, taskId: string): Promise<void> {
		const timestamp = Date.now()
		const statistics = await this.getTokenUsageStatistics()

		const totalTokens = usage.inputTokens + usage.outputTokens + (usage.cacheWriteTokens || 0) + (usage.cacheReadTokens || 0)
		const cost = usage.totalCost || 0

		statistics.totalTokensUsed += totalTokens
		statistics.totalInputTokens += usage.inputTokens
		statistics.totalOutputTokens += usage.outputTokens
		statistics.totalCacheWriteTokens += usage.cacheWriteTokens || 0
		statistics.totalCacheReadTokens += usage.cacheReadTokens || 0
		statistics.totalCost += cost
		statistics.totalRequests += 1
		statistics.lastUpdated = timestamp

		this.updateModelStats(statistics, modelId, provider, usage, cost, timestamp)
		this.updateProviderStats(statistics, provider, modelId, usage, cost, timestamp)
		this.updateCacheMetrics(statistics, usage, cost)
		this.updateMostUsedModel(statistics)

		const logEntry: UsageLogEntry = {
			timestamp,
			taskId,
			modelId,
			provider,
			inputTokens: usage.inputTokens,
			outputTokens: usage.outputTokens,
			cacheWriteTokens: usage.cacheWriteTokens || 0,
			cacheReadTokens: usage.cacheReadTokens || 0,
			totalCost: cost,
		}

		await this.saveStatistics(statistics, logEntry)
	}

	private updateModelStats(
		statistics: TokenUsageStatistics,
		modelId: string,
		provider: string,
		usage: ApiStreamUsageChunk,
		cost: number,
		timestamp: number,
	): void {
		const modelKey = `${provider}:${modelId}`
		const totalTokens = usage.inputTokens + usage.outputTokens + (usage.cacheWriteTokens || 0) + (usage.cacheReadTokens || 0)

		if (!statistics.modelUsageBreakdown[modelKey]) {
			statistics.modelUsageBreakdown[modelKey] = {
				modelId,
				provider,
				usageCount: 0,
				totalTokens: 0,
				inputTokens: 0,
				outputTokens: 0,
				cacheWriteTokens: 0,
				cacheReadTokens: 0,
				totalCost: 0,
				averageCostPerRequest: 0,
				lastUsed: timestamp,
				firstUsed: timestamp,
			}
		}

		const modelStats = statistics.modelUsageBreakdown[modelKey]
		modelStats.usageCount += 1
		modelStats.totalTokens += totalTokens
		modelStats.inputTokens += usage.inputTokens
		modelStats.outputTokens += usage.outputTokens
		modelStats.cacheWriteTokens += usage.cacheWriteTokens || 0
		modelStats.cacheReadTokens += usage.cacheReadTokens || 0
		modelStats.totalCost += cost
		modelStats.averageCostPerRequest = modelStats.totalCost / modelStats.usageCount
		modelStats.lastUsed = timestamp
	}

	private updateProviderStats(
		statistics: TokenUsageStatistics,
		provider: string,
		modelId: string,
		usage: ApiStreamUsageChunk,
		cost: number,
		timestamp: number,
	): void {
		const totalTokens = usage.inputTokens + usage.outputTokens + (usage.cacheWriteTokens || 0) + (usage.cacheReadTokens || 0)

		if (!statistics.providerUsageBreakdown[provider]) {
			statistics.providerUsageBreakdown[provider] = {
				provider,
				usageCount: 0,
				totalTokens: 0,
				totalCost: 0,
				modelsUsed: [],
				averageCostPerRequest: 0,
				lastUsed: timestamp,
				firstUsed: timestamp,
			}
		}

		const providerStats = statistics.providerUsageBreakdown[provider]
		providerStats.usageCount += 1
		providerStats.totalTokens += totalTokens
		providerStats.totalCost += cost
		providerStats.averageCostPerRequest = providerStats.totalCost / providerStats.usageCount
		providerStats.lastUsed = timestamp

		if (!providerStats.modelsUsed.includes(modelId)) {
			providerStats.modelsUsed.push(modelId)
		}
	}

	private updateCacheMetrics(statistics: TokenUsageStatistics, usage: ApiStreamUsageChunk, cost: number): void {
		const cacheWriteTokens = usage.cacheWriteTokens || 0
		const cacheReadTokens = usage.cacheReadTokens || 0

		statistics.cacheMetrics.totalCacheWriteTokens += cacheWriteTokens
		statistics.cacheMetrics.totalCacheReadTokens += cacheReadTokens

		if (cacheReadTokens > 0) {
			statistics.cacheMetrics.totalCacheHits += 1
		} else if (cacheWriteTokens > 0) {
			statistics.cacheMetrics.totalCacheMisses += 1
		}

		const totalCacheOperations = statistics.cacheMetrics.totalCacheHits + statistics.cacheMetrics.totalCacheMisses
		if (totalCacheOperations > 0) {
			statistics.cacheMetrics.cacheHitRatio = statistics.cacheMetrics.totalCacheHits / totalCacheOperations
		}

		if (cacheReadTokens > 0) {
			const estimatedCostSaved = (cacheReadTokens / 1000000) * 0.003
			statistics.cacheMetrics.costSavedFromCache += estimatedCostSaved
		}
	}

	private updateMostUsedModel(statistics: TokenUsageStatistics): void {
		let mostUsedModel: MostUsedModel | null = null
		let maxUsageCount = 0

		for (const [modelKey, modelStats] of Object.entries(statistics.modelUsageBreakdown)) {
			if (modelStats.usageCount > maxUsageCount) {
				maxUsageCount = modelStats.usageCount
				mostUsedModel = {
					modelId: modelStats.modelId,
					provider: modelStats.provider,
					usageCount: modelStats.usageCount,
					totalTokens: modelStats.totalTokens,
					totalCost: modelStats.totalCost,
					percentageOfTotalUsage:
						statistics.totalRequests > 0 ? (modelStats.usageCount / statistics.totalRequests) * 100 : 0,
				}
			}
		}

		statistics.mostUsedModel = mostUsedModel
	}

	async getTokenUsageStatistics(): Promise<TokenUsageStatistics> {
		const storage = (await getGlobalState(this.context, "tokenUsageStatistics")) as StatisticsStorage | undefined

		if (!storage || storage.version !== 1) {
			return this.createDefaultStatistics()
		}

		return storage.statistics
	}

	async getModelStatistics(modelId: string, provider?: string): Promise<ModelUsageStats | undefined> {
		const statistics = await this.getTokenUsageStatistics()

		if (provider) {
			const modelKey = `${provider}:${modelId}`
			return statistics.modelUsageBreakdown[modelKey]
		}

		for (const [key, stats] of Object.entries(statistics.modelUsageBreakdown)) {
			if (stats.modelId === modelId) {
				return stats
			}
		}

		return undefined
	}

	async getProviderStatistics(provider: string): Promise<ProviderUsageStats | undefined> {
		const statistics = await this.getTokenUsageStatistics()
		return statistics.providerUsageBreakdown[provider]
	}

	async resetStatistics(): Promise<void> {
		const defaultStats = this.createDefaultStatistics()
		await this.saveStatistics(defaultStats)
	}

	async exportStatistics(): Promise<string> {
		const storage = (await getGlobalState(this.context, "tokenUsageStatistics")) as StatisticsStorage | undefined

		if (!storage) {
			return JSON.stringify({ message: "No statistics available" }, null, 2)
		}

		const exportData = {
			exportDate: new Date().toISOString(),
			version: storage.version,
			statistics: storage.statistics,
			summary: {
				totalTokensUsed: storage.statistics.totalTokensUsed,
				totalCost: storage.statistics.totalCost,
				totalRequests: storage.statistics.totalRequests,
				trackingDuration: storage.statistics.lastUpdated - storage.statistics.trackingStartDate,
				mostUsedModel: storage.statistics.mostUsedModel,
				cacheEfficiency: storage.statistics.cacheMetrics.cacheHitRatio,
			},
		}

		return JSON.stringify(exportData, null, 2)
	}

	private createDefaultStatistics(): TokenUsageStatistics {
		const now = Date.now()
		return {
			totalTokensUsed: 0,
			totalInputTokens: 0,
			totalOutputTokens: 0,
			totalCacheWriteTokens: 0,
			totalCacheReadTokens: 0,
			totalCost: 0,
			totalRequests: 0,
			modelUsageBreakdown: {},
			providerUsageBreakdown: {},
			mostUsedModel: null,
			cacheMetrics: {
				totalCacheHits: 0,
				totalCacheMisses: 0,
				cacheHitRatio: 0,
				costSavedFromCache: 0,
				totalCacheWriteTokens: 0,
				totalCacheReadTokens: 0,
			},
			lastUpdated: now,
			trackingStartDate: now,
			version: 1,
		}
	}

	private async saveStatistics(statistics: TokenUsageStatistics, logEntry?: UsageLogEntry): Promise<void> {
		const storage: StatisticsStorage = {
			version: 1,
			statistics,
			rawUsageLog: logEntry ? [logEntry] : undefined,
		}

		await updateGlobalState(this.context, "tokenUsageStatistics", storage)
	}
}
