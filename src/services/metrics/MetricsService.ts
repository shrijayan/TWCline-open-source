import * as vscode from "vscode"
import * as path from "path"
import * as fs from "fs/promises"
import { HistoryItem } from "@shared/HistoryItem"
import { ClineMessage } from "@shared/ExtensionMessage"
import { getAllExtensionState, getGlobalState, updateGlobalState } from "@core/storage/state"
import { telemetryService } from "@services/posthog/telemetry/TelemetryService"
import { MetricsData, RawMetricsData, TaskMetrics, TokenMetrics, ToolMetrics, ModelMetrics } from "@shared/metrics"
import { fileExistsAtPath } from "@utils/fs"

export class MetricsService {
  private static instance: MetricsService
  private context: vscode.ExtensionContext
  private aggregationInterval: NodeJS.Timeout | null = null
  private outputChannel: vscode.OutputChannel
  
  private constructor(context: vscode.ExtensionContext) {
    this.context = context
    this.outputChannel = vscode.window.createOutputChannel("Cline Metrics")
  }
  
  public static getInstance(context: vscode.ExtensionContext): MetricsService {
    if (!MetricsService.instance) {
      MetricsService.instance = new MetricsService(context)
    }
    return MetricsService.instance
  }
  
  // Track if metrics are currently being calculated
  private isCalculating = false
  // Track the last time metrics were calculated
  private lastCalculationTime = 0
  
  // Get metrics data, calculating if needed
  public async getMetrics(forceRecalculate: boolean = false): Promise<MetricsData> {
    // If we're already calculating metrics, return the cached metrics
    if (this.isCalculating) {
      const cachedMetrics = await getGlobalState(this.context, "metricsData") as MetricsData | undefined
      return cachedMetrics || this.getEmptyMetrics()
    }
    
    // Check if we've calculated metrics recently (within the last 5 seconds)
    const now = Date.now()
    const timeSinceLastCalculation = now - this.lastCalculationTime
    if (timeSinceLastCalculation < 5000 && !forceRecalculate) {
      const cachedMetrics = await getGlobalState(this.context, "metricsData") as MetricsData | undefined
      return cachedMetrics || this.getEmptyMetrics()
    }
    
    const cachedMetrics = await getGlobalState(this.context, "metricsData") as MetricsData | undefined
    
    // If we have cached metrics and don't need to recalculate, return them
    if (cachedMetrics && !forceRecalculate) {
      return cachedMetrics
    }
    
    try {
      // Set the flag to indicate we're calculating metrics
      this.isCalculating = true
      
      // Clear the output channel before starting a new calculation
      this.outputChannel.clear()
      this.outputChannel.appendLine("Starting metrics calculation...")
      
      // Calculate metrics
      const rawData = await this.collectRawMetricsData()
      const metrics = this.calculateMetrics(rawData)
      
      // Cache the calculated metrics
      await updateGlobalState(this.context, "metricsData", metrics)
      
      // Output a summary of the metrics
      this.outputMetricsSummary(metrics, rawData)
      
      // Update the last calculation time
      this.lastCalculationTime = Date.now()
      
      return metrics
    } finally {
      // Reset the flag when we're done
      this.isCalculating = false
    }
  }
  
  // Get empty metrics data (for when no metrics are available)
  private getEmptyMetrics(): MetricsData {
    return {
      lastUpdated: Date.now(),
      taskMetrics: {
        totalTasks: 0,
        completedTasks: 0,
        averageCompletionTime: 0,
        tasksPerDay: []
      },
      tokenMetrics: {
        totalTokensIn: 0,
        totalTokensOut: 0,
        totalCost: 0,
        usageByDay: []
      },
      toolMetrics: {
        tools: []
      },
      modelMetrics: {
        models: [],
        modeUsage: {
          plan: 0,
          act: 0
        }
      }
    }
  }
  
