export type HistoryItem = {
	id: string
	ts: number
	task: string
	tokensIn: number
	tokensOut: number
	cacheWrites?: number
	cacheReads?: number
	totalCost: number
	completed?: boolean  // Whether the task was completed
	completedTs?: number  // Timestamp when the task was completed

	size?: number
	shadowGitConfigWorkTree?: string
	conversationHistoryDeletedRange?: [number, number]
	isFavorited?: boolean
}
