import * as vscode from "vscode"
import { runGitCommitCheckDiagnosis } from "./check-commits-debug"

/**
 * This script runs the git commit diagnosis to test the fix for commit ratio percentage
 */
export async function testGitCommitFix(context: vscode.ExtensionContext): Promise<void> {
	console.log("=== TESTING GIT COMMIT FIX ===")
	console.log("Running git commit check diagnosis...")

	try {
		await runGitCommitCheckDiagnosis(context)
		console.log("Git commit check diagnosis completed successfully")
	} catch (error) {
		console.error("Error running git commit check diagnosis:", error)
	}

	console.log("=== TEST COMPLETE ===")
}
