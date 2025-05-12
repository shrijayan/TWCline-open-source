import * as vscode from "vscode"
import * as path from "path"
import { setTimeout as setTimeoutPromise } from "node:timers/promises"
import simpleGit from "simple-git"
import {
	debugLineTracker,
	forceRefreshStatistics,
	getLineTracker,
	pruneOldEntries,
	saveLineTracker,
	updateCommitRatio,
	updateFileEditStatistics,
} from "./LineTracker"
import { countMatchingLines, countMatchingLinesForgiving, createLineHashes } from "./line-hash"

/**
 * Class responsible for periodically checking git commits to see
 * which lines written by Cline have been committed to git.
 */
export class GitCommitChecker {
	private context: vscode.ExtensionContext
	private checkInterval: NodeJS.Timeout | undefined
	private isChecking: boolean = false

	// Check interval of 30 minutes
	private readonly CHECK_INTERVAL_MS = 30 * 60 * 1000 // 30 minutes

	/**
	 * Create a new GitCommitChecker instance
	 * @param context VSCode extension context
	 */
	constructor(context: vscode.ExtensionContext) {
		this.context = context
	}

	/**
	 * Start periodic checking for git commits
	 * @param runImmediately Whether to also run a check immediately
	 */
	public startPeriodicChecks(runImmediately: boolean = false): void {
		// Clear any existing interval
		if (this.checkInterval) {
			clearInterval(this.checkInterval)
		}

		// Start a new periodic check
		this.checkInterval = setInterval(() => {
			this.checkGitCommits().catch((e) => {
				console.error("Error checking git commits during periodic check:", e)
			})
		}, this.CHECK_INTERVAL_MS)

		// Also run immediately if requested
		if (runImmediately) {
			console.log("GitCommitChecker: Running immediate check")
			this.checkGitCommits().catch((e) => {
				console.error("Error running immediate git commit check:", e)
			})
		}

		// Add the interval to the extension's disposables
		this.context.subscriptions.push({
			dispose: () => {
				if (this.checkInterval) {
					clearInterval(this.checkInterval)
				}
			},
		})

		console.log(`GitCommitChecker: Started periodic checks every ${Math.round(this.CHECK_INTERVAL_MS / (60 * 1000))} minutes`)
	}

