import React, { useEffect } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { vscode } from "@/utils/vscode"
import { VSCodeButton, VSCodeProgressRing } from "@vscode/webview-ui-toolkit/react"

interface StatisticsViewProps {
  onBack: () => void;
}

/**
 * Component to display extension usage statistics
 */
export const StatisticsView: React.FC<StatisticsViewProps> = ({ onBack }) => {
  const { fileEditStatistics } = useExtensionState()

  useEffect(() => {
    // Fetch file edit statistics when component mounts
    console.log("StatisticsView mounted, fetching statistics...")
    vscode.postMessage({
      type: "fetchFileEditStatistics"
    })
  }, [])

  // Calculate acceptance rate percentage
  const calculateAcceptanceRate = () => {
    if (!fileEditStatistics || fileEditStatistics.totalSuggestions === 0) {
      return 0
    }
    return Math.round((fileEditStatistics.acceptedSuggestions / fileEditStatistics.totalSuggestions) * 100)
  }

  // Add debug logging to monitor fileEditStatistics state
  useEffect(() => {
    console.log("fileEditStatistics updated:", fileEditStatistics)
  }, [fileEditStatistics])

  if (!fileEditStatistics) {
    return (
      <div className="fixed inset-0 flex flex-col overflow-hidden pt-[10px] pl-[20px]">
        <div className="flex justify-between items-center mb-[17px] pr-[17px]">
          <h3 className="text-[var(--vscode-foreground)] m-0">Statistics</h3>
          <VSCodeButton onClick={onBack}>Back</VSCodeButton>
        </div>
        <div className="flex-grow flex items-center justify-center">
          <div className="text-center">
            <VSCodeProgressRing className="mb-4" />
            <div>Loading statistics data...</div>
          </div>
        </div>
      </div>
    )
  }

  const acceptanceRate = calculateAcceptanceRate()

  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden pt-[10px] pl-[20px]">
      <div className="flex justify-between items-center mb-[17px] pr-[17px]">
        <h3 className="text-[var(--vscode-foreground)] m-0">Statistics</h3>
        <VSCodeButton onClick={onBack}>Back</VSCodeButton>
      </div>
      <div className="flex-grow overflow-hidden pr-[8px] flex flex-col">
        <div className="border border-[var(--vscode-editorWidget-border)] rounded-md p-4 bg-[var(--vscode-editor-background)]">
          <div className="mb-4">
            <h3 className="text-md font-medium mb-2">File Edit Suggestions</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="border-r border-[var(--vscode-editorWidget-border)] pr-4">
                <div className="text-sm text-[var(--vscode-descriptionForeground)]">Total Suggestions</div>
                <div className="text-2xl font-semibold mt-1">{fileEditStatistics.totalSuggestions}</div>
              </div>
              <div>
                <div className="text-sm text-[var(--vscode-descriptionForeground)]">Acceptance Rate</div>
                <div className="text-2xl font-semibold mt-1">
                  {acceptanceRate}%
                  <span className="text-sm ml-2 text-[var(--vscode-descriptionForeground)]">
                    ({fileEditStatistics.acceptedSuggestions} accepted)
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default StatisticsView