  // Output a summary of the metrics to the output channel
  private outputMetricsSummary(metrics: MetricsData, rawData: RawMetricsData): void {
    this.outputChannel.appendLine("\n\n=== METRICS SUMMARY ===")
    
    // Task metrics
    this.outputChannel.appendLine(`\nTASK METRICS:`)
    this.outputChannel.appendLine(`Total Tasks: ${metrics.taskMetrics.totalTasks}`)
    this.outputChannel.appendLine(`Completed Tasks: ${metrics.taskMetrics.completedTasks}`)
    this.outputChannel.appendLine(`Completion Rate: ${metrics.taskMetrics.totalTasks > 0 ? 
      ((metrics.taskMetrics.completedTasks / metrics.taskMetrics.totalTasks) * 100).toFixed(2) : 0}%`)
    this.outputChannel.appendLine(`Average Completion Time: ${
      (metrics.taskMetrics.averageCompletionTime / 1000 / 60).toFixed(2)} minutes`)
    
    // List all tasks and their completion status
    this.outputChannel.appendLine("\nTASK COMPLETION STATUS:")
    for (const task of rawData.tasks) {
      const completionStatus = task.completed ? "COMPLETED" : "INCOMPLETE"
      const model = task.model || "unknown"
      const mode = task.mode || "unknown"
      this.outputChannel.appendLine(`Task ${task.id}: ${completionStatus} (Model: ${model}, Mode: ${mode})`)
    }
    
    // Token metrics
    this.outputChannel.appendLine(`\nTOKEN METRICS:`)
    this.outputChannel.appendLine(`Total Input Tokens: ${metrics.tokenMetrics.totalTokensIn.toLocaleString()}`)
    this.outputChannel.appendLine(`Total Output Tokens: ${metrics.tokenMetrics.totalTokensOut.toLocaleString()}`)
    this.outputChannel.appendLine(`Total Cost: $${metrics.tokenMetrics.totalCost.toFixed(2)}`)
    
    // Tool metrics
    this.outputChannel.appendLine(`\nTOP TOOL USAGE:`)
    for (const tool of metrics.toolMetrics.tools.slice(0, 10)) {
      this.outputChannel.appendLine(`${tool.name}: ${tool.count} uses (${(tool.successRate * 100).toFixed(2)}% success)`)
    }
    
    // Model metrics
    this.outputChannel.appendLine(`\nMODEL USAGE:`)
    for (const model of metrics.modelMetrics.models.slice(0, 5)) {
      this.outputChannel.appendLine(`${model.name}: ${model.count} uses`)
    }
    
    this.outputChannel.appendLine(`\nMODE USAGE:`)
    this.outputChannel.appendLine(`Plan Mode: ${metrics.modelMetrics.modeUsage.plan} uses`)
    this.outputChannel.appendLine(`Act Mode: ${metrics.modelMetrics.modeUsage.act} uses`)
    
    this.outputChannel.appendLine("\n=== END OF METRICS SUMMARY ===\n")
  }
  
  // Get metrics for a specific date range
  public async getMetricsForDateRange(
    range: "7d" | "30d" | "all" = "7d",
    forceRecalculate: boolean = false
  ): Promise<MetricsData> {
    // Get all metrics first
    const allMetrics = await this.getMetrics(forceRecalculate)
    
    // If "all" is selected, return all metrics
    if (range === "all") {
      return allMetrics
    }
    
    // Otherwise, filter by date range
    const now = new Date()
    const daysToSubtract = range === "7d" ? 7 : 30
    const cutoffDate = new Date(now)
    cutoffDate.setDate(cutoffDate.getDate() - daysToSubtract)
    const cutoffTimestamp = cutoffDate.getTime()
    
    // Filter task metrics
    const filteredTasksPerDay = allMetrics.taskMetrics.tasksPerDay.filter(item => {
      const itemDate = new Date(item.date)
      return itemDate.getTime() >= cutoffTimestamp
    })
    
    // Filter token metrics
    const filteredUsageByDay = allMetrics.tokenMetrics.usageByDay.filter(item => {
      const itemDate = new Date(item.date)
      return itemDate.getTime() >= cutoffTimestamp
    })
    
    // Calculate new totals based on filtered data
    const totalTokensIn = filteredUsageByDay.reduce((sum, item) => sum + item.tokensIn, 0)
    const totalTokensOut = filteredUsageByDay.reduce((sum, item) => sum + item.tokensOut, 0)
    const totalCost = filteredUsageByDay.reduce((sum, item) => sum + item.cost, 0)
    
    // Return filtered metrics
    return {
      ...allMetrics,
      taskMetrics: {
        ...allMetrics.taskMetrics,
        tasksPerDay: filteredTasksPerDay,
      },
      tokenMetrics: {
        ...allMetrics.tokenMetrics,
        totalTokensIn,
        totalTokensOut,
        totalCost,
        usageByDay: filteredUsageByDay,
      },
    }
  }
  
