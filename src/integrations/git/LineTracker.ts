import * as vscode from "vscode"
import { FileEditStatistics } from "@shared/Statistics"
import { getGlobalState, updateGlobalState } from "@core/storage/state"
import { GlobalStateKey } from "@core/storage/state-keys"
import { createLineHashes } from "./line-hash"

/**
 * Data structure for tracking lines of code written by Cline and
 * whether they've been committed to git repositories
 */
export interface LineTracker {
	/** Running count of all lines Cline has written */
	totalLinesWritten: number

	/** Running count of lines that appear in git commits */
	totalLinesCommitted: number

	/** Calculated percentage of lines committed */
	commitRatio: number

	/** Lines waiting to be checked against git commits */
	pendingLines: {
		[filePath: string]: {
			/** Hashed content of lines for comparison */
			hashes: string[]
			/** When these lines were added */
			timestamp: number
		}
	}

	/** When we last checked git commits */
	lastCheckTimestamp: number
}

const LINE_TRACKER_STATE_KEY = "lineTracker" as GlobalStateKey

/**
 * Get the current LineTracker state from global storage
 * @param context VSCode extension context
 * @returns The current LineTracker state or a new default state if none exists
 */
export async function getLineTracker(context: vscode.ExtensionContext): Promise<LineTracker> {
	const lineTracker = (await getGlobalState(context, LINE_TRACKER_STATE_KEY)) as LineTracker

	if (!lineTracker) {
		return {
			totalLinesWritten: 0,
			totalLinesCommitted: 0,
			commitRatio: 0,
			pendingLines: {},
			lastCheckTimestamp: Date.now(),
		}
	}

	return lineTracker
}

/**
 * Save the LineTracker state to global storage
 * @param context VSCode extension context
 * @param lineTracker The LineTracker state to save
 */
export async function saveLineTracker(context: vscode.ExtensionContext, lineTracker: LineTracker): Promise<void> {
	await updateGlobalState(context, LINE_TRACKER_STATE_KEY, lineTracker)
}

/**
 * Record lines that Cline has written to a file
 * @param context VSCode extension context
 * @param filePath Path to the file that was edited
 * @param lines Array of lines that were added
 */
export async function recordLinesWritten(context: vscode.ExtensionContext, filePath: string, lines: string[]): Promise<void> {
	if (lines.length === 0) {
		return
	}

	// Get current LineTracker state
	const lineTracker = await getLineTracker(context)

	// Hash the lines for future comparison
	const lineHashes = createLineHashes(lines)

	// Update the LineTracker state
	lineTracker.totalLinesWritten += lines.length

	// Store the hashed lines with the file path
	lineTracker.pendingLines[filePath] = {
		hashes: lineTracker.pendingLines[filePath] ? [...lineTracker.pendingLines[filePath].hashes, ...lineHashes] : lineHashes,
		timestamp: Date.now(),
	}

	// Calculate the new commit ratio
	updateCommitRatio(lineTracker)

	// Save the updated LineTracker state
	await saveLineTracker(context, lineTracker)

	// Update displayed statistics
	await updateFileEditStatistics(context, lineTracker)
}

/**
 * Update the commit ratio based on current values
 * @param lineTracker The LineTracker to update
 */
export function updateCommitRatio(lineTracker: LineTracker): void {
	lineTracker.commitRatio =
		lineTracker.totalLinesWritten > 0
			? Math.round((lineTracker.totalLinesCommitted / lineTracker.totalLinesWritten) * 100)
			: 0

	console.log(
		`LineTracker: Updated commit ratio - ${lineTracker.totalLinesCommitted}/${lineTracker.totalLinesWritten} = ${lineTracker.commitRatio}%`,
	)
}

/**
 * Update the FileEditStatistics with the current LineTracker values
 * @param context VSCode extension context
 * @param lineTracker The LineTracker containing the statistics
 */
export async function updateFileEditStatistics(context: vscode.ExtensionContext, lineTracker: LineTracker): Promise<void> {
	// Get current statistics
	const stats = ((await getGlobalState(context, "fileEditStatistics")) as FileEditStatistics) || {
		totalSuggestions: 0,
		acceptedSuggestions: 0,
	}

	// Update statistics with line tracking information
	const updatedStats: FileEditStatistics = {
		...stats,
		totalLinesWritten: lineTracker.totalLinesWritten,
		totalLinesCommitted: lineTracker.totalLinesCommitted,
		commitRatio: lineTracker.commitRatio,
		lastCheckTimestamp: lineTracker.lastCheckTimestamp,
	}

	// Save updated statistics
	await updateGlobalState(context, "fileEditStatistics", updatedStats)

	console.log(
		`LineTracker: Updated FileEditStatistics - totalLinesWritten: ${updatedStats.totalLinesWritten}, totalLinesCommitted: ${updatedStats.totalLinesCommitted}, commitRatio: ${updatedStats.commitRatio}%`,
	)
}

/**
 * Prune old entries from the LineTracker
 * @param lineTracker The LineTracker to prune
 */
export function pruneOldEntries(lineTracker: LineTracker): void {
	const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000 // 2 weeks in milliseconds
	const now = Date.now()

	// Remove files with no pending lines and files older than two weeks
	for (const [filePath, fileData] of Object.entries(lineTracker.pendingLines)) {
		if (fileData.hashes.length === 0 || now - fileData.timestamp > TWO_WEEKS_MS) {
			delete lineTracker.pendingLines[filePath]
		}
	}
}

/**
 * Debug function to dump the current state of the LineTracker
 * @param context VSCode extension context
 */
export async function debugLineTracker(context: vscode.ExtensionContext): Promise<void> {
	const lineTracker = await getLineTracker(context)

	console.log("================== LineTracker Debug ==================")
	console.log(`Total Lines Written: ${lineTracker.totalLinesWritten}`)
	console.log(`Total Lines Committed: ${lineTracker.totalLinesCommitted}`)
	console.log(`Commit Ratio: ${lineTracker.commitRatio}%`)
	console.log(`Last Check Timestamp: ${new Date(lineTracker.lastCheckTimestamp).toLocaleString()}`)
	console.log(`Pending Files: ${Object.keys(lineTracker.pendingLines).length}`)

	for (const [filePath, fileData] of Object.entries(lineTracker.pendingLines)) {
		console.log(`\nFile: ${filePath}`)
		console.log(`  Timestamp: ${new Date(fileData.timestamp).toLocaleString()}`)
		console.log(`  Pending Lines: ${fileData.hashes.length}`)
		if (fileData.hashes.length > 0) {
			console.log(`  Sample Hashes: ${fileData.hashes.slice(0, 3).join(", ")}`)
		}
	}
	console.log("=======================================================")
}

/**
 * Force refresh all statistics from scratch for debugging
 * @param context VSCode extension context
 */
export async function forceRefreshStatistics(context: vscode.ExtensionContext): Promise<void> {
	// Get current LineTracker state
	const lineTracker = await getLineTracker(context)

	// Update the displayed statistics with forced update flag
	await updateFileEditStatistics(context, lineTracker)

	// Debug dump the current state
	await debugLineTracker(context)
}
