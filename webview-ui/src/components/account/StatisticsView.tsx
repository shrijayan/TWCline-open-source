import React, { useEffect, useState, useCallback } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { vscode } from "@/utils/vscode"
import { VSCodeButton, VSCodeProgressRing } from "@vscode/webview-ui-toolkit/react"
import { FileEditStatistics, TokenUsageStatistics } from "@shared/Statistics"
import { useEvent } from "react-use"
import { ExtensionMessage } from "@shared/ExtensionMessage"
import TokenUsageSection from "./TokenUsageSection"

interface StatisticsViewProps {
	onBack: () => void
}

/**
 * Component to display extension usage statistics
 */
export const StatisticsView: React.FC<StatisticsViewProps> = ({ onBack }) => {
	const { fileEditStatistics } = useExtensionState()
	const [tokenStatistics, setTokenStatistics] = useState<TokenUsageStatistics | null>(null)
	const [isLoadingTokenStats, setIsLoadingTokenStats] = useState(false)

	useEffect(() => {
		// Fetch file edit statistics when component mounts
		console.log("StatisticsView mounted, fetching statistics...")
		vscode.postMessage({
			type: "fetchFileEditStatistics",
		})
	}, [])

	// Calculate acceptance rate percentage
	const calculateAcceptanceRate = () => {
		if (!fileEditStatistics || fileEditStatistics.totalSuggestions === 0) {
			return 0
		}
		return Math.round((fileEditStatistics.acceptedSuggestions / fileEditStatistics.totalSuggestions) * 100)
	}

	// Add debug logging to monitor fileEditStatistics state
	useEffect(() => {
		console.log("fileEditStatistics updated:", fileEditStatistics)
	}, [fileEditStatistics])

	if (!fileEditStatistics) {
		return (
			<div className="fixed inset-0 flex flex-col overflow-hidden pt-[10px] pl-[20px]">
				<div className="flex justify-between items-center mb-[17px] pr-[17px]">
					<h3 className="text-[var(--vscode-foreground)] m-0">Statistics</h3>
					<VSCodeButton onClick={onBack}>Back</VSCodeButton>
				</div>
				<div className="flex-grow flex items-center justify-center">
					<div className="text-center">
						<VSCodeProgressRing className="mb-4" />
						<div>Loading statistics data...</div>
					</div>
				</div>
			</div>
		)
	}

	const acceptanceRate = calculateAcceptanceRate()

	return (
		<div className="fixed inset-0 flex flex-col overflow-hidden pt-[10px] pl-[20px]">
			<div className="flex justify-between items-center mb-[17px] pr-[17px]">
				<h3 className="text-[var(--vscode-foreground)] m-0">Statistics</h3>
				<VSCodeButton onClick={onBack}>Back</VSCodeButton>
			</div>
			<div className="flex-grow overflow-y-auto pr-[8px] flex flex-col">
				<TokenUsageSection />
				<div className="border border-[var(--vscode-editorWidget-border)] rounded-md p-4 bg-[var(--vscode-editor-background)] mb-4">
					<div className="mb-4">
						<h3 className="text-md font-medium mb-2">File Edit Suggestions</h3>
						<div className="grid grid-cols-2 gap-4">
							<div className="border-r border-[var(--vscode-editorWidget-border)] pr-4">
								<div className="text-sm text-[var(--vscode-descriptionForeground)]">Total Suggestions</div>
								<div className="text-2xl font-semibold mt-1">{fileEditStatistics.totalSuggestions}</div>
							</div>
							<div>
								<div className="text-sm text-[var(--vscode-descriptionForeground)]">Acceptance Rate</div>
								<div className="text-2xl font-semibold mt-1">
									{acceptanceRate}%
									<span className="text-sm ml-2 text-[var(--vscode-descriptionForeground)]">
										({fileEditStatistics.acceptedSuggestions} accepted)
									</span>
								</div>
							</div>
						</div>
					</div>
				</div>

				<div className="border border-[var(--vscode-editorWidget-border)] rounded-md p-4 bg-[var(--vscode-editor-background)] mb-4">
					<div>
						<h3 className="text-md font-medium mb-2">Prompt Quality</h3>
						<div className="grid grid-cols-1 gap-4">
							<div>
								<div className="text-sm text-[var(--vscode-descriptionForeground)]">Average Quality Score</div>
								<div className="text-2xl font-semibold mt-1">
									{(fileEditStatistics as FileEditStatistics).promptQuality !== undefined
										? `${(fileEditStatistics as FileEditStatistics).promptQuality}%`
										: "Not yet calculated"}
									<span className="text-sm ml-2 text-[var(--vscode-descriptionForeground)]">
										(Based on first prompt in new chats)
									</span>
								</div>
							</div>
						</div>
					</div>
				</div>

				<div className="border border-[var(--vscode-editorWidget-border)] rounded-md p-4 bg-[var(--vscode-editor-background)]">
					<div>
						<h3 className="text-md font-medium mb-2">Code Commit Stats</h3>
						<div className="grid grid-cols-2 gap-4">
							<div className="border-r border-[var(--vscode-editorWidget-border)] pr-4">
								<div className="text-sm text-[var(--vscode-descriptionForeground)]">Lines Written</div>
								<div className="text-2xl font-semibold mt-1">
									{(fileEditStatistics as any).totalLinesWritten || 0}
								</div>
							</div>
							<div>
								<div className="text-sm text-[var(--vscode-descriptionForeground)]">Commit Ratio</div>
								<div className="text-2xl font-semibold mt-1">
									{(fileEditStatistics as any).commitRatio || 0}%
									<div className="text-sm text-[var(--vscode-descriptionForeground)]">
										({(fileEditStatistics as any).totalLinesCommitted || 0} lines committed)
									</div>
								</div>
							</div>
						</div>
						<div className="mt-3 flex justify-between items-center">
							{(fileEditStatistics as any).lastCheckTimestamp && (
								<div className="text-xs text-[var(--vscode-descriptionForeground)]">
									Last checked: {new Date((fileEditStatistics as any).lastCheckTimestamp).toLocaleString()}
								</div>
							)}
							<VSCodeButton
								appearance="secondary"
								onClick={() => {
									vscode.postMessage({
										type: "checkGitCommits",
									})
									vscode.postMessage({
										type: "fetchFileEditStatistics",
									})
								}}>
								Check Now
							</VSCodeButton>
						</div>
					</div>
				</div>
			</div>
		</div>
	)
}

export default StatisticsView
