import { VSCodeButton, VSCodeDivider, VSCodeDropdown, VSCodeOption, VSCodeProgressRing } from "@vscode/webview-ui-toolkit/react";
import { memo, useEffect, useState, useRef } from "react";
import { useExtensionState } from "@/context/ExtensionStateContext";
import { MetricsData } from "@shared/metrics";

// Stats user info interface
interface StatsUserInfo {
  displayName: string | null;
  email: string | null;
}

type MetricsViewProps = {
  onDone: () => void;
};

const MetricsView = ({ onDone }: MetricsViewProps) => {
  const { metricsData, metricsLoading, postMessage, statsUserInfo } = useExtensionState();
  const [dateRange, setDateRange] = useState<"7d" | "30d" | "all">("7d");
  const [isLoading, setIsLoading] = useState<boolean>(metricsLoading || true);
  const [isAuthLoading, setIsAuthLoading] = useState(false);
  const [statsUser, setStatsUser] = useState<StatsUserInfo | null>(null);

  // Check if user is logged in from state
  useEffect(() => {
    if (statsUserInfo) {
      setStatsUser(statsUserInfo);
    } else {
      setStatsUser(null);
    }
  }, [statsUserInfo]);

  // Handle login button click
  const handleLogin = () => {
    console.log("MetricsView: handleLogin called");
    setIsAuthLoading(true);
    try {
      postMessage({
        type: "statsLoginClicked"
      });
      console.log("MetricsView: statsLoginClicked message posted");
    } catch (error) {
      console.error("MetricsView: Error posting statsLoginClicked message:", error);
      setIsAuthLoading(false);
    }
  };

  // Handle logout button click
  const handleLogout = () => {
    setIsAuthLoading(true);
    postMessage({
      type: "statsLogoutClicked"
    });
  };

  // Listen for auth state changes
  useEffect(() => {
    const handleAuthStateChange = (event: any) => {
      if (event.data?.type === "statsAuthStateChanged") {
        console.log("MetricsView: Received statsAuthStateChanged event", event.data);
        setIsAuthLoading(false);
        setStatsUser(event.data.statsUserInfo || null);
      }
    };

    window.addEventListener("message", handleAuthStateChange);
    return () => {
      window.removeEventListener("message", handleAuthStateChange);
    };
  }, []);

  // Format time in milliseconds to a human-readable format
  const formatTime = (ms: number): string => {
    // Handle negative values (should not occur after our backend fix, but just in case)
    if (ms < 0) {
      console.warn("Negative time value detected:", ms);
      // Use absolute value for display
      ms = Math.abs(ms);
    }
    
    // Always show a time value, even if it's 0
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

  // Listen for metrics updates and loading state changes
  useEffect(() => {
    const handleMetricsUpdate = (event: any) => {
      if (event.data?.type === "metricsData") {
        setIsLoading(false);
        // Only update if we have data
        if (event.data.metricsData) {
          // The ExtensionStateContext will handle updating metricsData
        }
      } else if (event.data?.type === "metricsLoading") {
        setIsLoading(event.data.isLoading);
      }
    };

    window.addEventListener("message", handleMetricsUpdate);
    return () => {
      window.removeEventListener("message", handleMetricsUpdate);
    };
  }, []);

  // Also update loading state when metrics data is received through context
  useEffect(() => {
    if (metricsData) {
      setIsLoading(false);
    }
  }, [metricsData]);

  // Update loading state when metricsLoading changes in context
  useEffect(() => {
    setIsLoading(metricsLoading || false);
  }, [metricsLoading]);

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
      
      {/* Authentication Section */}
      <div className="bg-[var(--vscode-editor-background)] p-4 rounded-md mb-4">
        <div className="flex justify-between items-center">
          <div>
            <h4 className="mb-1">Statistics Account</h4>
            <p className="text-sm text-[var(--vscode-descriptionForeground)]">
              {statsUser 
                ? `Logged in as ${statsUser.displayName || statsUser.email || 'User'}` 
                : "Log in to access enhanced statistics and leaderboards"}
            </p>
          </div>
          <div>
            {isAuthLoading ? (
              <VSCodeProgressRing />
            ) : statsUser ? (
              <VSCodeButton onClick={handleLogout}>
                Sign Out
              </VSCodeButton>
            ) : (
              <VSCodeButton onClick={handleLogin}>
                Sign In with Google
              </VSCodeButton>
            )}
          </div>
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
            <div className="h-[300px] flex items-center justify-center bg-[var(--vscode-sideBar-background)] rounded-md">
              <div className="text-center text-[var(--vscode-descriptionForeground)] w-full">
                {metricsData.taskMetrics.tasksPerDay.length > 0 ? (
                  <div className="p-4">
                    <div className="font-bold mb-4 text-lg">Tasks per day</div>
                    <div className="w-full h-[240px] relative">
                      {/* Chart container with gradient background */}
                      <div className="absolute inset-0 bg-gradient-to-b from-transparent to-[var(--vscode-editor-background)] opacity-20 rounded-md"></div>
                      
                      <svg width="100%" height="100%" viewBox="0 0 600 240" preserveAspectRatio="none" className="relative z-10">
                        {/* Background grid */}
                        <defs>
                          <pattern id="smallGrid" width="60" height="30" patternUnits="userSpaceOnUse">
                            <path d="M 60 0 L 0 0 0 30" fill="none" stroke="var(--vscode-editor-lineHighlightBorder)" strokeWidth="0.5" strokeOpacity="0.5" />
                          </pattern>
                          <pattern id="grid" width="60" height="30" patternUnits="userSpaceOnUse">
                            <rect width="60" height="30" fill="url(#smallGrid)" />
                            <path d="M 60 0 L 0 0 0 30" fill="none" stroke="var(--vscode-editor-lineHighlightBorder)" strokeWidth="1" strokeOpacity="0.8" />
                          </pattern>
                          
                          {/* Gradient for the area under the line */}
                          <linearGradient id="areaGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                            <stop offset="0%" stopColor="var(--vscode-button-background)" stopOpacity="0.3" />
                            <stop offset="100%" stopColor="var(--vscode-button-background)" stopOpacity="0.05" />
                          </linearGradient>
                          
                          {/* Gradient for the line */}
                          <linearGradient id="lineGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                            <stop offset="0%" stopColor="var(--vscode-charts-blue)" />
                            <stop offset="100%" stopColor="var(--vscode-button-background)" />
                          </linearGradient>
                        </defs>
                        
                        {/* Left margin for Y-axis labels */}
                        <rect x="0" y="0" width="30" height="170" fill="transparent" />
                        
                        {/* Grid background - shifted right to make room for labels */}
                        <rect x="30" y="20" width="550" height="120" fill="url(#grid)" />
                        
                        {/* Main horizontal grid lines */}
                        <line x1="30" y1="20" x2="580" y2="20" stroke="var(--vscode-editor-lineHighlightBorder)" strokeWidth="1" />
                        <line x1="30" y1="50" x2="580" y2="50" stroke="var(--vscode-editor-lineHighlightBorder)" strokeWidth="0.5" />
                        <line x1="30" y1="80" x2="580" y2="80" stroke="var(--vscode-editor-lineHighlightBorder)" strokeWidth="0.5" />
                        <line x1="30" y1="110" x2="580" y2="110" stroke="var(--vscode-editor-lineHighlightBorder)" strokeWidth="0.5" />
                        <line x1="30" y1="140" x2="580" y2="140" stroke="var(--vscode-editor-lineHighlightBorder)" strokeWidth="1" />
                        
                        {/* Area under the line */}
                        <path
                          d={`
                            M 30,140
                            ${metricsData.taskMetrics.tasksPerDay.map((day, index) => {
                              const x = 30 + (index / (metricsData.taskMetrics.tasksPerDay.length - 1)) * 550;
                              const maxCount = Math.max(...metricsData.taskMetrics.tasksPerDay.map(d => d.count), 1);
                              // Use 100 instead of 120 to leave space at the top (20px buffer)
                              const y = 140 - (day.count / maxCount) * 100;
                              return `L ${x},${y}`;
                            }).join(' ')}
                            L 580,140 Z
                          `}
                          fill="url(#areaGradient)"
                        />
                        
                        {/* Line graph with smooth curve */}
                        <path
                          d={`
                            M ${metricsData.taskMetrics.tasksPerDay.map((day, index) => {
                              const x = 30 + (index / (metricsData.taskMetrics.tasksPerDay.length - 1)) * 550;
                              const maxCount = Math.max(...metricsData.taskMetrics.tasksPerDay.map(d => d.count), 1);
                              // Use 100 instead of 120 to leave space at the top (20px buffer)
                              const y = 140 - (day.count / maxCount) * 100;
                              return `${index === 0 ? '' : 'L'} ${x},${y}`;
                            }).join(' ')}
                          `}
                          fill="none"
                          stroke="url(#lineGradient)"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                        
                        {/* Data points with hover effect */}
                        {metricsData.taskMetrics.tasksPerDay.map((day, index) => {
                          const x = 30 + (index / (metricsData.taskMetrics.tasksPerDay.length - 1)) * 550;
                          const maxCount = Math.max(...metricsData.taskMetrics.tasksPerDay.map(d => d.count), 1);
                          // Use 100 instead of 120 to leave space at the top (20px buffer)
                          const y = 140 - (day.count / maxCount) * 100;
                          return (
                            <g key={day.date} className="group">
                              {/* Larger invisible circle for better hover target */}
                              <circle
                                cx={x}
                                cy={y}
                                r="8"
                                fill="transparent"
                                className="cursor-pointer"
                              />
                              {/* Visible data point */}
                              <circle
                                cx={x}
                                cy={y}
                                r="5"
                                fill="var(--vscode-button-background)"
                                stroke="var(--vscode-editor-background)"
                                strokeWidth="1.5"
                                className="cursor-pointer"
                              />
                              {/* Enhanced tooltip */}
                              <title>{`${new Date(day.date).toLocaleDateString()}: ${day.count} tasks`}</title>
                            </g>
                          );
                        })}
                        
                        {/* X-axis labels (dates) with better spacing */}
                        {metricsData.taskMetrics.tasksPerDay.filter((_, i, arr) => {
                          // Show more labels for better readability
                          const interval = arr.length <= 7 ? 1 : arr.length <= 14 ? 2 : Math.ceil(arr.length / 7);
                          return i === 0 || i === arr.length - 1 || i % interval === 0;
                        }).map((day, _, filteredArray) => {
                          const originalIndex = metricsData.taskMetrics.tasksPerDay.findIndex(d => d.date === day.date);
                          const x = 30 + (originalIndex / (metricsData.taskMetrics.tasksPerDay.length - 1)) * 550;
                          
                          return (
                            <g key={day.date}>
                              {/* Vertical tick mark */}
                              <line 
                                x1={x} 
                                y1="140" 
                                x2={x} 
                                y2="145" 
                                stroke="var(--vscode-editor-lineHighlightBorder)" 
                                strokeWidth="1" 
                              />
                              <text
                                x={x}
                                y="160"
                                fontSize="12"
                                textAnchor={originalIndex === 0 ? "start" : originalIndex === metricsData.taskMetrics.tasksPerDay.length - 1 ? "end" : "middle"}
                                fill="var(--vscode-descriptionForeground)"
                                className="font-medium"
                              >
                                {new Date(day.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                              </text>
                            </g>
                          );
                        })}
                        
                        {/* Y-axis labels with better formatting */}
                        <g>
                          <text x="25" y="145" fontSize="12" textAnchor="end" fill="var(--vscode-descriptionForeground)" className="font-medium">0</text>
                          
                          {/* Mid-point label */}
                          <text 
                            x="25" 
                            y="85" 
                            fontSize="12" 
                            textAnchor="end" 
                            fill="var(--vscode-descriptionForeground)"
                            className="font-medium"
                          >
                            {Math.floor(Math.max(...metricsData.taskMetrics.tasksPerDay.map(d => d.count), 1) / 2)}
                          </text>
                          
                          {/* Max value label */}
                          <text 
                            x="25" 
                            y="25" 
                            fontSize="12" 
                            textAnchor="end" 
                            fill="var(--vscode-descriptionForeground)"
                            className="font-medium"
                          >
                            {Math.max(...metricsData.taskMetrics.tasksPerDay.map(d => d.count), 1)}
                          </text>
                        </g>
                      </svg>
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
                    <div className="w-full h-[150px] relative">
                      {/* Chart container with gradient background */}
                      <div className="absolute inset-0 bg-gradient-to-b from-transparent to-[var(--vscode-editor-background)] opacity-20 rounded-md"></div>
                      
                      <svg width="100%" height="100%" viewBox="0 0 600 150" preserveAspectRatio="none" className="relative z-10">
                        {/* Background grid */}
                        <defs>
                          <pattern id="tokenSmallGrid" width="60" height="30" patternUnits="userSpaceOnUse">
                            <path d="M 60 0 L 0 0 0 30" fill="none" stroke="var(--vscode-editor-lineHighlightBorder)" strokeWidth="0.5" strokeOpacity="0.5" />
                          </pattern>
                          <pattern id="tokenGrid" width="60" height="30" patternUnits="userSpaceOnUse">
                            <rect width="60" height="30" fill="url(#tokenSmallGrid)" />
                            <path d="M 60 0 L 0 0 0 30" fill="none" stroke="var(--vscode-editor-lineHighlightBorder)" strokeWidth="1" strokeOpacity="0.8" />
                          </pattern>
                          
                          {/* Gradients for the lines */}
                          <linearGradient id="inputLineGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                            <stop offset="0%" stopColor="var(--vscode-charts-blue)" />
                            <stop offset="100%" stopColor="var(--vscode-charts-blue)" stopOpacity="0.7" />
                          </linearGradient>
                          
                          <linearGradient id="outputLineGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                            <stop offset="0%" stopColor="var(--vscode-charts-green)" />
                            <stop offset="100%" stopColor="var(--vscode-charts-green)" stopOpacity="0.7" />
                          </linearGradient>
                        </defs>
                        
                        {/* Grid background */}
                        <rect width="600" height="120" fill="url(#tokenGrid)" />
                        
                        {/* Main horizontal grid lines */}
                        <line x1="0" y1="0" x2="600" y2="0" stroke="var(--vscode-editor-lineHighlightBorder)" strokeWidth="1" />
                        <line x1="0" y1="30" x2="600" y2="30" stroke="var(--vscode-editor-lineHighlightBorder)" strokeWidth="0.5" />
                        <line x1="0" y1="60" x2="600" y2="60" stroke="var(--vscode-editor-lineHighlightBorder)" strokeWidth="0.5" />
                        <line x1="0" y1="90" x2="600" y2="90" stroke="var(--vscode-editor-lineHighlightBorder)" strokeWidth="0.5" />
                        <line x1="0" y1="120" x2="600" y2="120" stroke="var(--vscode-editor-lineHighlightBorder)" strokeWidth="1" />
                        
                        {/* Input tokens line */}
                        <path
                          d={`
                            M ${metricsData.tokenMetrics.usageByDay.map((day, index) => {
                              const x = (index / (metricsData.tokenMetrics.usageByDay.length - 1)) * 600;
                              const maxTokens = Math.max(...metricsData.tokenMetrics.usageByDay.map(d => d.tokensIn + d.tokensOut), 1);
                              const y = 120 - (day.tokensIn / maxTokens) * 120;
                              return `${index === 0 ? '' : 'L'} ${x},${y}`;
                            }).join(' ')}
                          `}
                          fill="none"
                          stroke="url(#inputLineGradient)"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                        
                        {/* Output tokens line */}
                        <path
                          d={`
                            M ${metricsData.tokenMetrics.usageByDay.map((day, index) => {
                              const x = (index / (metricsData.tokenMetrics.usageByDay.length - 1)) * 600;
                              const maxTokens = Math.max(...metricsData.tokenMetrics.usageByDay.map(d => d.tokensIn + d.tokensOut), 1);
                              const y = 120 - (day.tokensOut / maxTokens) * 120;
                              return `${index === 0 ? '' : 'L'} ${x},${y}`;
                            }).join(' ')}
                          `}
                          fill="none"
                          stroke="url(#outputLineGradient)"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                        
                        {/* Data points for input tokens */}
                        {metricsData.tokenMetrics.usageByDay.map((day, index) => {
                          const x = (index / (metricsData.tokenMetrics.usageByDay.length - 1)) * 600;
                          const maxTokens = Math.max(...metricsData.tokenMetrics.usageByDay.map(d => d.tokensIn + d.tokensOut), 1);
                          const y = 120 - (day.tokensIn / maxTokens) * 120;
                          return (
                            <g key={`in-${day.date}`} className="group">
                              <circle
                                cx={x}
                                cy={y}
                                r="3"
                                fill="var(--vscode-charts-blue)"
                                stroke="var(--vscode-editor-background)"
                                strokeWidth="1"
                                className="cursor-pointer"
                              />
                              <title>{`${new Date(day.date).toLocaleDateString()}: ${day.tokensIn.toLocaleString()} input tokens`}</title>
                            </g>
                          );
                        })}
                        
                        {/* Data points for output tokens */}
                        {metricsData.tokenMetrics.usageByDay.map((day, index) => {
                          const x = (index / (metricsData.tokenMetrics.usageByDay.length - 1)) * 600;
                          const maxTokens = Math.max(...metricsData.tokenMetrics.usageByDay.map(d => d.tokensIn + d.tokensOut), 1);
                          const y = 120 - (day.tokensOut / maxTokens) * 120;
                          return (
                            <g key={`out-${day.date}`} className="group">
                              <circle
                                cx={x}
                                cy={y}
                                r="3"
                                fill="var(--vscode-charts-green)"
                                stroke="var(--vscode-editor-background)"
                                strokeWidth="1"
                                className="cursor-pointer"
                              />
                              <title>{`${new Date(day.date).toLocaleDateString()}: ${day.tokensOut.toLocaleString()} output tokens`}</title>
                            </g>
                          );
                        })}
                        
                        {/* X-axis labels (dates) with better spacing */}
                        {metricsData.tokenMetrics.usageByDay.filter((_, i, arr) => {
                          // Show more labels for better readability
                          const interval = arr.length <= 7 ? 1 : arr.length <= 14 ? 2 : Math.ceil(arr.length / 7);
                          return i === 0 || i === arr.length - 1 || i % interval === 0;
                        }).map((day, _, filteredArray) => {
                          const originalIndex = metricsData.tokenMetrics.usageByDay.findIndex(d => d.date === day.date);
                          const x = (originalIndex / (metricsData.tokenMetrics.usageByDay.length - 1)) * 600;
                          
                          return (
                            <g key={day.date}>
                              {/* Vertical tick mark */}
                              <line 
                                x1={x} 
                                y1="120" 
                                x2={x} 
                                y2="125" 
                                stroke="var(--vscode-editor-lineHighlightBorder)" 
                                strokeWidth="1" 
                              />
                              <text
                                x={x}
                                y="140"
                                fontSize="10"
                                textAnchor={originalIndex === 0 ? "start" : originalIndex === metricsData.tokenMetrics.usageByDay.length - 1 ? "end" : "middle"}
                                fill="var(--vscode-descriptionForeground)"
                                className="font-medium"
                              >
                                {new Date(day.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                              </text>
                            </g>
                          );
                        })}
                        
                        {/* Y-axis labels */}
                        <g>
                          <text x="5" y="125" fontSize="10" textAnchor="start" fill="var(--vscode-descriptionForeground)" className="font-medium">0</text>
                          
                          {/* Max value label */}
                          <text 
                            x="5" 
                            y="15" 
                            fontSize="10" 
                            textAnchor="start" 
                            fill="var(--vscode-descriptionForeground)"
                            className="font-medium"
                          >
                            {Math.max(...metricsData.tokenMetrics.usageByDay.map(d => d.tokensIn + d.tokensOut), 1).toLocaleString()}
                          </text>
                        </g>
                      </svg>
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
                    <div className="w-full h-[150px] relative">
                      {/* Chart container with gradient background */}
                      <div className="absolute inset-0 bg-gradient-to-b from-transparent to-[var(--vscode-editor-background)] opacity-20 rounded-md"></div>
                      
                      <svg width="100%" height="100%" viewBox="0 0 600 150" preserveAspectRatio="none" className="relative z-10">
                        {/* Background grid */}
                        <defs>
                          <pattern id="toolSmallGrid" width="60" height="30" patternUnits="userSpaceOnUse">
                            <path d="M 60 0 L 0 0 0 30" fill="none" stroke="var(--vscode-editor-lineHighlightBorder)" strokeWidth="0.5" strokeOpacity="0.5" />
                          </pattern>
                          <pattern id="toolGrid" width="60" height="30" patternUnits="userSpaceOnUse">
                            <rect width="60" height="30" fill="url(#toolSmallGrid)" />
                            <path d="M 60 0 L 0 0 0 30" fill="none" stroke="var(--vscode-editor-lineHighlightBorder)" strokeWidth="1" strokeOpacity="0.8" />
                          </pattern>
                          
                          {/* Gradient for the bars */}
                          <linearGradient id="toolBarGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                            <stop offset="0%" stopColor="var(--vscode-button-background)" />
                            <stop offset="100%" stopColor="var(--vscode-button-background)" stopOpacity="0.7" />
                          </linearGradient>
                        </defs>
                        
                        {/* Grid background */}
                        <rect width="600" height="120" fill="url(#toolGrid)" />
                        
                        {/* Main horizontal grid lines */}
                        <line x1="0" y1="0" x2="600" y2="0" stroke="var(--vscode-editor-lineHighlightBorder)" strokeWidth="1" />
                        <line x1="0" y1="30" x2="600" y2="30" stroke="var(--vscode-editor-lineHighlightBorder)" strokeWidth="0.5" />
                        <line x1="0" y1="60" x2="600" y2="60" stroke="var(--vscode-editor-lineHighlightBorder)" strokeWidth="0.5" />
                        <line x1="0" y1="90" x2="600" y2="90" stroke="var(--vscode-editor-lineHighlightBorder)" strokeWidth="0.5" />
                        <line x1="0" y1="120" x2="600" y2="120" stroke="var(--vscode-editor-lineHighlightBorder)" strokeWidth="1" />
                        
                        {/* Tool usage bars */}
                        {metricsData.toolMetrics.tools.slice(0, 10).map((tool, index) => {
                          const barWidth = 40;
                          const gap = 20;
                          const totalWidth = (barWidth + gap) * metricsData.toolMetrics.tools.slice(0, 10).length;
                          const startX = (600 - totalWidth) / 2;
                          const x = startX + index * (barWidth + gap);
                          const maxCount = Math.max(...metricsData.toolMetrics.tools.map(t => t.count), 1);
                          const height = (tool.count / maxCount) * 120;
                          const y = 120 - height;
                          
                          return (
                            <g key={tool.name} className="group">
                              {/* Bar */}
                              <rect
                                x={x}
                                y={y}
                                width={barWidth}
                                height={height}
                                rx="2"
                                fill="url(#toolBarGradient)"
                                className="cursor-pointer"
                              />
                              
                              {/* Tool name label */}
                              <text
                                x={x + barWidth / 2}
                                y="135"
                                fontSize="9"
                                textAnchor="middle"
                                fill="var(--vscode-descriptionForeground)"
                                className="font-medium"
                                transform={`rotate(-45, ${x + barWidth / 2}, 135)`}
                              >
                                {tool.name.replace(/_/g, ' ')}
                              </text>
                              
                              {/* Count label on top of bar */}
                              <text
                                x={x + barWidth / 2}
                                y={y - 5}
                                fontSize="10"
                                textAnchor="middle"
                                fill="var(--vscode-descriptionForeground)"
                                className="font-medium"
                              >
                                {tool.count}
                              </text>
                              
                              {/* Enhanced tooltip */}
                              <title>{`${tool.name.replace(/_/g, ' ')}: ${tool.count} uses (${(tool.successRate * 100).toFixed(0)}% success rate)`}</title>
                            </g>
                          );
                        })}
                        
                        {/* Y-axis labels */}
                        <g>
                          <text x="5" y="125" fontSize="10" textAnchor="start" fill="var(--vscode-descriptionForeground)" className="font-medium">0</text>
                          
                          {/* Mid-point label */}
                          <text 
                            x="5" 
                            y="65" 
                            fontSize="10" 
                            textAnchor="start" 
                            fill="var(--vscode-descriptionForeground)"
                            className="font-medium"
                          >
                            {Math.floor(Math.max(...metricsData.toolMetrics.tools.map(t => t.count), 1) / 2)}
                          </text>
                          
                          {/* Max value label */}
                          <text 
                            x="5" 
                            y="15" 
                            fontSize="10" 
                            textAnchor="start" 
                            fill="var(--vscode-descriptionForeground)"
                            className="font-medium"
                          >
                            {Math.max(...metricsData.toolMetrics.tools.map(t => t.count), 1)}
                          </text>
                        </g>
                      </svg>
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

          {/* Leaderboard Section - Only visible when logged in */}
          {statsUser && (
            <>
              <div className="bg-[var(--vscode-editor-background)] p-4 rounded-md">
                <h4 className="mb-3">Leaderboard</h4>
                <div className="bg-[var(--vscode-sideBar-background)] p-4 rounded-md">
                  <div className="mb-2 font-bold">Top Users</div>
                  <div className="space-y-2">
                    {/* This is a placeholder. In a real implementation, you would fetch this data from the API */}
                    <div className="flex justify-between items-center p-2 bg-[var(--vscode-editor-background)] rounded-md">
                      <div className="flex items-center">
                        <div className="w-6 h-6 flex items-center justify-center bg-[var(--vscode-button-background)] rounded-full mr-2">1</div>
                        <div>{statsUser.displayName || statsUser.email || 'You'}</div>
                      </div>
                      <div className="font-bold">1250 pts</div>
                    </div>
                    <div className="flex justify-between items-center p-2 bg-[var(--vscode-editor-background)] rounded-md">
                      <div className="flex items-center">
                        <div className="w-6 h-6 flex items-center justify-center bg-[var(--vscode-button-background)] rounded-full mr-2">2</div>
                        <div>User 2</div>
                      </div>
                      <div className="font-bold">980 pts</div>
                    </div>
                    <div className="flex justify-between items-center p-2 bg-[var(--vscode-editor-background)] rounded-md">
                      <div className="flex items-center">
                        <div className="w-6 h-6 flex items-center justify-center bg-[var(--vscode-button-background)] rounded-full mr-2">3</div>
                        <div>User 3</div>
                      </div>
                      <div className="font-bold">750 pts</div>
                    </div>
                  </div>
                </div>
              </div>
              <VSCodeDivider />
            </>
          )}

          <div className="bg-[var(--vscode-editor-background)] p-4 rounded-md">
            <h4 className="mb-3">Model Usage</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div className="h-[200px] flex items-center justify-center bg-[var(--vscode-sideBar-background)] rounded-md">
                <div className="text-center text-[var(--vscode-descriptionForeground)] w-full p-4">
                  {metricsData.modelMetrics.models.length > 0 ? (
                    <div>
                      <div className="font-bold mb-2">Model usage distribution</div>
                      <div className="w-full h-[150px] relative">
                        {/* Chart container with gradient background */}
                        <div className="absolute inset-0 bg-gradient-to-b from-transparent to-[var(--vscode-editor-background)] opacity-20 rounded-md"></div>
                        
                        <svg width="100%" height="100%" viewBox="0 0 600 150" preserveAspectRatio="none" className="relative z-10">
                          {/* Background grid */}
                          <defs>
                            <pattern id="modelSmallGrid" width="60" height="30" patternUnits="userSpaceOnUse">
                              <path d="M 60 0 L 0 0 0 30" fill="none" stroke="var(--vscode-editor-lineHighlightBorder)" strokeWidth="0.5" strokeOpacity="0.5" />
                            </pattern>
                            <pattern id="modelGrid" width="60" height="30" patternUnits="userSpaceOnUse">
                              <rect width="60" height="30" fill="url(#modelSmallGrid)" />
                              <path d="M 60 0 L 0 0 0 30" fill="none" stroke="var(--vscode-editor-lineHighlightBorder)" strokeWidth="1" strokeOpacity="0.8" />
                            </pattern>
                            
                            {/* Gradient for the bars */}
                            <linearGradient id="modelBarGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                              <stop offset="0%" stopColor="var(--vscode-charts-purple)" />
                              <stop offset="100%" stopColor="var(--vscode-charts-purple)" stopOpacity="0.7" />
                            </linearGradient>
                          </defs>
                          
                          {/* Grid background */}
                          <rect width="600" height="120" fill="url(#modelGrid)" />
                          
                          {/* Main horizontal grid lines */}
                          <line x1="0" y1="0" x2="600" y2="0" stroke="var(--vscode-editor-lineHighlightBorder)" strokeWidth="1" />
                          <line x1="0" y1="30" x2="600" y2="30" stroke="var(--vscode-editor-lineHighlightBorder)" strokeWidth="0.5" />
                          <line x1="0" y1="60" x2="600" y2="60" stroke="var(--vscode-editor-lineHighlightBorder)" strokeWidth="0.5" />
                          <line x1="0" y1="90" x2="600" y2="90" stroke="var(--vscode-editor-lineHighlightBorder)" strokeWidth="0.5" />
                          <line x1="0" y1="120" x2="600" y2="120" stroke="var(--vscode-editor-lineHighlightBorder)" strokeWidth="1" />
                          
                          {/* Model usage bars */}
                          {metricsData.modelMetrics.models.slice(0, 5).map((model, index) => {
                            const barWidth = 80;
                            const gap = 20;
                            const totalWidth = (barWidth + gap) * metricsData.modelMetrics.models.slice(0, 5).length;
                            const startX = (600 - totalWidth) / 2;
                            const x = startX + index * (barWidth + gap);
                            const maxCount = Math.max(...metricsData.modelMetrics.models.map(m => m.count), 1);
                            const height = (model.count / maxCount) * 120;
                            const y = 120 - height;
                            
                            return (
                              <g key={model.name} className="group">
                                {/* Bar */}
                                <rect
                                  x={x}
                                  y={y}
                                  width={barWidth}
                                  height={height}
                                  rx="2"
                                  fill="url(#modelBarGradient)"
                                  className="cursor-pointer"
                                />
                                
                                {/* Model name label */}
                                <text
                                  x={x + barWidth / 2}
                                  y="135"
                                  fontSize="9"
                                  textAnchor="middle"
                                  fill="var(--vscode-descriptionForeground)"
                                  className="font-medium"
                                  transform={`rotate(-45, ${x + barWidth / 2}, 135)`}
                                >
                                  {model.name.split('/').pop()}
                                </text>
                                
                                {/* Count label on top of bar */}
                                <text
                                  x={x + barWidth / 2}
                                  y={y - 5}
                                  fontSize="10"
                                  textAnchor="middle"
                                  fill="var(--vscode-descriptionForeground)"
                                  className="font-medium"
                                >
                                  {model.count}
                                </text>
                                
                                {/* Enhanced tooltip */}
                                <title>{`${model.name}: ${model.count} uses`}</title>
                              </g>
                            );
                          })}
                          
                          {/* Y-axis labels */}
                          <g>
                            <text x="5" y="125" fontSize="10" textAnchor="start" fill="var(--vscode-descriptionForeground)" className="font-medium">0</text>
                            
                            {/* Mid-point label */}
                            <text 
                              x="5" 
                              y="65" 
                              fontSize="10" 
                              textAnchor="start" 
                              fill="var(--vscode-descriptionForeground)"
                              className="font-medium"
                            >
                              {Math.floor(Math.max(...metricsData.modelMetrics.models.map(m => m.count), 1) / 2)}
                            </text>
                            
                            {/* Max value label */}
                            <text 
                              x="5" 
                              y="15" 
                              fontSize="10" 
                              textAnchor="start" 
                              fill="var(--vscode-descriptionForeground)"
                              className="font-medium"
                            >
                              {Math.max(...metricsData.modelMetrics.models.map(m => m.count), 1)}
                            </text>
                          </g>
                        </svg>
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
