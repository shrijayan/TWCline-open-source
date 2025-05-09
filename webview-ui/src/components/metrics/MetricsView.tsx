import { VSCodeButton, VSCodeDivider, VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react";
import { memo, useEffect, useState, useRef } from "react";
import { useExtensionState } from "@/context/ExtensionStateContext";
import { MetricsData } from "@shared/metrics";

type MetricsViewProps = {
  onDone: () => void;
};

const MetricsView = ({ onDone }: MetricsViewProps) => {
  const { metricsData, postMessage } = useExtensionState();
  const [dateRange, setDateRange] = useState<"7d" | "30d" | "all">("7d");
  const [isLoading, setIsLoading] = useState(true);

  // Format time in milliseconds to a human-readable format
  const formatTime = (ms: number): string => {
    if (ms === 0) return "N/A";
    
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  };

  // Track if this is the first render
  const isFirstRender = useRef(true);

  // Request metrics data when component mounts or date range changes
  useEffect(() => {
    // Only refresh metrics if this is the first render or if the date range has changed
    if (isFirstRender.current || dateRange !== prevDateRangeRef.current) {
      setIsLoading(true);
      postMessage({
        type: "refreshMetrics",
        dateRange,
        forceRecalculate: isFirstRender.current
      });
      
      // After the first render, set isFirstRender to false
      isFirstRender.current = false;
      // Update the previous date range
      prevDateRangeRef.current = dateRange;
    }
  }, [dateRange, postMessage]);
  
  // Track the previous date range to avoid unnecessary refreshes
  const prevDateRangeRef = useRef<"7d" | "30d" | "all">("7d");

  // Update loading state when metrics data is received
  useEffect(() => {
    if (metricsData) {
      setIsLoading(false);
    }
  }, [metricsData]);

  // Handle refresh button click
  const handleRefresh = () => {
    setIsLoading(true);
    postMessage({
      type: "refreshMetrics",
      dateRange,
      forceRecalculate: true
    });
  };

  // If no metrics data is available, show a loading or empty state
  if (!metricsData) {
    return (
      <div className="fixed inset-0 flex flex-col overflow-hidden pt-[10px] pl-[20px]">
        <div className="flex justify-between items-center mb-[17px] pr-[17px]">
          <h3 className="text-[var(--vscode-foreground)] m-0">Usage Metrics</h3>
          <VSCodeButton onClick={onDone}>Done</VSCodeButton>
        </div>
        <div className="flex-grow flex items-center justify-center">
          {isLoading ? (
            <div className="text-center">
              <div className="mb-4">Loading metrics data...</div>
              <div className="animate-spin h-8 w-8 border-4 border-t-transparent border-[var(--vscode-button-background)] rounded-full mx-auto"></div>
            </div>
          ) : (
            <div className="text-center">
              <div className="mb-4">No metrics data available</div>
              <VSCodeButton onClick={handleRefresh}>Refresh</VSCodeButton>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden pt-[10px] pl-[20px]">
      <div className="flex justify-between items-center mb-[17px] pr-[17px]">
        <h3 className="text-[var(--vscode-foreground)] m-0">Usage Metrics</h3>
        <div className="flex items-center gap-2">
          <VSCodeDropdown
            value={dateRange}
            onChange={(e) => {
              const target = e.target as HTMLSelectElement;
              setDateRange(target.value as "7d" | "30d" | "all");
            }}
          >
            <VSCodeOption value="7d">Last 7 days</VSCodeOption>
            <VSCodeOption value="30d">Last 30 days</VSCodeOption>
            <VSCodeOption value="all">All time</VSCodeOption>
          </VSCodeDropdown>
          <VSCodeButton appearance="icon" onClick={handleRefresh} title="Refresh metrics">
            <span className="codicon codicon-refresh"></span>
          </VSCodeButton>
          <VSCodeButton onClick={onDone}>Done</VSCodeButton>
        </div>
      </div>
      <div className="flex-grow overflow-auto pr-[8px]">
        <div className="space-y-6">
          <div className="bg-[var(--vscode-editor-background)] p-4 rounded-md">
            <h4 className="mb-3">Task Statistics</h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
              <div className="bg-[var(--vscode-sideBar-background)] p-3 rounded-md">
                <div className="text-sm text-[var(--vscode-descriptionForeground)]">Total Tasks</div>
                <div className="text-2xl font-bold">{metricsData.taskMetrics.totalTasks}</div>
              </div>
              <div className="bg-[var(--vscode-sideBar-background)] p-3 rounded-md">
                <div className="text-sm text-[var(--vscode-descriptionForeground)]">Completed Tasks</div>
                <div className="text-2xl font-bold">{metricsData.taskMetrics.completedTasks}</div>
              </div>
              <div className="bg-[var(--vscode-sideBar-background)] p-3 rounded-md">
                <div className="text-sm text-[var(--vscode-descriptionForeground)]">Avg. Completion Time</div>
                <div className="text-2xl font-bold">{formatTime(metricsData.taskMetrics.averageCompletionTime)}</div>
              </div>
            </div>
            <div className="h-[200px] flex items-center justify-center bg-[var(--vscode-sideBar-background)] rounded-md">
              <div className="text-center text-[var(--vscode-descriptionForeground)]">
                {metricsData.taskMetrics.tasksPerDay.length > 0 ? (
                  <div className="p-4">
                    <div className="font-bold mb-2">Tasks per day</div>
                    <div className="flex items-end h-[150px] gap-1">
                      {metricsData.taskMetrics.tasksPerDay.map((day) => (
                        <div key={day.date} className="flex flex-col items-center flex-1">
                          <div className="w-full bg-[var(--vscode-button-background)] rounded-t-sm" 
                               style={{ height: `${(day.count / Math.max(...metricsData.taskMetrics.tasksPerDay.map(d => d.count), 1)) * 120}px` }}>
                          </div>
                          <div className="text-xs mt-1 truncate w-full text-center">
                            {new Date(day.date).toLocaleDateString(undefined, { weekday: 'short' })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  "No task data available"
                )}
              </div>
            </div>
          </div>

          <VSCodeDivider />

          <div className="bg-[var(--vscode-editor-background)] p-4 rounded-md">
            <h4 className="mb-3">Token Usage</h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
              <div className="bg-[var(--vscode-sideBar-background)] p-3 rounded-md">
                <div className="text-sm text-[var(--vscode-descriptionForeground)]">Input Tokens</div>
                <div className="text-2xl font-bold">{metricsData.tokenMetrics.totalTokensIn.toLocaleString()}</div>
              </div>
              <div className="bg-[var(--vscode-sideBar-background)] p-3 rounded-md">
                <div className="text-sm text-[var(--vscode-descriptionForeground)]">Output Tokens</div>
                <div className="text-2xl font-bold">{metricsData.tokenMetrics.totalTokensOut.toLocaleString()}</div>
              </div>
              <div className="bg-[var(--vscode-sideBar-background)] p-3 rounded-md">
                <div className="text-sm text-[var(--vscode-descriptionForeground)]">Estimated Cost</div>
                <div className="text-2xl font-bold">${metricsData.tokenMetrics.totalCost.toFixed(2)}</div>
              </div>
            </div>
            <div className="h-[200px] flex items-center justify-center bg-[var(--vscode-sideBar-background)] rounded-md">
              <div className="text-center text-[var(--vscode-descriptionForeground)]">
                {metricsData.tokenMetrics.usageByDay.length > 0 ? (
                  <div className="p-4">
                    <div className="font-bold mb-2">Token usage per day</div>
                    <div className="flex items-end h-[150px] gap-1">
                      {metricsData.tokenMetrics.usageByDay.map((day) => (
                        <div key={day.date} className="flex flex-col items-center flex-1">
                          <div className="w-full flex flex-col">
                            <div className="w-full bg-[var(--vscode-charts-blue)] rounded-t-sm" 
                                 style={{ height: `${(day.tokensIn / Math.max(...metricsData.tokenMetrics.usageByDay.map(d => d.tokensIn + d.tokensOut), 1)) * 120}px` }}>
                            </div>
                            <div className="w-full bg-[var(--vscode-charts-green)]" 
                                 style={{ height: `${(day.tokensOut / Math.max(...metricsData.tokenMetrics.usageByDay.map(d => d.tokensIn + d.tokensOut), 1)) * 120}px` }}>
                            </div>
                          </div>
                          <div className="text-xs mt-1 truncate w-full text-center">
                            {new Date(day.date).toLocaleDateString(undefined, { weekday: 'short' })}
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="flex justify-center mt-2 text-xs">
                      <div className="flex items-center mr-4">
                        <div className="w-3 h-3 bg-[var(--vscode-charts-blue)] mr-1"></div>
                        <span>Input</span>
                      </div>
                      <div className="flex items-center">
                        <div className="w-3 h-3 bg-[var(--vscode-charts-green)] mr-1"></div>
                        <span>Output</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  "No token usage data available"
                )}
              </div>
            </div>
          </div>

          <VSCodeDivider />

          <div className="bg-[var(--vscode-editor-background)] p-4 rounded-md">
            <h4 className="mb-3">Tool Usage</h4>
            <div className="h-[200px] flex items-center justify-center bg-[var(--vscode-sideBar-background)] rounded-md mb-4">
              <div className="text-center text-[var(--vscode-descriptionForeground)] w-full p-4">
                {metricsData.toolMetrics.tools.length > 0 ? (
                  <div>
                    <div className="font-bold mb-2">Tool usage distribution</div>
                    <div className="flex items-end h-[150px] gap-1">
                      {metricsData.toolMetrics.tools.slice(0, 10).map((tool) => (
                        <div key={tool.name} className="flex flex-col items-center flex-1">
                          <div className="w-full bg-[var(--vscode-button-background)] rounded-t-sm" 
                               style={{ height: `${(tool.count / Math.max(...metricsData.toolMetrics.tools.map(t => t.count), 1)) * 120}px` }}>
                          </div>
                          <div className="text-xs mt-1 truncate w-full text-center" title={tool.name}>
                            {tool.name.replace(/_/g, ' ')}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  "No tool usage data available"
                )}
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 md:grid-cols-3 gap-2">
              {metricsData.toolMetrics.tools.slice(0, 6).map((tool) => (
                <div key={tool.name} className="bg-[var(--vscode-sideBar-background)] p-2 rounded-md">
                  <div className="text-sm">{tool.name}</div>
                  <div className="font-bold">{tool.count} uses</div>
                  <div className="text-xs text-[var(--vscode-descriptionForeground)]">
                    {(tool.successRate * 100).toFixed(0)}% success rate
                  </div>
                </div>
              ))}
            </div>
          </div>

          <VSCodeDivider />

          <div className="bg-[var(--vscode-editor-background)] p-4 rounded-md">
            <h4 className="mb-3">Model Usage</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div className="h-[200px] flex items-center justify-center bg-[var(--vscode-sideBar-background)] rounded-md">
                <div className="text-center text-[var(--vscode-descriptionForeground)] w-full p-4">
                  {metricsData.modelMetrics.models.length > 0 ? (
                    <div>
                      <div className="font-bold mb-2">Model usage distribution</div>
                      <div className="flex items-end h-[150px] gap-1">
                        {metricsData.modelMetrics.models.slice(0, 5).map((model) => (
                          <div key={model.name} className="flex flex-col items-center flex-1">
                            <div className="w-full bg-[var(--vscode-charts-purple)] rounded-t-sm" 
                                 style={{ height: `${(model.count / Math.max(...metricsData.modelMetrics.models.map(m => m.count), 1)) * 120}px` }}>
                            </div>
                            <div className="text-xs mt-1 truncate w-full text-center" title={model.name}>
                              {model.name.split('/').pop()}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    "No model usage data available"
                  )}
                </div>
              </div>
              <div className="h-[200px] flex items-center justify-center bg-[var(--vscode-sideBar-background)] rounded-md">
                <div className="text-center text-[var(--vscode-descriptionForeground)] w-full p-4">
                  <div className="font-bold mb-2">Plan vs Act Mode</div>
                  <div className="flex justify-center items-center h-[150px]">
                    <div className="w-[150px] h-[150px] relative rounded-full overflow-hidden">
                      {metricsData.modelMetrics.modeUsage.plan + metricsData.modelMetrics.modeUsage.act > 0 ? (
                        <>
                          <div 
                            className="absolute bg-[var(--vscode-charts-blue)]" 
                            style={{
                              width: '100%',
                              height: '100%',
                              clipPath: `polygon(50% 50%, 50% 0, ${50 + 50 * Math.cos(2 * Math.PI * metricsData.modelMetrics.modeUsage.plan / (metricsData.modelMetrics.modeUsage.plan + metricsData.modelMetrics.modeUsage.act))}% ${50 - 50 * Math.sin(2 * Math.PI * metricsData.modelMetrics.modeUsage.plan / (metricsData.modelMetrics.modeUsage.plan + metricsData.modelMetrics.modeUsage.act))}%, 50% 50%)`
                            }}
                          ></div>
                          <div 
                            className="absolute bg-[var(--vscode-charts-green)]" 
                            style={{
                              width: '100%',
                              height: '100%',
                              clipPath: `polygon(50% 50%, ${50 + 50 * Math.cos(2 * Math.PI * metricsData.modelMetrics.modeUsage.plan / (metricsData.modelMetrics.modeUsage.plan + metricsData.modelMetrics.modeUsage.act))}% ${50 - 50 * Math.sin(2 * Math.PI * metricsData.modelMetrics.modeUsage.plan / (metricsData.modelMetrics.modeUsage.plan + metricsData.modelMetrics.modeUsage.act))}%, 100% 0%, 100% 100%, 0% 100%, 0% 0%, 50% 0%)`
                            }}
                          ></div>
                        </>
                      ) : (
                        <div className="w-full h-full bg-[var(--vscode-charts-gray)]"></div>
                      )}
                    </div>
                  </div>
                  <div className="flex justify-center mt-2 text-xs">
                    <div className="flex items-center mr-4">
                      <div className="w-3 h-3 bg-[var(--vscode-charts-blue)] mr-1"></div>
                      <span>Plan: {metricsData.modelMetrics.modeUsage.plan}</span>
                    </div>
                    <div className="flex items-center">
                      <div className="w-3 h-3 bg-[var(--vscode-charts-green)] mr-1"></div>
                      <span>Act: {metricsData.modelMetrics.modeUsage.act}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-2">
              {metricsData.modelMetrics.models.slice(0, 4).map((model) => (
                <div key={model.name} className="bg-[var(--vscode-sideBar-background)] p-2 rounded-md">
                  <div className="text-sm truncate" title={model.name}>{model.name}</div>
                  <div className="font-bold">{model.count} uses</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default memo(MetricsView);
