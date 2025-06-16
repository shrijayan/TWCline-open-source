import { VSCodeButton, VSCodeProgressRing } from "@vscode/webview-ui-toolkit/react"
import { memo, useCallback, useEffect, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { vscode } from "@/utils/vscode"
import { useEvent } from "react-use"
import { ExtensionMessage } from "@shared/ExtensionMessage"
import { TokenUsageStatistics } from "@shared/Statistics"

const TokenUsageStatisticsSection = () => {
	const [statistics, setStatistics] = useState<TokenUsageStatistics | null>(null)
	const [isLoading, setIsLoading] = useState(false)
	const [isExporting, setIsExporting] = useState(false)
	const [isResetting, setIsResetting] = useState(false)

	const fetchStatistics = useCallback(() => {
		setIsLoading(true)
		vscode.postMessage({ type: "fetchTokenUsageStatistics" })
	}, [])

	const exportStatistics = useCallback(() => {
		setIsExporting(true)
		vscode.postMessage({ type: "exportTokenUsageStatistics" })
	}, [])

	const resetStatistics = useCallback(() => {
		if (confirm("Are you sure you want to reset all token usage statistics? This action cannot be undone.")) {
			setIsResetting(true)
			vscode.postMessage({ type: "resetTokenUsageStatistics" })
		}
	}, [])

	const handleMessage = useCallback((event: MessageEvent) => {
		const message: ExtensionMessage = event.data
		switch (message.type) {
			case "tokenUsageStatistics":
				setStatistics(message.tokenUsageStatistics)
				setIsLoading(false)
				break
			case "exportedTokenUsageStatistics":
				setIsExporting(false)
				if (message.exportData) {
					const blob = new Blob([message.exportData], { type: "application/json" })
					const url = URL.createObjectURL(blob)
					const a = document.createElement("a")
					a.href = url
					a.download = `cline-token-usage-statistics-${new Date().toISOString().split("T")[0]}.json`
					document.body.appendChild(a)
					a.click()
					document.body.removeChild(a)
					URL.revokeObjectURL(url)
				}
				break
			case "tokenUsageStatisticsReset":
				setIsResetting(false)
				if (message.success) {
					setStatistics(null)
					fetchStatistics()
				}
				break
		}
	}, [fetchStatistics])

	useEvent("message", handleMessage)

	useEffect(() => {
		fetchStatistics()
	}, [fetchStatistics])

	const formatNumber = (num: number) => {
		return new Intl.NumberFormat().format(num)
	}

	const formatCurrency = (amount: number) => {
		return new Intl.NumberFormat("en-US", {
			style: "currency",
			currency: "USD",
			minimumFractionDigits: 4,
		}).format(amount)
	}

	const formatDate = (timestamp: number) => {
		return new Date(timestamp).toLocaleDateString()
	}

	if (isLoading && !statistics) {
		return (
			<div className="mb-[20px]">
				<div className="mb-[10px] font-medium">Token Usage Statistics</div>
				<div className="flex items-center gap-2">
					<VSCodeProgressRing />
					<span className="text-sm text-[var(--vscode-descriptionForeground)]">Loading statistics...</span>
				</div>
			</div>
		)
	}

	return (
		<div className="mb-[20px]">
			<div className="mb-[10px] font-medium">Token Usage Statistics</div>
			
			{statistics ? (
				<div className="border border-solid border-[var(--vscode-panel-border)] rounded-md p-[15px] bg-[var(--vscode-panel-background)]">
					{/* Overview Section */}
					<div className="mb-[15px]">
						<h4 className="text-sm font-medium mb-[8px] text-[var(--vscode-foreground)]">Overview</h4>
						<div className="grid grid-cols-2 gap-[10px] text-sm">
							<div>
								<span className="text-[var(--vscode-descriptionForeground)]">Total Tokens:</span>
								<span className="ml-2 font-medium">{formatNumber(statistics.totalTokensUsed)}</span>
							</div>
							<div>
								<span className="text-[var(--vscode-descriptionForeground)]">Total Cost:</span>
								<span className="ml-2 font-medium">{formatCurrency(statistics.totalCost)}</span>
							</div>
							<div>
								<span className="text-[var(--vscode-descriptionForeground)]">Input Tokens:</span>
								<span className="ml-2 font-medium">{formatNumber(statistics.totalInputTokens)}</span>
							</div>
							<div>
								<span className="text-[var(--vscode-descriptionForeground)]">Output Tokens:</span>
								<span className="ml-2 font-medium">{formatNumber(statistics.totalOutputTokens)}</span>
							</div>
							<div>
								<span className="text-[var(--vscode-descriptionForeground)]">Cache Write:</span>
								<span className="ml-2 font-medium">{formatNumber(statistics.totalCacheWriteTokens)}</span>
							</div>
							<div>
								<span className="text-[var(--vscode-descriptionForeground)]">Cache Read:</span>
								<span className="ml-2 font-medium">{formatNumber(statistics.totalCacheReadTokens)}</span>
							</div>
						</div>
					</div>

					{/* Most Used Model */}
					{statistics.mostUsedModel && (
						<div className="mb-[15px]">
							<h4 className="text-sm font-medium mb-[8px] text-[var(--vscode-foreground)]">Most Used Model</h4>
							<div className="text-sm">
								<div className="mb-1">
									<span className="font-medium">{statistics.mostUsedModel.modelId}</span>
									<span className="ml-2 text-[var(--vscode-descriptionForeground)]">({statistics.mostUsedModel.provider})</span>
								</div>
								<div className="text-[var(--vscode-descriptionForeground)]">
									{statistics.mostUsedModel.usageCount} requests ({statistics.mostUsedModel.percentageOfTotalUsage.toFixed(1)}%)
								</div>
								<div className="text-[var(--vscode-descriptionForeground)]">
									{formatNumber(statistics.mostUsedModel.totalTokens)} tokens, {formatCurrency(statistics.mostUsedModel.totalCost)}
								</div>
							</div>
						</div>
					)}

					{/* Cache Efficiency */}
					<div className="mb-[15px]">
						<h4 className="text-sm font-medium mb-[8px] text-[var(--vscode-foreground)]">Cache Efficiency</h4>
						<div className="text-sm">
							<div className="mb-1">
								<span className="text-[var(--vscode-descriptionForeground)]">Hit Ratio:</span>
								<span className="ml-2 font-medium">{(statistics.cacheMetrics.cacheHitRatio * 100).toFixed(1)}%</span>
							</div>
							<div className="mb-1">
								<span className="text-[var(--vscode-descriptionForeground)]">Cost Saved:</span>
								<span className="ml-2 font-medium">{formatCurrency(statistics.cacheMetrics.costSavedFromCache)}</span>
							</div>
							<div>
								<span className="text-[var(--vscode-descriptionForeground)]">Cache Operations:</span>
								<span className="ml-2">{statistics.cacheMetrics.totalCacheHits} hits, {statistics.cacheMetrics.totalCacheMisses} misses</span>
							</div>
						</div>
					</div>

					{/* Model Breakdown */}
					{Object.keys(statistics.modelUsageBreakdown).length > 0 && (
						<div className="mb-[15px]">
							<h4 className="text-sm font-medium mb-[8px] text-[var(--vscode-foreground)]">Model Breakdown</h4>
							<div className="max-h-[200px] overflow-y-auto">
								{Object.entries(statistics.modelUsageBreakdown)
									.sort(([, a], [, b]) => b.usageCount - a.usageCount)
									.slice(0, 10)
									.map(([key, model]) => (
										<div key={key} className="mb-2 p-2 bg-[var(--vscode-input-background)] rounded text-xs">
											<div className="font-medium">{model.modelId} ({model.provider})</div>
											<div className="text-[var(--vscode-descriptionForeground)] mt-1">
												{model.usageCount} requests • {formatNumber(model.totalTokens)} tokens • {formatCurrency(model.totalCost)}
											</div>
											<div className="text-[var(--vscode-descriptionForeground)]">
												Avg: {formatCurrency(model.averageCostPerRequest)} per request
											</div>
										</div>
									))}
							</div>
						</div>
					)}

					{/* Metadata */}
					<div className="text-xs text-[var(--vscode-descriptionForeground)] mb-[15px]">
						<div>Tracking since: {formatDate(statistics.trackingStartDate)}</div>
						<div>Last updated: {formatDate(statistics.lastUpdated)}</div>
						<div>Total requests: {formatNumber(statistics.totalRequests)}</div>
					</div>

					{/* Action Buttons */}
					<div className="flex gap-2 flex-wrap">
						<VSCodeButton onClick={fetchStatistics} disabled={isLoading}>
							{isLoading ? "Refreshing..." : "Refresh"}
						</VSCodeButton>
						<VSCodeButton onClick={exportStatistics} disabled={isExporting}>
							{isExporting ? "Exporting..." : "Export JSON"}
						</VSCodeButton>
						<VSCodeButton 
							onClick={resetStatistics} 
							disabled={isResetting}
							style={{ backgroundColor: "var(--vscode-errorForeground)", color: "white" }}>
							{isResetting ? "Resetting..." : "Reset All"}
						</VSCodeButton>
					</div>
				</div>
			) : (
				<div className="border border-solid border-[var(--vscode-panel-border)] rounded-md p-[15px] bg-[var(--vscode-panel-background)]">
					<div className="text-sm text-[var(--vscode-descriptionForeground)] mb-[10px]">
						No token usage statistics available yet. Statistics will be collected as you use Cline.
					</div>
					<VSCodeButton onClick={fetchStatistics} disabled={isLoading}>
						{isLoading ? "Loading..." : "Check Again"}
					</VSCodeButton>
				</div>
			)}

			<p className="text-xs mt-[8px] text-[var(--vscode-descriptionForeground)]">
				Track your token usage and costs across different models and providers. Statistics are stored locally and never shared.
			</p>
		</div>
	)
}

export default memo(TokenUsageStatisticsSection)