  // Start a background aggregation process
  public startAggregation(): void {
    // Clear any existing interval
    if (this.aggregationInterval) {
      clearInterval(this.aggregationInterval)
    }
    
    // Set up a new interval to aggregate metrics every hour
    this.aggregationInterval = setInterval(async () => {
      try {
        await this.getMetrics(true) // Force recalculation
      } catch (error) {
        console.error("Error in scheduled metrics aggregation:", error)
      }
    }, 60 * 60 * 1000) // 1 hour
  }
  
  // Stop the background aggregation process
  public stopAggregation(): void {
    if (this.aggregationInterval) {
      clearInterval(this.aggregationInterval)
      this.aggregationInterval = null
    }
  }
  
  // Collect raw data from task history and telemetry
  private async collectRawMetricsData(): Promise<RawMetricsData> {
    const { taskHistory } = await getAllExtensionState(this.context)
    
    const rawData: RawMetricsData = {
      tasks: [],
      tokenUsage: [],
      toolUsage: [],
      modeSwitches: []
    }
    
    // Process task history
    if (taskHistory) {
      for (const task of taskHistory) {
        // Add basic task data
        // Note: HistoryItem doesn't have completedTs, model, or lastMode properties
        // We'll use what's available and extract the rest from messages
        rawData.tasks.push({
          id: task.id,
          startTime: task.ts,
          completed: false, // Will be updated if we find completion info in messages
          // We'll try to extract model and mode from messages
        })
        
        // Load task messages to extract more detailed metrics
        try {
          const taskMessages = await this.loadTaskMessages(task.id)
          if (taskMessages) {
            this.extractMetricsFromMessages(taskMessages, task.id, rawData)
          }
        } catch (error) {
          console.error(`Error loading messages for task ${task.id}:`, error)
        }
      }
    }
    
    return rawData
  }
  
