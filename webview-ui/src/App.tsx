import { useCallback, useEffect, useState, useRef } from "react"
import { useEvent } from "react-use"
import { ExtensionMessage } from "@shared/ExtensionMessage"
import ChatView from "./components/chat/ChatView"
import HistoryView from "./components/history/HistoryView"
import SettingsView from "./components/settings/SettingsView"
import WelcomeView from "./components/welcome/WelcomeView"
import AccountView from "./components/account/AccountView"
import MetricsView from "./components/metrics/MetricsView"
import { useExtensionState } from "./context/ExtensionStateContext"
import { vscode } from "./utils/vscode"
import McpView from "./components/mcp/configuration/McpConfigurationView"
import { Providers } from "./Providers"

const AppContent = () => {
	const { didHydrateState, showWelcome, shouldShowAnnouncement, showMcp, mcpTab, postMessage } = useExtensionState()
	const [showSettings, setShowSettings] = useState(false)
	const hideSettings = useCallback(() => setShowSettings(false), [])
	const [showHistory, setShowHistory] = useState(false)
	const [showAccount, setShowAccount] = useState(false)
	const [showMetrics, setShowMetrics] = useState(false)
	const [showAnnouncement, setShowAnnouncement] = useState(false)

	const { setShowMcp, setMcpTab } = useExtensionState()

	const closeMcpView = useCallback(() => {
		setShowMcp(false)
		setMcpTab(undefined)
	}, [setShowMcp, setMcpTab])

	const handleMessage = useCallback(
		(e: MessageEvent) => {
			const message: ExtensionMessage = e.data
			switch (message.type) {
				case "action":
					switch (message.action!) {
						case "settingsButtonClicked":
							setShowSettings(true)
							setShowHistory(false)
							closeMcpView()
							setShowAccount(false)
							setShowMetrics(false)
							break
						case "metricsButtonClicked":
							setShowSettings(false)
							setShowHistory(false)
							closeMcpView()
							setShowAccount(false)
							setShowMetrics(true)
							break
						case "chatButtonClicked":
							setShowSettings(false)
							setShowHistory(false)
							closeMcpView()
							setShowAccount(false)
							setShowMetrics(false)
							break
						case "mcpButtonClicked":
							setShowSettings(false)
							setShowHistory(false)
							if (message.tab) {
								setMcpTab(message.tab)
							}
							setShowMcp(true)
							setShowAccount(false)
							setShowMetrics(false)
							break
						case "accountButtonClicked":
							setShowSettings(false)
							setShowHistory(false)
							closeMcpView()
							setShowAccount(true)
							setShowMetrics(false)
							break
						case "historyButtonClicked":
							setShowSettings(false)
							setShowHistory(true)
							closeMcpView()
							setShowAccount(false)
							setShowMetrics(false)
							break
					}
					break
			}
		},
		[setShowMcp, setMcpTab, closeMcpView],
	)

	useEvent("message", handleMessage)

	useEffect(() => {
		if (shouldShowAnnouncement) {
			setShowAnnouncement(true)
			vscode.postMessage({ type: "didShowAnnouncement" })
		}
	}, [shouldShowAnnouncement])
	
	// Refresh metrics data when metrics panel is first shown
	const prevShowMetricsRef = useRef(false);
	useEffect(() => {
		// Only refresh when transitioning from not showing to showing
		if (showMetrics && !prevShowMetricsRef.current) {
			postMessage({
				type: "refreshMetrics",
				dateRange: "7d",
				forceRecalculate: true
			});
		}
		// Update the ref for the next render
		prevShowMetricsRef.current = showMetrics;
	}, [showMetrics, postMessage]);

	if (!didHydrateState) {
		return null
	}

	return (
		<>
			{showWelcome ? (
				<WelcomeView />
			) : (
				<>
					{showSettings && <SettingsView onDone={hideSettings} />}
					{showHistory && <HistoryView onDone={() => setShowHistory(false)} />}
					{showMcp && <McpView initialTab={mcpTab} onDone={closeMcpView} />}
					{showAccount && <AccountView onDone={() => setShowAccount(false)} />}
					{showMetrics && <MetricsView onDone={() => setShowMetrics(false)} />}
					{/* Do not conditionally load ChatView, it's expensive and there's state we don't want to lose (user input, disableInput, askResponse promise, etc.) */}
					<ChatView
						showHistoryView={() => {
							setShowSettings(false)
							closeMcpView()
							setShowAccount(false)
							setShowHistory(true)
						}}
						isHidden={showSettings || showHistory || showMcp || showAccount || showMetrics}
						showAnnouncement={showAnnouncement}
						hideAnnouncement={() => {
							setShowAnnouncement(false)
						}}
					/>
				</>
			)}
		</>
	)
}

const App = () => {
	return (
		<Providers>
			<AppContent />
		</Providers>
	)
}

export default App
