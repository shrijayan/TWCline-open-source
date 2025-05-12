/**
 * Interface for tracking statistics about file edit suggestions presented to the user
 * and the user's interaction with those suggestions.
 */
export interface FileEditStatistics {
	/** Total number of file edit suggestions presented to the user */
	totalSuggestions: number

	/** Number of file edit suggestions accepted by the user */
	acceptedSuggestions: number

	/** Prompt quality score (average across sessions) */
	promptQuality?: number

	/** Total lines written by Cline across all tasks */
	totalLinesWritten?: number

	/** Total lines committed to git */
	totalLinesCommitted?: number

	/** Percentage of lines written that were committed */
	commitRatio?: number

	/** When the git commit statistics were last checked */
	lastCheckTimestamp?: number
}