  // Load messages for a specific task
  private async loadTaskMessages(taskId: string): Promise<ClineMessage[] | undefined> {
    try {
      const taskDirPath = path.join(this.context.globalStorageUri.fsPath, "tasks", taskId)
      this.outputChannel.appendLine(`Looking for task messages in: ${taskDirPath}`)
      
      const uiMessagesFilePath = path.join(taskDirPath, "cline_messages.json")
      
      if (await fileExistsAtPath(uiMessagesFilePath)) {
        this.outputChannel.appendLine(`Found messages file: ${uiMessagesFilePath}`)
        
        try {
          const messagesJson = await fs.readFile(uiMessagesFilePath, "utf8")
          this.outputChannel.appendLine(`Read ${messagesJson.length} bytes from file`)
          
          try {
            const messages = JSON.parse(messagesJson)
            this.outputChannel.appendLine(`Loaded ${messages.length} messages for task ${taskId}`)
            
            // Debug: Log message types and counts
            const messageTypes = new Map<string, number>()
            for (const message of messages) {
              const type = `${message.type}:${message.say || message.ask || "other"}`
              messageTypes.set(type, (messageTypes.get(type) || 0) + 1)
            }
            
            this.outputChannel.appendLine(`Message types in task ${taskId}:`)
            for (const [type, count] of messageTypes.entries()) {
              this.outputChannel.appendLine(`  ${type}: ${count}`)
            }
            
            // Debug: Log completion_result messages
            const completionMessages = messages.filter(
              (m: ClineMessage) => 
                (m.type === "say" && m.say === "completion_result") || 
                (m.type === "ask" && m.ask === "completion_result")
            )
            this.outputChannel.appendLine(`Found ${completionMessages.length} completion_result messages for task ${taskId}`)
            
            // Debug: Log tool messages
            const toolMessages = messages.filter(
              (m: ClineMessage) => m.type === "say" && m.say === "tool"
            )
            this.outputChannel.appendLine(`Found ${toolMessages.length} tool messages for task ${taskId}`)
            
            // Debug: Log api_req_finished messages
            const apiReqFinishedMessages = messages.filter(
              (m: ClineMessage) => m.type === "say" && m.say === "api_req_finished"
            )
            this.outputChannel.appendLine(`Found ${apiReqFinishedMessages.length} api_req_finished messages for task ${taskId}`)
            
            return messages
          } catch (parseError) {
            this.outputChannel.appendLine(`Error parsing messages JSON for task ${taskId}: ${parseError}`)
            console.error(`Error parsing messages JSON for task ${taskId}:`, parseError)
            return undefined
          }
        } catch (readError) {
          this.outputChannel.appendLine(`Error reading messages file for task ${taskId}: ${readError}`)
          console.error(`Error reading messages file for task ${taskId}:`, readError)
          return undefined
        }
      } else {
        this.outputChannel.appendLine(`Messages file not found for task ${taskId}`)
      }
      return undefined
    } catch (error) {
      this.outputChannel.appendLine(`Error loading messages for task ${taskId}: ${error}`)
      console.error(`Error loading messages for task ${taskId}:`, error)
      return undefined
    }
  }
  
