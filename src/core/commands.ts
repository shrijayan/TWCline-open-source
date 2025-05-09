import * as vscode from "vscode"
import { Controller } from "./controller"

/**
 * Register all commands that the extension provides
 * @param context The extension context
 * @param controller The extension controller
 */
export function registerCommands(context: vscode.ExtensionContext, controller: Controller): void {
	// Register file edit statistics command
	context.subscriptions.push(
		vscode.commands.registerCommand("cline.fileEditPresented", async () => {
			await controller.recordFileEditPresented()
		}),
	)

	context.subscriptions.push(
		vscode.commands.registerCommand("cline.fileEditAccepted", async () => {
			await controller.incrementAcceptedFileEdits()
		}),
	)

	context.subscriptions.push(
		vscode.commands.registerCommand("cline.fileEditRejected", async () => {
			await controller.recordFileEditRejected()
		}),
	)
}
