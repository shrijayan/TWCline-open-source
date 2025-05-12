// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import { setTimeout as setTimeoutPromise } from "node:timers/promises"
import * as vscode from "vscode"
import pWaitFor from "p-wait-for"
import { Logger } from "./services/logging/Logger"
import { createClineAPI } from "./exports"
import { registerCommands } from "./core/commands"
import "./utils/path" // necessary to have access to String.prototype.toPosix
import { DIFF_VIEW_URI_SCHEME } from "./integrations/editor/DiffViewProvider"
import assert from "node:assert"
import { posthogClientProvider } from "./services/posthog/PostHogClientProvider"
import { WebviewProvider } from "./core/webview"
import { Controller } from "./core/controller"
import { ErrorService } from "./services/error/ErrorService"
import { initializeTestMode, cleanupTestMode } from "./services/test/TestMode"
import { telemetryService } from "./services/posthog/telemetry/TelemetryService"
import { runGitCommitCheckDiagnosis } from "./integrations/git/check-commits-debug"
import { testGitCommitFix } from "./integrations/git/test-fix"
import { TokenBackfillService } from "./services/metrics/TokenBackfillService"
import * as crypto from "crypto"
import axios from "axios"

// PKCE helper functions for secure OAuth
const base64URLEncode = (buffer: Uint8Array): string => {
	return Buffer.from(buffer)
		.toString('base64')
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=/g, '');
};

const generateCodeVerifier = (): string => {
	const array = new Uint8Array(32);
	crypto.randomFillSync(array);
	return base64URLEncode(array);
};

const generateCodeChallenge = async (verifier: string): Promise<string> => {
	const hash = crypto.createHash('sha256').update(verifier).digest();
	// Convert Buffer to Uint8Array
	const uint8Array = new Uint8Array(hash.buffer.slice(hash.byteOffset, hash.byteOffset + hash.byteLength));
	return base64URLEncode(uint8Array);
};

/*
Built using https://github.com/microsoft/vscode-webview-ui-toolkit

Inspired by
https://github.com/microsoft/vscode-webview-ui-toolkit-samples/tree/main/default/weather-webview
https://github.com/microsoft/vscode-webview-ui-toolkit-samples/tree/main/frameworks/hello-world-react-cra

*/