  // Extract metrics from task messages
  private extractMetricsFromMessages(messages: ClineMessage[], taskId: string, rawData: RawMetricsData): void {
    // Find the task in rawData
    const taskIndex = rawData.tasks.findIndex(task => task.id === taskId);
    if (taskIndex === -1) {
      return;
    }
    
    // Track the last message timestamp to use as endTime if needed
    let lastMessageTs = 0;
    let lastModel = "";
    let lastMode = "";
    let completionDetected = false;
    
    this.outputChannel.appendLine(`\n--- Processing ${messages.length} messages for task ${taskId} ---`);
    this.outputChannel.show(true); // Show the output channel but don't focus it
    
    for (const message of messages) {
      // Update last message timestamp
      if (message.ts > lastMessageTs) {
        lastMessageTs = message.ts;
      }
      
      // Extract token usage
      if (message.type === "say" && message.say === "api_req_finished" && message.text) {
        try {
          const apiReqInfo = JSON.parse(message.text)
          if (apiReqInfo.tokensIn && apiReqInfo.tokensOut) {
            // Update the model for the task if available
            if (apiReqInfo.model && apiReqInfo.model !== "unknown") {
              lastModel = apiReqInfo.model;
              rawData.tasks[taskIndex].model = apiReqInfo.model;
            }
            
            rawData.tokenUsage.push({
              taskId,
              tokensIn: apiReqInfo.tokensIn,
              tokensOut: apiReqInfo.tokensOut,
              model: apiReqInfo.model || "unknown",
              timestamp: message.ts,
              cost: apiReqInfo.cost
            })
            
            this.outputChannel.appendLine(`Recorded token usage for task ${taskId}: ${apiReqInfo.tokensIn} in, ${apiReqInfo.tokensOut} out`);
          }
        } catch (error) {
          console.error("Error parsing API request info:", error)
        }
      }
      
      // Extract tool usage
      if (message.type === "say" && message.say === "tool" && message.text) {
        try {
          const toolInfo = JSON.parse(message.text)
          const toolName = toolInfo.tool || "unknown";
          
          rawData.toolUsage.push({
            taskId,
            tool: toolName,
            success: toolInfo.success !== false, // Default to true if not specified
            timestamp: message.ts
          })
          
          this.outputChannel.appendLine(`Recorded tool usage for task ${taskId}: ${toolName}`);
          
          // Check if this is a completion tool (attempt_completion)
          // Some tools might indicate task completion
          if (toolName === "completion_result" || 
              (message.text && message.text.includes("attempt_completion"))) {
            rawData.tasks[taskIndex].completed = true;
            completionDetected = true;
            this.outputChannel.appendLine(`Task ${taskId} marked as completed via tool usage`);
          }
        } catch (error) {
          console.error("Error parsing tool info:", error)
        }
      }
      
      // Extract mode switches
      if (message.type === "say" && message.text && message.text.includes("Switching to")) {
        const mode = message.text.includes("Switching to Act mode") ? "act" : "plan";
        lastMode = mode;
        rawData.tasks[taskIndex].mode = mode as "act" | "plan";
        
        rawData.modeSwitches.push({
          taskId,
          mode: mode as "act" | "plan",
          timestamp: message.ts
        })
        
        this.outputChannel.appendLine(`Recorded mode switch for task ${taskId}: ${mode}`);
      }
      
      // Check for task completion
      if (message.type === "say" && message.say === "completion_result") {
        rawData.tasks[taskIndex].completed = true;
        completionDetected = true;
        this.outputChannel.appendLine(`Task ${taskId} marked as completed via say:completion_result`);
      }
      
      // Also check for completion_result in ask type (for user responses to completion)
      if (message.type === "ask" && message.ask === "completion_result") {
        rawData.tasks[taskIndex].completed = true;
        completionDetected = true;
        this.outputChannel.appendLine(`Task ${taskId} marked as completed via ask:completion_result`);
      }
      
      // Additional completion detection: Check for user feedback after a task
      // This often indicates the task was completed and the user is providing feedback
      if (message.type === "say" && message.say === "user_feedback" && 
          messages.findIndex(m => m === message) > 0) {
        // Only mark as completed if it's not the first message (which could be initial feedback)
        rawData.tasks[taskIndex].completed = true;
        completionDetected = true;
        this.outputChannel.appendLine(`Task ${taskId} marked as completed via user_feedback`);
      }
      
      // Check for checkpoint creation, which often happens at task completion
      if (message.type === "say" && message.say === "checkpoint_created" && 
          message.lastCheckpointHash) {
        // If this is the last checkpoint in the task, it likely indicates completion
        const messageIndex = messages.findIndex(m => m === message);
        if (messageIndex > messages.length - 5) { // If it's one of the last few messages
          rawData.tasks[taskIndex].completed = true;
          completionDetected = true;
          this.outputChannel.appendLine(`Task ${taskId} marked as completed via checkpoint_created`);
        }
      }
    }
    
    // If the task has a significant number of messages but no completion was detected,
    // it might be a completed task that didn't use the standard completion mechanism
    if (!completionDetected && messages.length > 10) {
      // Check if the last few messages indicate a natural conclusion
      const lastFewMessages = messages.slice(-5);
      
      // Check if there's a user_feedback message near the end
      const hasFeedbackNearEnd = lastFewMessages.some(m => 
        m.type === "say" && m.say === "user_feedback"
      );
      
      // Check if there's a significant gap between the last message and now
      const lastMessageTime = lastFewMessages[lastFewMessages.length - 1]?.ts || 0;
      const timeGap = Date.now() - lastMessageTime;
      const isOldTask = timeGap > 24 * 60 * 60 * 1000; // More than a day old
      
      if (hasFeedbackNearEnd || isOldTask) {
        rawData.tasks[taskIndex].completed = true;
        this.outputChannel.appendLine(`Task ${taskId} marked as completed via heuristic detection`);
      }
    }
    
    // Set the endTime to the last message timestamp
    if (lastMessageTs > 0) {
      rawData.tasks[taskIndex].endTime = lastMessageTs;
    }
    
    // Set the model and mode if they were found
    if (lastModel) {
      rawData.tasks[taskIndex].model = lastModel;
    }
    
    if (lastMode) {
      rawData.tasks[taskIndex].mode = lastMode as "act" | "plan";
    } else {
      // Default to "act" mode if no mode was found
      rawData.tasks[taskIndex].mode = "act";
    }
  }
  
