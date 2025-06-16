import React, { useState, useCallback, useEffect } from "react"
import { VSCodeButton, VSCodeProgressRing } from "@vscode/webview-ui-toolkit/react"
import { TokenUsageStatistics } from "@shared/Statistics"
import { vscode } from "@/utils/vscode"
import { useEvent } from "react-use"
import { ExtensionMessage } from "@shared/ExtensionMessage"

export const TokenUsageSection: React.FC = () => {
	const [statistics, setStatistics] = useState<TokenUsageStatistics | null>(null)
	const [isLoading, setIsLoading] = useState(false)

	const fetchStatistics = useCallback(() => {
		setIsLoading(true)
		vscode.postMessage({ type: "fetchTokenUsageStatistics" })
	}, [])

	const handleMessage = useCallback((event: MessageEvent) => {
		const message: ExtensionMessage = event.data
		switch (message.type) {
			case "tokenUsageStatistics":
				setStatistics(message.tokenUsageStatistics)
				setIsLoading(false)
				break
		}
	}, [])

	useEvent("message", handleMessage)

	useEffect(() => {
		fetchStatistics()
	}, [fetchStatistics])

	const formatNumber = (num: number): string => {
		return new Intl.NumberFormat().format(num)
	}

	const formatCurrency = (amount: number): string => {
		return new Intl.NumberFormat('en-US', {
			style: 'currency',
			currency: 'USD',
			minimumFractionDigits: 4,
			maximumFractionDigits: 4
		}).format(amount)
	}

	if (isLoading) {
		return (
			<div className="border border-[var(--vscode-editorWidget-border)] rounded-md p-4 bg-[var(--vscode-editor-background)] mb-4">
				<div className="flex items-center justify-center py-8">
					<VSCodeProgressRing className="mr-2" />
					<span>Loading token usage statistics...</span>
				</div>
			</div>
		)
	}

	if (!statistics) {
		return (
			<div className="border border-[var(--vscode-editorWidget-border)] rounded-md p-4 bg-[var(--vscode-editor-background)] mb-4">
				<div>
					<h3 className="text-md font-medium mb-2">Token Usage & Cost</h3>
					<div className="text-center py-8 text-[var(--vscode-descriptionForeground)]">
						No token usage data available yet.
						<br />
						Start using Cline to see your statistics here.
					</div>
				</div>
			</div>
		)
	}

	const mostUsedModel = statistics.mostUsedModel

	return (
		<div className="border border-[var(--vscode-editorWidget-border)] rounded-md p-4 bg-[var(--vscode-editor-background)] mb-4">
			<div>
				<h3 className="text-md font-medium mb-4">Token Usage & Cost</h3>
				
				{/* Overview Stats */}
				<div className="grid grid-cols-2 gap-4 mb-4">
					<div className="border-r border-[var(--vscode-editorWidget-border)] pr-4">
						<div className="text-sm text-[var(--vscode-descriptionForeground)]">Total Tokens</div>
						<div className="text-2xl font-semibold mt-1">{formatNumber(statistics.totalTokensUsed)}</div>
						<div className="text-xs text-[var(--vscode-descriptionForeground)] mt-1">
							{formatNumber(statistics.totalInputTokens)} in • {formatNumber(statistics.totalOutputTokens)} out
						</div>
					</div>
					<div>
						<div className="text-sm text-[var(--vscode-descriptionForeground)]">Total Cost</div>
						<div className="text-2xl font-semibold mt-1">{formatCurrency(statistics.totalCost)}</div>
						{(statistics.totalCacheReadTokens + statistics.totalCacheWriteTokens) > 0 && (
							<div className="text-xs text-[var(--vscode-descriptionForeground)] mt-1">
								{formatNumber(statistics.totalCacheReadTokens + statistics.totalCacheWriteTokens)} cached tokens
							</div>
						)}
					</div>
				</div>

				{/* Most Used Model */}
				{mostUsedModel && (
					<div className="mb-4 p-3 bg-[var(--vscode-textBlockQuote-background)] rounded border-l-2 border-[var(--vscode-textBlockQuote-border)]">
						<div className="text-sm text-[var(--vscode-descriptionForeground)]">Most Used Model</div>
						<div className="font-medium">{mostUsedModel.modelId}</div>
						<div className="text-xs text-[var(--vscode-descriptionForeground)]">
							{mostUsedModel.usageCount} requests ({mostUsedModel.percentageOfTotalUsage.toFixed(1)}% of total)
						</div>
					</div>
				)}

				{/* Cache Efficiency */}
				{(statistics.cacheMetrics.totalCacheHits + statistics.cacheMetrics.totalCacheMisses) > 0 && (
					<div className="mb-4">
						<div className="text-sm text-[var(--vscode-descriptionForeground)] mb-2">Cache Efficiency</div>
						<div className="grid grid-cols-2 gap-4">
							<div>
								<div className="text-lg font-medium">{statistics.cacheMetrics.cacheHitRatio.toFixed(1)}%</div>
								<div className="text-xs text-[var(--vscode-descriptionForeground)]">Hit Ratio</div>
							</div>
							<div>
								<div className="text-lg font-medium">{formatCurrency(statistics.cacheMetrics.costSavedFromCache)}</div>
								<div className="text-xs text-[var(--vscode-descriptionForeground)]">Cost Savings</div>
							</div>
						</div>
					</div>
				)}

				{/* Provider Breakdown */}
				{Object.keys(statistics.providerUsageBreakdown).length > 0 && (
					<div className="mb-4">
						<div className="text-sm text-[var(--vscode-descriptionForeground)] mb-2">Top Providers</div>
						<div className="space-y-2">
							{Object.entries(statistics.providerUsageBreakdown)
								.sort(([,a], [,b]) => (b as any).totalCost - (a as any).totalCost)
								.slice(0, 3)
								.map(([provider, stats]) => (
									<div key={provider} className="flex justify-between items-center text-sm">
										<span className="font-medium">{provider}</span>
										<span className="text-[var(--vscode-descriptionForeground)]">
											{formatCurrency((stats as any).totalCost)} • {formatNumber((stats as any).totalTokens)} tokens
										</span>
									</div>
								))}
						</div>
					</div>
				)}

				{/* Action Buttons */}
				<div className="flex gap-2 mt-4">
					<VSCodeButton 
						appearance="secondary" 
						onClick={fetchStatistics}
						disabled={isLoading}
					>
						Refresh
					</VSCodeButton>
				</div>
			</div>
		</div>
	)
}

export default TokenUsageSection
