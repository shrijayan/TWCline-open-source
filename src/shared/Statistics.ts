/**
 * Statistics interfaces for tracking user interactions with the extension
 */

/**
 * Interface for tracking file edit suggestion acceptance rates
 */
export interface FileEditStatistics {
	/**
	 * Total number of file edit suggestions offered to the user
	 */
	totalSuggestions: number

	/**
	 * Number of file edit suggestions that were accepted by the user
	 */
	acceptedSuggestions: number

	/**
	 * Quality score of the user's prompts (0-100)
	 * Only calculated for the first prompt in a new chat session
	 */
	promptQuality?: number
}