  // Calculate metrics from raw data
  private calculateMetrics(rawData: RawMetricsData): MetricsData {
    // Calculate task metrics
    const taskMetrics = this.calculateTaskMetrics(rawData)
    
    // Calculate token metrics
    const tokenMetrics = this.calculateTokenMetrics(rawData)
    
    // Calculate tool metrics
    const toolMetrics = this.calculateToolMetrics(rawData)
    
    // Calculate model metrics
    const modelMetrics = this.calculateModelMetrics(rawData)
    
    return {
      lastUpdated: Date.now(),
      taskMetrics,
      tokenMetrics,
      toolMetrics,
      modelMetrics
    }
  }
  
  // Calculate task metrics
  private calculateTaskMetrics(rawData: RawMetricsData): TaskMetrics {
    const totalTasks = rawData.tasks.length
    const completedTasks = rawData.tasks.filter(task => task.completed).length
    
    // Calculate average completion time
    let totalCompletionTime = 0
    let completedTasksWithTime = 0
    
    for (const task of rawData.tasks) {
      if (task.completed && task.startTime && task.endTime) {
        totalCompletionTime += (task.endTime - task.startTime)
        completedTasksWithTime++
      }
    }
    
    const averageCompletionTime = completedTasksWithTime > 0 
      ? totalCompletionTime / completedTasksWithTime 
      : 0
    
    // Calculate tasks per day
    const tasksByDay = new Map<string, number>()
    const now = new Date()
    
    // First, collect all unique dates from task history
    const allDates = new Set<string>()
    
    // Add the last 30 days to ensure we have recent dates even if no tasks
    for (let i = 29; i >= 0; i--) {
      const date = new Date(now)
      date.setDate(date.getDate() - i)
      const dateString = date.toISOString().split('T')[0]
      allDates.add(dateString)
    }
    
    // Add all dates from task history
    for (const task of rawData.tasks) {
      if (task.startTime) {
        const date = new Date(task.startTime)
        const dateString = date.toISOString().split('T')[0]
        allDates.add(dateString)
      }
    }
    
    // Initialize the map with all dates
    const sortedDates = Array.from(allDates).sort()
    for (const dateString of sortedDates) {
      tasksByDay.set(dateString, 0)
    }
    
    // Count tasks by day
    for (const task of rawData.tasks) {
      if (task.startTime) {
        const date = new Date(task.startTime)
        const dateString = date.toISOString().split('T')[0]
        tasksByDay.set(dateString, (tasksByDay.get(dateString) || 0) + 1)
      }
    }
    
    // Log all dates and counts for debugging
    this.outputChannel.appendLine("\nTASKS PER DAY:")
    for (const [date, count] of tasksByDay.entries()) {
      this.outputChannel.appendLine(`${date}: ${count} tasks`)
    }
    
    const tasksPerDay = Array.from(tasksByDay.entries()).map(([date, count]) => ({
      date,
      count
    }))
    
    return {
      totalTasks,
      completedTasks,
      averageCompletionTime,
      tasksPerDay
    }
  }
  
