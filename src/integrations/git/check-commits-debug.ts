import * as vscode from "vscode"
import { debugLineTracker, getLineTracker } from "./LineTracker"
import { GitCommitChecker } from "./GitCommitChecker"

/**
 * Debug helper to diagnose commit tracking issues
 * This function runs a complete diagnosis of the git commit checker
 */
export async function runGitCommitCheckDiagnosis(context: vscode.ExtensionContext) {
	if (!context) {
		console.error("No extension context provided")
		return
	}

	console.log("===== BEGIN GIT COMMIT CHECK DIAGNOSIS =====")

	// Step 1: Dump current LineTracker state
	console.log("Step 1: Dumping current LineTracker state")
	await debugLineTracker(context)

	// Step 2: Get current line tracker stats
	const lineTracker = await getLineTracker(context)
	console.log("Current statistics summary:")
	console.log(`- Total lines written: ${lineTracker.totalLinesWritten}`)
	console.log(`- Total lines committed: ${lineTracker.totalLinesCommitted}`)
	console.log(`- Commit ratio: ${lineTracker.commitRatio}%`)
	console.log(`- Pending files: ${Object.keys(lineTracker.pendingLines).length}`)

	const pendingLineCount = Object.values(lineTracker.pendingLines).reduce((sum, file) => sum + file.hashes.length, 0)
	console.log(`- Total pending lines: ${pendingLineCount}`)

	// Step 3: Check for git repository
	console.log("\nStep 3: Checking for git repository")
	const workspaceFolders = vscode.workspace.workspaceFolders
	if (!workspaceFolders || workspaceFolders.length === 0) {
		console.error("No workspace folders found")
		return
	}

	// Step 4: Create and run the GitCommitChecker with verbose logging
	console.log("\nStep 4: Running forced git commit check with verbose logging")
	const gitCommitChecker = new GitCommitChecker(context)

	console.log("Starting forced git commit check...")
	try {
		await gitCommitChecker.checkGitCommits(true)
		console.log("Git commit check completed successfully")
	} catch (error) {
		console.error("Git commit check failed with error:", error)
	}

	// Step 5: Get updated line tracker stats
	console.log("\nStep 5: Checking updated LineTracker state")
	const updatedLineTracker = await getLineTracker(context)
	console.log("Updated statistics summary:")
	console.log(`- Total lines written: ${updatedLineTracker.totalLinesWritten}`)
	console.log(`- Total lines committed: ${updatedLineTracker.totalLinesCommitted}`)
	console.log(`- Commit ratio: ${updatedLineTracker.commitRatio}%`)

	const changeInCommittedLines = updatedLineTracker.totalLinesCommitted - lineTracker.totalLinesCommitted
	console.log(`- Change in committed lines: ${changeInCommittedLines}`)

	console.log("===== END GIT COMMIT CHECK DIAGNOSIS =====")
}