	/**
	 * Check git commits for all tracked files in all open workspaces
	 */
	public async checkGitCommits(forceRun: boolean = false): Promise<void> {
		// Don't run multiple checks at the same time
		if (this.isChecking && !forceRun) {
			console.log("GitCommitChecker: Already checking git commits, skipping")
			return
		}

		// If force run, we want to override any existing check
		if (forceRun && this.isChecking) {
			console.log("GitCommitChecker: Force running git commit check, ignoring existing check")
		}

		this.isChecking = true

		try {
			console.time("GitCommitChecker: Full check duration")
			console.log("GitCommitChecker: Starting git commits check...")

			// Get the LineTracker state and dump it for debugging
			const lineTracker = await getLineTracker(this.context)
			await debugLineTracker(this.context)

			// Skip if no pending lines
			if (Object.keys(lineTracker.pendingLines).length === 0) {
				console.log("GitCommitChecker: No pending lines to check")
				this.isChecking = false
				return
			}

			// Log all files with pending lines
			console.log("GitCommitChecker: Files with pending lines:")
			for (const [filePath, fileData] of Object.entries(lineTracker.pendingLines)) {
				console.log(`  - ${filePath} (${fileData.hashes.length} lines)`)
			}

			// For each workspace folder
			for (const folder of vscode.workspace.workspaceFolders || []) {
				try {
					const git = simpleGit(folder.uri.fsPath)

					// Skip if not a git repository
					if (!(await git.checkIsRepo())) {
						console.log(`GitCommitChecker: ${folder.name} is not a git repository, skipping`)
						continue
					}

					// Get current branch
					const branch = await git.branch()
					console.log(`GitCommitChecker: Checking repository in ${folder.name}, current branch: ${branch.current}`)

					// Get all commits, not just since last check (to catch any missed commits)
					// This is more thorough but might be slower
					const sinceDate = new Date(Math.max(lineTracker.lastCheckTimestamp - 7 * 24 * 60 * 60 * 1000, 0))
					// Format date as YYYY-MM-DD which Git understands better than ISO string
					const formattedDate = `${sinceDate.getFullYear()}-${String(sinceDate.getMonth() + 1).padStart(2, "0")}-${String(sinceDate.getDate()).padStart(2, "0")}`
					console.log(`GitCommitChecker: Looking for commits since ${formattedDate}`)

					// Use proper parameter format for simple-git (without -- prefix)
					let commits
					try {
						commits = await git.log({ since: formattedDate })
					} catch (err) {
						console.error(
							`GitCommitChecker: Failed to get commits with 'since: ${formattedDate}', trying alternative format`,
							err,
						)

						// Fall back to array format if object format fails
						try {
							commits = await git.log(["--since", formattedDate])
						} catch (fallbackErr) {
							console.error(`GitCommitChecker: Failed to get commits with alternative format as well`, fallbackErr)
							throw new Error(`Could not retrieve git logs: ${fallbackErr.message || fallbackErr}`)
						}
					}

					if (commits.all.length === 0) {
						console.log(`GitCommitChecker: No commits in ${folder.name} since ${sinceDate}`)
						continue
					}

					console.log(`GitCommitChecker: Found ${commits.all.length} commits in ${folder.name} since ${sinceDate}`)

					// For each file with pending lines
					for (const [filePath, fileData] of Object.entries(lineTracker.pendingLines)) {
						// Skip files with no pending lines
						if (!fileData.hashes?.length) {
							continue
						}

						// Normalize file path for comparison
						const normalizedFilePath = path.normalize(filePath).replace(/\\/g, "/")

						// Skip files that aren't in this workspace
						const workspacePath = folder.uri.fsPath.replace(/\\/g, "/")
						if (!normalizedFilePath.startsWith(workspacePath)) {
							console.log(
								`GitCommitChecker: Skipping file not in workspace: ${normalizedFilePath} (workspace: ${workspacePath})`,
							)
							continue
						}

						// Get relative path for git operations, normalizing slashes for cross-platform consistency
						const relativePath = path.relative(folder.uri.fsPath, filePath).replace(/\\/g, "/")
						console.log(`GitCommitChecker: Checking ${relativePath} (${fileData.hashes.length} pending lines)`)

						// Get filename only for logging
						const fileName = path.basename(filePath)

						// Debug: log first few hashes for diagnostic purposes
						console.log(`GitCommitChecker: First 3 hashes for ${fileName}:`, fileData.hashes.slice(0, 3).join(", "))

						let filesMatchesFound = 0
						let matchingCommits = 0

						// Try various path formats to handle different Git configurations
						const pathVariations = [
							relativePath, // Standard relative path
							relativePath.replace(/\//g, "\\"), // Windows-style paths
							path.basename(relativePath), // Just the filename - for cases where the file moved
							fileName, // Filename only as last resort
						]

						// For each commit
						for (const commit of commits.all) {
							try {
								console.log(
									`GitCommitChecker: Checking commit ${commit.hash.substring(0, 7)} - ${commit.date} - ${commit.message}`,
								)

								let commitContent = ""
								let successPathVariation = ""

								// Try each path variation until one works
								for (const pathVar of pathVariations) {
									try {
										const content = await git.show([`${commit.hash}:${pathVar}`]).catch(() => "")

										if (content) {
											commitContent = content
											successPathVariation = pathVar
											break
										}
									} catch (err) {
										// Just try the next path variation
									}
								}

								if (commitContent) {
									console.log(
										`GitCommitChecker: Found file in commit at path ${successPathVariation}, content length: ${commitContent.length} characters`,
									)
									matchingCommits++

									// Debug: log a few lines from commit content
									const contentPreview = commitContent.split("\n").slice(0, 2).join("\n")
									console.log(`GitCommitChecker: Content preview: ${contentPreview}...`)

									// Log a few file hash examples for debugging
									console.log(
										`GitCommitChecker: File hash examples: [${fileData.hashes
											.slice(0, 3)
											.map((h: string) => h.substring(0, 8) + "...")
											.join(", ")}]`,
									)

									// Create line hashes from commit content for comparison
									const commitLines = commitContent.split("\n")
									const commitLineHashes = createLineHashes(commitLines)
									console.log(`GitCommitChecker: Created ${commitLineHashes.length} hashes from commit content`)

									// Log a few commit hash examples for debugging
									if (commitLineHashes.length > 0) {
										console.log(
											`GitCommitChecker: Commit hash examples: [${commitLineHashes
												.slice(0, 3)
												.map((h: string) => h.substring(0, 8) + "...")
												.join(", ")}]`,
										)
									}

									// Try strict matching first
									console.time(`GitCommitChecker: Standard matching for ${commit.hash.substring(0, 7)}`)
									let matchCount = countMatchingLines(commitContent, fileData.hashes)
									console.timeEnd(`GitCommitChecker: Standard matching for ${commit.hash.substring(0, 7)}`)
									console.log(
										`GitCommitChecker: Standard match count for commit ${commit.hash.substring(0, 7)}: ${matchCount}`,
									)

									// Log any matches found
									if (matchCount > 0) {
										console.log(
											`GitCommitChecker: Found ${matchCount} matches using standard matching algorithm!`,
										)
									}

									// If no matches found, try with the more forgiving algorithm
									if (matchCount === 0) {
										console.time(`GitCommitChecker: Forgiving matching for ${commit.hash.substring(0, 7)}`)
										matchCount = countMatchingLinesForgiving(commitContent, fileData.hashes)
										console.timeEnd(`GitCommitChecker: Forgiving matching for ${commit.hash.substring(0, 7)}`)
										console.log(
											`GitCommitChecker: Forgiving match count for commit ${commit.hash.substring(0, 7)}: ${matchCount}`,
										)

										if (matchCount > 0) {
											console.log(
												`GitCommitChecker: Found ${matchCount} matches using forgiving matching algorithm!`,
											)
										}
									}

									if (matchCount > 0) {
										console.log(
											`GitCommitChecker: Found ${matchCount} matching lines in commit ${commit.hash.substring(0, 7)}`,
										)
										filesMatchesFound += matchCount

										// Store original hash length for logging
										const originalHashCount = fileData.hashes.length

										// Remove matched lines from pending
										if (matchCount >= fileData.hashes.length) {
											fileData.hashes = []
										} else {
											fileData.hashes = fileData.hashes.slice(matchCount)
										}

										console.log(
											`GitCommitChecker: Updated pending hashes from ${originalHashCount} to ${fileData.hashes.length}`,
										)
									}
								} else {
									console.log(
										`GitCommitChecker: File not found in commit ${commit.hash.substring(0, 7)} after trying all path variations`,
									)
								}
							} catch (error) {
								console.error(
									`GitCommitChecker: Error checking commit ${commit.hash} for file ${filePath}:`,
									error,
								)
							}
						}

						// Update the total committed count
						if (filesMatchesFound > 0) {
							console.log(
								`GitCommitChecker: Found total of ${filesMatchesFound} matching lines in ${matchingCommits} commits for file ${fileName}`,
							)
							lineTracker.totalLinesCommitted += filesMatchesFound
							console.log(
								`GitCommitChecker: Total lines committed across all files updated to: ${lineTracker.totalLinesCommitted}`,
							)
						}
					}
				} catch (error) {
					console.error(`GitCommitChecker: Error checking git in ${folder.uri.fsPath}:`, error)
				}
			}

			// Clean up old entries
			pruneOldEntries(lineTracker)

			// Update the commit ratio
			updateCommitRatio(lineTracker)

			// Update the last check timestamp
			lineTracker.lastCheckTimestamp = Date.now()

			// Save the updated LineTracker state
			await saveLineTracker(this.context, lineTracker)
			console.log("GitCommitChecker: Saved updated LineTracker state", {
				totalLinesWritten: lineTracker.totalLinesWritten,
				totalLinesCommitted: lineTracker.totalLinesCommitted,
				commitRatio: lineTracker.commitRatio,
				pendingLinesCount: Object.keys(lineTracker.pendingLines).length,
			})

			// Update the displayed statistics
			await updateFileEditStatistics(this.context, lineTracker)
			console.log("GitCommitChecker: Updated displayed statistics with new values")

			// Show updated statistics after check
			await forceRefreshStatistics(this.context)

			console.log("GitCommitChecker: Check completed successfully")
			console.timeEnd("GitCommitChecker: Full check duration")
		} catch (error) {
			console.error("GitCommitChecker: Error checking git commits:", error)
		} finally {
			this.isChecking = false
		}
	}

	/**
	 * Dispose of resources used by the GitCommitChecker
	 */
	public dispose(): void {
		if (this.checkInterval) {
			clearInterval(this.checkInterval)
			this.checkInterval = undefined
		}
	}

	/**
	 * Final check before the extension is deactivated
	 */
	public async finalCheck(): Promise<void> {
		try {
			console.log("GitCommitChecker: Running final check before deactivation...")
			await this.checkGitCommits()
		} catch (error) {
			console.error("GitCommitChecker: Error during final check:", error)
		}
	}
}