let outputChannel: vscode.OutputChannel

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	outputChannel = vscode.window.createOutputChannel("Cline")
	context.subscriptions.push(outputChannel)

	ErrorService.initialize()
	Logger.initialize(outputChannel)
	Logger.log("Cline extension activated")
	
	// Initialize token backfill service
	const tokenBackfillService = new TokenBackfillService(context)
	
	// Run token backfill on extension activation with a delay to not impact startup performance
	setTimeout(async () => {
		try {
			const updatedCount = await tokenBackfillService.backfillAllTasks()
			Logger.log(`Token backfill complete. Updated ${updatedCount} tasks.`)
		} catch (error) {
			Logger.error("Error during token backfill:", error)
		}
	}, 10000) // 10 second delay

	// Register the Google authentication provider for statistics
	const sessionChangeEmitter = new vscode.EventEmitter<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>();
	const googleAuthProvider = vscode.authentication.registerAuthenticationProvider(
		'tw-cline-stats-google',
		'Cline Statistics',
		{
			onDidChangeSessions: sessionChangeEmitter.event,
			getSessions: async () => {
				// Get sessions from storage
				const sessionData = context.globalState.get<any>('tw-cline-stats-google-sessions');
				if (sessionData) {
					return [sessionData];
				}
				return [];
			},
			createSession: async (scopes) => {
				try {
					// Create a nonce for state validation
					const nonce = crypto.randomBytes(16).toString('hex');
					await context.secrets.store('tw-cline-stats-google-nonce', nonce);
					
					// Generate PKCE code verifier and challenge
					const codeVerifier = generateCodeVerifier();
					const codeChallenge = await generateCodeChallenge(codeVerifier);
					
					// Store the code verifier in secure storage for later use
					await context.secrets.store('tw-cline-stats-google-verifier', codeVerifier);
					
					// Google OAuth configuration
					const clientId = '457066567820-e0c86m2ao3j3lactebdlob9nel86t9vp.apps.googleusercontent.com';
					// Use a redirect URI that is registered in the Google Cloud Console
					const redirectUri = 'https://vscode.dev/redirect';
					const scope = encodeURIComponent(scopes.join(' '));
					
					// Create the OAuth URL with PKCE parameters
					const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&response_type=code&scope=${scope}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${nonce}&code_challenge=${codeChallenge}&code_challenge_method=S256`;
					
					// Open the browser for authentication
					await vscode.env.openExternal(vscode.Uri.parse(authUrl));
					
					// Wait for the callback to be processed
					return new Promise((resolve, reject) => {
						// Store the promise callbacks in global state so they can be accessed by the URI handler
						context.globalState.update('tw-cline-stats-google-resolve', (session: any) => {
							resolve(session);
						});
						
						context.globalState.update('tw-cline-stats-google-reject', (error: any) => {
							reject(error);
						});
						
						// Set a timeout to reject if no callback is received
						const timeoutId = setTimeout(() => {
							context.globalState.update('tw-cline-stats-google-resolve', undefined);
							context.globalState.update('tw-cline-stats-google-reject', undefined);
							context.globalState.update('tw-cline-stats-google-timeout-id', undefined);
							reject(new Error('Authentication timed out'));
						}, 5 * 60 * 1000); // 5 minutes
						
						// Store only the numeric ID of the timeout, not the Timeout object itself
						context.globalState.update('tw-cline-stats-google-timeout-id', timeoutId[Symbol.toPrimitive]());
					});
				} catch (error) {
					throw new Error(`Failed to create session: ${error.message}`);
				}
			},
			removeSession: async (sessionId) => {
				// Remove session from storage
				await context.globalState.update('tw-cline-stats-google-sessions', undefined);
				
				// Notify session change
				const session = {
					id: sessionId,
					accessToken: '',
					account: { label: '', id: '' },
					scopes: []
				};
				sessionChangeEmitter.fire({ added: [], removed: [session], changed: [] });
			}
		}
	);
	context.subscriptions.push(googleAuthProvider);

	const sidebarWebview = new WebviewProvider(context, outputChannel)

	// Initialize test mode and add disposables to context
	context.subscriptions.push(...initializeTestMode(context, sidebarWebview))

	// Register custom commands
	registerCommands(context, sidebarWebview.controller)

	vscode.commands.executeCommand("setContext", "cline.isDevMode", IS_DEV && IS_DEV === "true")

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(WebviewProvider.sideBarId, sidebarWebview, {
			webviewOptions: { retainContextWhenHidden: true },
		}),
	)

	context.subscriptions.push(
		vscode.commands.registerCommand("cline.plusButtonClicked", async (webview: any) => {
			const openChat = async (instance?: WebviewProvider) => {
				await instance?.controller.clearTask()
				await instance?.controller.postStateToWebview()
				await instance?.controller.postMessageToWebview({
					type: "action",
					action: "chatButtonClicked",
				})
			}
			const isSidebar = !webview
			if (isSidebar) {
				openChat(WebviewProvider.getSidebarInstance())
			} else {
				WebviewProvider.getTabInstances().forEach(openChat)
			}
		}),
	)

	context.subscriptions.push(
		vscode.commands.registerCommand("cline.mcpButtonClicked", (webview: any) => {
			const openMcp = (instance?: WebviewProvider) =>
				instance?.controller.postMessageToWebview({
					type: "action",
					action: "mcpButtonClicked",
				})
			const isSidebar = !webview
			if (isSidebar) {
				openMcp(WebviewProvider.getSidebarInstance())
			} else {
				WebviewProvider.getTabInstances().forEach(openMcp)
			}
		}),
	)

	const openClineInNewTab = async () => {
		Logger.log("Opening Cline in new tab")
		// (this example uses webviewProvider activation event which is necessary to deserialize cached webview, but since we use retainContextWhenHidden, we don't need to use that event)
		// https://github.com/microsoft/vscode-extension-samples/blob/main/webview-sample/src/extension.ts
		const tabWebview = new WebviewProvider(context, outputChannel)
		//const column = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.viewColumn : undefined
		const lastCol = Math.max(...vscode.window.visibleTextEditors.map((editor) => editor.viewColumn || 0))

		// Check if there are any visible text editors, otherwise open a new group to the right
		const hasVisibleEditors = vscode.window.visibleTextEditors.length > 0
		if (!hasVisibleEditors) {
			await vscode.commands.executeCommand("workbench.action.newGroupRight")
		}
		const targetCol = hasVisibleEditors ? Math.max(lastCol + 1, 1) : vscode.ViewColumn.Two

		const panel = vscode.window.createWebviewPanel(WebviewProvider.tabPanelId, "Cline", targetCol, {
			enableScripts: true,
			retainContextWhenHidden: true,
			localResourceRoots: [context.extensionUri],
		})
		// TODO: use better svg icon with light and dark variants (see https://stackoverflow.com/questions/58365687/vscode-extension-iconpath)

		panel.iconPath = {
			light: vscode.Uri.joinPath(context.extensionUri, "assets", "icons", "robot_panel_light.png"),
			dark: vscode.Uri.joinPath(context.extensionUri, "assets", "icons", "robot_panel_dark.png"),
		}
		tabWebview.resolveWebviewView(panel)

		// Lock the editor group so clicking on files doesn't open them over the panel
		await setTimeoutPromise(100)
		await vscode.commands.executeCommand("workbench.action.lockEditorGroup")
	}

	context.subscriptions.push(vscode.commands.registerCommand("cline.popoutButtonClicked", openClineInNewTab))
	context.subscriptions.push(vscode.commands.registerCommand("cline.openInNewTab", openClineInNewTab))

	context.subscriptions.push(
		vscode.commands.registerCommand("cline.settingsButtonClicked", (webview: any) => {
			WebviewProvider.getAllInstances().forEach((instance) => {
				const openSettings = async (instance?: WebviewProvider) => {
					instance?.controller.postMessageToWebview({
						type: "action",
						action: "settingsButtonClicked",
					})
				}
				const isSidebar = !webview
				if (isSidebar) {
					openSettings(WebviewProvider.getSidebarInstance())
				} else {
					WebviewProvider.getTabInstances().forEach(openSettings)
				}
			})
		}),
	)

	context.subscriptions.push(
		vscode.commands.registerCommand("cline.historyButtonClicked", (webview: any) => {
			WebviewProvider.getAllInstances().forEach((instance) => {
				const openHistory = async (instance?: WebviewProvider) => {
					instance?.controller.postMessageToWebview({
						type: "action",
						action: "historyButtonClicked",
					})
				}
				const isSidebar = !webview
				if (isSidebar) {
					openHistory(WebviewProvider.getSidebarInstance())
				} else {
					WebviewProvider.getTabInstances().forEach(openHistory)
				}
			})
		}),
	)

	context.subscriptions.push(
		vscode.commands.registerCommand("cline.accountButtonClicked", (webview: any) => {
			WebviewProvider.getAllInstances().forEach((instance) => {
				const openAccount = async (instance?: WebviewProvider) => {
					instance?.controller.postMessageToWebview({
						type: "action",
						action: "accountButtonClicked",
					})
				}
				const isSidebar = !webview
				if (isSidebar) {
					openAccount(WebviewProvider.getSidebarInstance())
				} else {
					WebviewProvider.getTabInstances().forEach(openAccount)
				}
			})
		}),
	)

	context.subscriptions.push(
		vscode.commands.registerCommand("cline.metricsButtonClicked", (webview: any) => {
			WebviewProvider.getAllInstances().forEach((instance) => {
				const openMetrics = async (instance?: WebviewProvider) => {
					instance?.controller.postMessageToWebview({
						type: "action",
						action: "metricsButtonClicked",
					})
				}
				const isSidebar = !webview
				if (isSidebar) {
					openMetrics(WebviewProvider.getSidebarInstance())
				} else {
					WebviewProvider.getTabInstances().forEach(openMetrics)
				}
			})
		}),
	)

	/*
	We use the text document content provider API to show the left side for diff view by creating a virtual document for the original content. This makes it readonly so users know to edit the right side if they want to keep their changes.

	- This API allows you to create readonly documents in VSCode from arbitrary sources, and works by claiming an uri-scheme for which your provider then returns text contents. The scheme must be provided when registering a provider and cannot change afterwards.
	- Note how the provider doesn't create uris for virtual documents - its role is to provide contents given such an uri. In return, content providers are wired into the open document logic so that providers are always considered.
	https://code.visualstudio.com/api/extension-guides/virtual-documents
	*/
	const diffContentProvider = new (class implements vscode.TextDocumentContentProvider {
		provideTextDocumentContent(uri: vscode.Uri): string {
			return Buffer.from(uri.query, "base64").toString("utf-8")
		}
	})()
	context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(DIFF_VIEW_URI_SCHEME, diffContentProvider))

	// URI Handler
	const handleUri = async (uri: vscode.Uri) => {
		console.log("URI Handler called with:", {
			path: uri.path,
			query: uri.query,
			scheme: uri.scheme,
		})

		// Special handling for vscode.dev/redirect URLs
		if (uri.path === '/redirect' || uri.path === '/auth' || uri.path === '/stats-auth') {
			// This is a redirect from an OAuth provider
			console.log("Handling OAuth redirect");
		}

		const path = uri.path
		const query = new URLSearchParams(uri.query.replace(/\+/g, "%2B"))
		const visibleWebview = WebviewProvider.getVisibleInstance()
		if (!visibleWebview) {
			return
		}
		switch (path) {
			case "/openrouter": {
				const code = query.get("code")
				if (code) {
					await visibleWebview?.controller.handleOpenRouterCallback(code)
				}
				break
			}
			case "/auth": {
				const token = query.get("token")
				const state = query.get("state")
				const apiKey = query.get("apiKey")

				console.log("Auth callback received:", {
					token: token,
					state: state,
					apiKey: apiKey,
				})

				// Validate state parameter
				if (!(await visibleWebview?.controller.validateAuthState(state))) {
					vscode.window.showErrorMessage("Invalid auth state")
					return
				}

				if (token && apiKey) {
					await visibleWebview?.controller.handleAuthCallback(token, apiKey)
				}
				break
			}
			case "/redirect": {
				// This is the redirect from Google OAuth
				const code = query.get("code")
				const state = query.get("state")

				console.log("Google OAuth redirect received:", {
					code: code ? "present" : "missing",
					state: state ? "present" : "missing",
				})

				// Validate state parameter
				const storedNonce = await context.secrets.get('tw-cline-stats-google-nonce');
				if (!state || state !== storedNonce) {
					console.error("Invalid state parameter");
					
					// Get the reject function from global state
					const rejectFn = context.globalState.get('tw-cline-stats-google-reject');
					if (typeof rejectFn === 'function') {
						rejectFn(new Error('Invalid state parameter'));
					}
					
					// Clear the timeout
					const timeoutId = context.globalState.get<number>('tw-cline-stats-google-timeout-id');
					if (timeoutId) {
						clearTimeout(timeoutId);
					}
					
					// Clear the callbacks
					context.globalState.update('tw-cline-stats-google-resolve', undefined);
					context.globalState.update('tw-cline-stats-google-reject', undefined);
					context.globalState.update('tw-cline-stats-google-timeout-id', undefined);
					
					vscode.window.showErrorMessage("Invalid authentication state");
					return;
				}

				if (code) {
					try {
						// Exchange the code for a token using PKCE
						const clientId = "457066567820-e0c86m2ao3j3lactebdlob9nel86t9vp.apps.googleusercontent.com"
						const redirectUri = "https://vscode.dev/redirect"
						
						// Retrieve the code verifier from secure storage
						const codeVerifier = await context.secrets.get('tw-cline-stats-google-verifier');
						if (!codeVerifier) {
							throw new Error('Code verifier not found');
						}
						
						// Make a request to Google's token endpoint with PKCE
						const tokenResponse = await axios.post(
							"https://oauth2.googleapis.com/token",
							{
								code,
								client_id: clientId,
								redirect_uri: redirectUri,
								grant_type: "authorization_code",
								code_verifier: codeVerifier
							},
							{
								headers: {
									"Content-Type": "application/json"
								}
							}
						)
						
						const { access_token, id_token } = tokenResponse.data
						
						// Get user info from the ID token
						const userInfoPart = id_token.split('.')[1]
						const userInfoJson = Buffer.from(userInfoPart, 'base64').toString()
						const userInfo = JSON.parse(userInfoJson)
						
						// Create session object
						const session = {
							id: `google-${userInfo.sub}`,
							accessToken: access_token,
							account: {
								label: userInfo.email,
								id: userInfo.sub
							},
							scopes: ['email', 'profile']
						};
						
						// Store session
						await context.globalState.update('tw-cline-stats-google-sessions', session);
						
						// Get the resolve function from global state
						const resolveFn = context.globalState.get('tw-cline-stats-google-resolve');
						if (typeof resolveFn === 'function') {
							resolveFn(session);
						}
						
						// Clear the timeout
						const timeoutId = context.globalState.get<number>('tw-cline-stats-google-timeout-id');
						if (timeoutId) {
							clearTimeout(timeoutId);
						}
						
						// Clear the callbacks
						context.globalState.update('tw-cline-stats-google-resolve', undefined);
						context.globalState.update('tw-cline-stats-google-reject', undefined);
						context.globalState.update('tw-cline-stats-google-timeout-id', undefined);
						
						// Also update the metrics controller if available
						const metricsController = visibleWebview?.controller.metricsController;
						if (metricsController?.statsAuthService) {
							const statsUserInfo = {
								email: userInfo.email || null,
								displayName: userInfo.name || null
							};
							
							await metricsController.statsAuthService.handleAuthCallback(access_token, statsUserInfo);
						}
						
						vscode.window.showInformationMessage("Successfully logged in to Statistics");
					} catch (error) {
						console.error("Error exchanging code for token:", error);
						
						// Get the reject function from global state
						const rejectFn = context.globalState.get('tw-cline-stats-google-reject');
						if (typeof rejectFn === 'function') {
							rejectFn(error);
						}
						
						// Clear the timeout
						const timeoutId = context.globalState.get<number>('tw-cline-stats-google-timeout-id');
						if (timeoutId) {
							clearTimeout(timeoutId);
						}
						
						// Clear the callbacks
						context.globalState.update('tw-cline-stats-google-resolve', undefined);
						context.globalState.update('tw-cline-stats-google-reject', undefined);
						context.globalState.update('tw-cline-stats-google-timeout-id', undefined);
						
						vscode.window.showErrorMessage("Failed to complete Google authentication");
					}
				}
				break;
			}
			default:
				break
		}
	}
	context.subscriptions.push(vscode.window.registerUriHandler({ handleUri }))

	// Register size testing commands in development mode
	if (IS_DEV && IS_DEV === "true") {
		// Use dynamic import to avoid loading the module in production
		import("./dev/commands/tasks")
			.then((module) => {
				const devTaskCommands = module.registerTaskCommands(context, sidebarWebview.controller)
				context.subscriptions.push(...devTaskCommands)
				Logger.log("Cline dev task commands registered")
			})
			.catch((error) => {
				Logger.log("Failed to register dev task commands: " + error)
			})
	}

	context.subscriptions.push(
		vscode.commands.registerCommand("cline.addToChat", async (range?: vscode.Range, diagnostics?: vscode.Diagnostic[]) => {
			const editor = vscode.window.activeTextEditor
			if (!editor) {
				return
			}

			// Use provided range if available, otherwise use current selection
			// (vscode command passes an argument in the first param by default, so we need to ensure it's a Range object)
			const textRange = range instanceof vscode.Range ? range : editor.selection
			const selectedText = editor.document.getText(textRange)

			if (!selectedText) {
				return
			}

			// Get the file path and language ID
			const filePath = editor.document.uri.fsPath
			const languageId = editor.document.languageId

			const visibleWebview = WebviewProvider.getVisibleInstance()
			await visibleWebview?.controller.addSelectedCodeToChat(
				selectedText,
				filePath,
				languageId,
				Array.isArray(diagnostics) ? diagnostics : undefined,
			)
		}),
	)

	context.subscriptions.push(
		vscode.commands.registerCommand("cline.addTerminalOutputToChat", async () => {
			const terminal = vscode.window.activeTerminal
			if (!terminal) {
				return
			}

			// Save current clipboard content
			const tempCopyBuffer = await vscode.env.clipboard.readText()

			try {
				// Copy the *existing* terminal selection (without selecting all)
				await vscode.commands.executeCommand("workbench.action.terminal.copySelection")

				// Get copied content
				let terminalContents = (await vscode.env.clipboard.readText()).trim()

				// Restore original clipboard content
				await vscode.env.clipboard.writeText(tempCopyBuffer)

				if (!terminalContents) {
					// No terminal content was copied (either nothing selected or some error)
					return
				}

				// [Optional] Any additional logic to process multi-line content can remain here
				// For example:
				/*
				const lines = terminalContents.split("\n")
				const lastLine = lines.pop()?.trim()
				if (lastLine) {
					let i = lines.length - 1
					while (i >= 0 && !lines[i].trim().startsWith(lastLine)) {
						i--
					}
					terminalContents = lines.slice(Math.max(i, 0)).join("\n")
				}
				*/

				// Send to sidebar provider
				const visibleWebview = WebviewProvider.getVisibleInstance()
				await visibleWebview?.controller.addSelectedTerminalOutputToChat(terminalContents, terminal.name)
			} catch (error) {
				// Ensure clipboard is restored even if an error occurs
				await vscode.env.clipboard.writeText(tempCopyBuffer)
				console.error("Error getting terminal contents:", error)
				vscode.window.showErrorMessage("Failed to get terminal contents")
			}
		}),
	)

	// Register code action provider
	context.subscriptions.push(
		vscode.languages.registerCodeActionsProvider(
			"*",
			new (class implements vscode.CodeActionProvider {
				public static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix]

				provideCodeActions(
					document: vscode.TextDocument,
					range: vscode.Range,
					context: vscode.CodeActionContext,
				): vscode.CodeAction[] {
					// Expand range to include surrounding 3 lines
					const expandedRange = new vscode.Range(
						Math.max(0, range.start.line - 3),
						0,
						Math.min(document.lineCount - 1, range.end.line + 3),
						document.lineAt(Math.min(document.lineCount - 1, range.end.line + 3)).text.length,
					)

					const addAction = new vscode.CodeAction("Add to Cline", vscode.CodeActionKind.QuickFix)
					addAction.command = {
						command: "cline.addToChat",
						title: "Add to Cline",
						arguments: [expandedRange, context.diagnostics],
					}

					const fixAction = new vscode.CodeAction("Fix with Cline", vscode.CodeActionKind.QuickFix)
					fixAction.command = {
						command: "cline.fixWithCline",
						title: "Fix with Cline",
						arguments: [expandedRange, context.diagnostics],
					}

					// Only show actions when there are errors
					if (context.diagnostics.length > 0) {
						return [addAction, fixAction]
					} else {
						return []
					}
				}
			})(),
			{
				providedCodeActionKinds: [vscode.CodeActionKind.QuickFix],
			},
		),
	)

	// Register the command handler
	context.subscriptions.push(
		vscode.commands.registerCommand("cline.fixWithCline", async (range: vscode.Range, diagnostics: vscode.Diagnostic[]) => {
			// Add this line to focus the chat input first
			await vscode.commands.executeCommand("cline.focusChatInput")
			// Wait for a webview instance to become visible after focusing
			await pWaitFor(() => !!WebviewProvider.getVisibleInstance())
			const editor = vscode.window.activeTextEditor
			if (!editor) {
				return
			}

			const selectedText = editor.document.getText(range)
			const filePath = editor.document.uri.fsPath
			const languageId = editor.document.languageId

			// Send to sidebar provider with diagnostics
			const visibleWebview = WebviewProvider.getVisibleInstance()
			await visibleWebview?.controller.fixWithCline(selectedText, filePath, languageId, diagnostics)
		}),
	)

	// Register the focusChatInput command handler
	context.subscriptions.push(
		vscode.commands.registerCommand("cline.focusChatInput", () => {
			let visibleWebview = WebviewProvider.getVisibleInstance()
			if (!visibleWebview) {
				vscode.commands.executeCommand("claude-dev.SidebarProvider.focus")
				visibleWebview = WebviewProvider.getSidebarInstance()
				// showing the extension will call didBecomeVisible which focuses it already
				// but it doesn't focus if a tab is selected which focusChatInput accounts for
			}

			visibleWebview?.controller.postMessageToWebview({
				type: "action",
				action: "focusChatInput",
			})
		}),
	)

	// Register command to manually trigger token backfill
	context.subscriptions.push(
		vscode.commands.registerCommand("cline.backfillTokenUsage", async () => {
			vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					title: "Backfilling token usage data...",
					cancellable: false
				},
				async (progress) => {
					const tokenBackfillService = new TokenBackfillService(context)
					const updatedCount = await tokenBackfillService.backfillAllTasks()
					vscode.window.showInformationMessage(
						`Token usage backfill complete. Updated ${updatedCount} tasks.`
					)
				}
			)
		})
	)
	
	// Register the generateGitCommitMessage command handler
	context.subscriptions.push(
		vscode.commands.registerCommand("cline.generateGitCommitMessage", async () => {
			// Get the controller from any instance, without activating the view
			const controller = WebviewProvider.getAllInstances()[0]?.controller

			if (controller) {
				// Call the controller method to generate commit message
				await controller.generateGitCommitMessage()
			} else {
				// Create a temporary controller just for this operation
				const outputChannel = vscode.window.createOutputChannel("Cline Commit Generator")
				const tempController = new Controller(context, outputChannel, () => Promise.resolve(true))

				await tempController.generateGitCommitMessage()
				outputChannel.dispose()
			}
		}),
	)
	
	// Register a command to handle the redirect URL
	context.subscriptions.push(
		vscode.commands.registerCommand("cline.handleRedirect", async (uri: vscode.Uri) => {
			// This command is called when the user is redirected from Google OAuth
			console.log("Handling redirect URL:", uri.toString())
			
			// Extract the code and state from the query parameters
			const query = new URLSearchParams(uri.query)
			const code = query.get("code")
			const state = query.get("state")
			
			if (code && state) {
				// Validate the state parameter
				const storedNonce = await context.secrets.get('tw-cline-stats-google-nonce')
				if (state !== storedNonce) {
					vscode.window.showErrorMessage("Invalid authentication state")
					return
				}
				
				try {
					// Exchange the code for a token using PKCE
					const clientId = "457066567820-e0c86m2ao3j3lactebdlob9nel86t9vp.apps.googleusercontent.com"
					const redirectUri = "https://vscode.dev/redirect"
					
					// Retrieve the code verifier from secure storage
					const codeVerifier = await context.secrets.get('tw-cline-stats-google-verifier');
					if (!codeVerifier) {
						throw new Error('Code verifier not found');
					}
					
					// Make a request to Google's token endpoint with PKCE
					const tokenResponse = await axios.post(
						"https://oauth2.googleapis.com/token",
						{
							code,
							client_id: clientId,
							redirect_uri: redirectUri,
							grant_type: "authorization_code",
							code_verifier: codeVerifier
						},
						{
							headers: {
								"Content-Type": "application/json"
							}
						}
					)
					
					const { access_token, id_token } = tokenResponse.data
					
					// Get user info from the ID token
					const userInfoPart = id_token.split('.')[1]
					const userInfoJson = Buffer.from(userInfoPart, 'base64').toString()
					const userInfo = JSON.parse(userInfoJson)
					
					// Create session object
					const session = {
						id: `google-${userInfo.sub}`,
						accessToken: access_token,
						account: {
							label: userInfo.email,
							id: userInfo.sub
						},
						scopes: ['email', 'profile']
					}
					
					// Store session
					await context.globalState.update('tw-cline-stats-google-sessions', session)
					
					// Get the resolve function from global state
					const resolveFn = context.globalState.get('tw-cline-stats-google-resolve')
					if (typeof resolveFn === 'function') {
						resolveFn(session)
					}
					
					// Clear the timeout
					const timeoutId = context.globalState.get<number>('tw-cline-stats-google-timeout-id')
					if (timeoutId) {
						clearTimeout(timeoutId)
					}
					
					// Clear the callbacks
					context.globalState.update('tw-cline-stats-google-resolve', undefined)
					context.globalState.update('tw-cline-stats-google-reject', undefined)
					context.globalState.update('tw-cline-stats-google-timeout-id', undefined)
					
					// Also update the metrics controller if available
					const visibleWebview = WebviewProvider.getVisibleInstance()
					const metricsController = visibleWebview?.controller.metricsController
					if (metricsController?.statsAuthService) {
						const statsUserInfo = {
							email: userInfo.email || null,
							displayName: userInfo.name || null
						}
						
						await metricsController.statsAuthService.handleAuthCallback(access_token, statsUserInfo)
					}
					
					vscode.window.showInformationMessage("Successfully logged in to Statistics")
				} catch (error) {
					console.error("Error exchanging code for token:", error)
					
					// Get the reject function from global state
					const rejectFn = context.globalState.get('tw-cline-stats-google-reject')
					if (typeof rejectFn === 'function') {
						rejectFn(error)
					}
					
					// Clear the timeout
					const timeoutId = context.globalState.get<number>('tw-cline-stats-google-timeout-id')
					if (timeoutId) {
						clearTimeout(timeoutId)
					}
					
					// Clear the callbacks
					context.globalState.update('tw-cline-stats-google-resolve', undefined)
					context.globalState.update('tw-cline-stats-google-reject', undefined)
					context.globalState.update('tw-cline-stats-google-timeout-id', undefined)
					
					vscode.window.showErrorMessage("Failed to complete Google authentication")
				}
			}
		})
	)

	// Register the diagnostic check for commit tracking
	context.subscriptions.push(
		vscode.commands.registerCommand("cline.diagnoseCommitTracking", async () => {
			// Get the controller from any instance, without activating the view
			const controller = WebviewProvider.getAllInstances()[0]?.controller

			if (controller) {
				try {
					vscode.window.showInformationMessage("Running git commit tracking diagnosis...")
					await runGitCommitCheckDiagnosis(context)
					vscode.window.showInformationMessage(
						"Git commit tracking diagnosis completed. Check the console for results.",
					)
				} catch (error) {
					const errorMessage = error instanceof Error ? error.message : String(error)
					vscode.window.showErrorMessage(`Error running git commit diagnosis: ${errorMessage}`)
				}
			} else {
				vscode.window.showErrorMessage("No active Cline instance found")
			}
		}),
	)

	// Register the test for git commit fix
	context.subscriptions.push(
		vscode.commands.registerCommand("cline.testGitCommitFix", async () => {
			// Get the controller from any instance, without activating the view
			const controller = WebviewProvider.getAllInstances()[0]?.controller

			if (controller) {
				try {
					vscode.window.showInformationMessage("Testing git commit fix...")
					await testGitCommitFix(context)
					vscode.window.showInformationMessage("Git commit fix test completed. Check the console for results.")
				} catch (error) {
					const errorMessage = error instanceof Error ? error.message : String(error)
					vscode.window.showErrorMessage(`Error testing git commit fix: ${errorMessage}`)
				}
			} else {
				vscode.window.showErrorMessage("No active Cline instance found")
			}
		}),
	)

	return createClineAPI(outputChannel, sidebarWebview.controller)
}

// TODO: Find a solution for automatically removing DEV related content from production builds.
//  This type of code is fine in production to keep. We just will want to remove it from production builds
//  to bring down built asset sizes.
//
// This is a workaround to reload the extension when the source code changes
// since vscode doesn't support hot reload for extensions
const { IS_DEV, DEV_WORKSPACE_FOLDER } = process.env

// This method is called when your extension is deactivated
export async function deactivate() {
	await telemetryService.sendCollectedEvents()

	// Clean up test mode
	cleanupTestMode()
	
	// Clean up stats auth service if it exists
	const webviewProvider = WebviewProvider.getVisibleInstance();
	if (webviewProvider?.controller?.metricsController?.statsAuthService) {
		await webviewProvider.controller.metricsController.statsAuthService.dispose();
	}
	
	await posthogClientProvider.shutdown()
	Logger.log("Cline extension deactivated")
}

// Set up development mode file watcher
if (IS_DEV && IS_DEV !== "false") {
	assert(DEV_WORKSPACE_FOLDER, "DEV_WORKSPACE_FOLDER must be set in development")
	const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(DEV_WORKSPACE_FOLDER, "src/**/*"))

	watcher.onDidChange(({ scheme, path }) => {
		console.info(`${scheme} ${path} changed. Reloading VSCode...`)

		vscode.commands.executeCommand("workbench.action.reloadWindow")
	})
}