  // Calculate token metrics
  private calculateTokenMetrics(rawData: RawMetricsData): TokenMetrics {
    let totalTokensIn = 0
    let totalTokensOut = 0
    let totalCost = 0
    
    // Calculate totals
    for (const usage of rawData.tokenUsage) {
      totalTokensIn += usage.tokensIn
      totalTokensOut += usage.tokensOut
      totalCost += usage.cost || 0
    }
    
    // Calculate usage by day
    const usageByDay = new Map<string, { tokensIn: number; tokensOut: number; cost: number }>()
    const now = new Date()
    
    // First, collect all unique dates from token usage
    const allDates = new Set<string>()
    
    // Add the last 30 days to ensure we have recent dates even if no token usage
    for (let i = 29; i >= 0; i--) {
      const date = new Date(now)
      date.setDate(date.getDate() - i)
      const dateString = date.toISOString().split('T')[0]
      allDates.add(dateString)
    }
    
    // Add all dates from token usage
    for (const usage of rawData.tokenUsage) {
      if (usage.timestamp) {
        const date = new Date(usage.timestamp)
        const dateString = date.toISOString().split('T')[0]
        allDates.add(dateString)
      }
    }
    
    // Initialize the map with all dates
    const sortedDates = Array.from(allDates).sort()
    for (const dateString of sortedDates) {
      usageByDay.set(dateString, { tokensIn: 0, tokensOut: 0, cost: 0 })
    }
    
    // Aggregate usage by day
    for (const usage of rawData.tokenUsage) {
      if (usage.timestamp) {
        const date = new Date(usage.timestamp)
        const dateString = date.toISOString().split('T')[0]
        
        const current = usageByDay.get(dateString)!
        usageByDay.set(dateString, {
          tokensIn: current.tokensIn + usage.tokensIn,
          tokensOut: current.tokensOut + usage.tokensOut,
          cost: current.cost + (usage.cost || 0)
        })
      }
    }
    
    // Log token usage by day for debugging
    this.outputChannel.appendLine("\nTOKEN USAGE PER DAY:")
    for (const [date, usage] of usageByDay.entries()) {
      this.outputChannel.appendLine(`${date}: ${usage.tokensIn} in, ${usage.tokensOut} out, $${usage.cost.toFixed(2)} cost`)
    }
    
    const usageByDayArray = Array.from(usageByDay.entries()).map(([date, usage]) => ({
      date,
      tokensIn: usage.tokensIn,
      tokensOut: usage.tokensOut,
      cost: usage.cost
    }))
    
    return {
      totalTokensIn,
      totalTokensOut,
      totalCost,
      usageByDay: usageByDayArray
    }
  }
  
  // Calculate tool metrics
  private calculateToolMetrics(rawData: RawMetricsData): ToolMetrics {
    const toolUsageMap = new Map<string, { count: number; successes: number }>()
    
    // Count tool usage and successes
    for (const usage of rawData.toolUsage) {
      if (!toolUsageMap.has(usage.tool)) {
        toolUsageMap.set(usage.tool, { count: 0, successes: 0 })
      }
      
      const current = toolUsageMap.get(usage.tool)!
      current.count++
      if (usage.success) {
        current.successes++
      }
      toolUsageMap.set(usage.tool, current)
    }
    
    // Convert to array and calculate success rates
    const tools = Array.from(toolUsageMap.entries())
      .map(([name, { count, successes }]) => ({
        name,
        count,
        successRate: count > 0 ? successes / count : 0
      }))
      .sort((a, b) => b.count - a.count) // Sort by count descending
    
    return { tools }
  }
  
  // Calculate model metrics
  private calculateModelMetrics(rawData: RawMetricsData): ModelMetrics {
    const modelUsageMap = new Map<string, number>()
    let planModeCount = 0
    let actModeCount = 0
    
    // Count model usage
    for (const task of rawData.tasks) {
      if (task.model) {
        const modelName = task.model
        modelUsageMap.set(modelName, (modelUsageMap.get(modelName) || 0) + 1)
      }
      
      // Count mode usage
      if (task.mode === "plan") {
        planModeCount++
      } else if (task.mode === "act") {
        actModeCount++
      }
    }
    
    // Also check mode switches
    for (const modeSwitch of rawData.modeSwitches) {
      if (modeSwitch.mode === "plan") {
        planModeCount++
      } else if (modeSwitch.mode === "act") {
        actModeCount++
      }
    }
    
    // Convert to array
    const models = Array.from(modelUsageMap.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count) // Sort by count descending
    
    return {
      models,
      modeUsage: { plan: planModeCount, act: actModeCount }
    }
  }
}
