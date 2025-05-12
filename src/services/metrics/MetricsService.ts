import * as vscode from "vscode"
import * as path from "path"
import * as fs from "fs/promises"
import { HistoryItem } from "@shared/HistoryItem"
import { ClineMessage } from "@shared/ExtensionMessage"
import { getAllExtensionState, getGlobalState, updateGlobalState } from "@core/storage/state"
import { telemetryService } from "@services/posthog/telemetry/TelemetryService"
import { MetricsData, RawMetricsData, TaskMetrics, TokenMetrics, ToolMetrics, ModelMetrics, MetricsCache, TaskMetadataIndex } from "@shared/metrics"
import { fileExistsAtPath } from "@utils/fs"

export class MetricsService {
  private static instance: MetricsService
  private context: vscode.ExtensionContext
  private aggregationInterval: NodeJS.Timeout | null = null
  private outputChannel: vscode.OutputChannel
  
  // Memory cache for frequently accessed data
  private memoryCache: {
    taskMessages: Map<string, ClineMessage[]>;
    processedTaskData: Map<string, any>;
  } = {
    taskMessages: new Map(),
    processedTaskData: new Map()
  };
  
  // Track background update promise
  private backgroundUpdatePromise: Promise<void> | null = null;
  
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
    
    // Get cached metrics and metadata
    const cachedMetrics = await getGlobalState(this.context, "metricsData") as MetricsData | undefined
    const metricsCache = await getGlobalState(this.context, "metricsCache") as MetricsCache | undefined
    
    // Fast path: Return cached metrics if available and not forcing recalculation
    // Also check if we've calculated metrics recently (within the last 5 seconds)
    const now = Date.now()
    const timeSinceLastCalculation = now - this.lastCalculationTime
    if (cachedMetrics && !forceRecalculate && timeSinceLastCalculation < 5000) {
      // Start background update if needed, but return cached data immediately
      this.checkForUpdatesInBackground(metricsCache)
      return cachedMetrics
    }
    
    try {
      // Set the flag to indicate we're calculating metrics
      this.isCalculating = true
      
      // Clear the output channel before starting a new calculation
      this.outputChannel.clear()
      this.outputChannel.appendLine("Starting metrics calculation...")
      
      // Get task history
      const { taskHistory } = await getAllExtensionState(this.context)
      
      if (!taskHistory || taskHistory.length === 0) {
        return this.getEmptyMetrics()
      }
      
      // If we have cached metrics and metadata, do incremental update
      if (cachedMetrics && metricsCache && !forceRecalculate) {
        this.outputChannel.appendLine("Performing incremental metrics update...")
        const metrics = await this.calculateIncrementalMetrics(taskHistory, metricsCache)
        await this.saveMetricsAndCache(metrics, metricsCache)
        return metrics
      }
      
      // Otherwise do full calculation (but optimized)
      this.outputChannel.appendLine("Performing full metrics calculation...")
      const rawData = await this.collectRawMetricsData()
      const metrics = this.calculateMetrics(rawData)
      
      // Create and save new cache
      const newCache: MetricsCache = {
        lastCalculationTime: Date.now(),
        taskMetadataIndex: this.buildTaskMetadataIndex(taskHistory, rawData),
        rawData,
        processedMetrics: metrics
      }
      
      await this.saveMetricsAndCache(metrics, newCache)
      
      // Output a summary of the metrics
      this.outputMetricsSummary(metrics, rawData)
      
      return metrics
    } finally {
      // Reset the flag when we're done
      this.isCalculating = false
    }
  }
  
  // Check for updates in the background
  private async checkForUpdatesInBackground(metricsCache: MetricsCache | undefined): Promise<void> {
    // Don't start a new background update if one is already running
    if (this.backgroundUpdatePromise) {
      return
    }
    
    // If no cache exists, we can't do an incremental update
    if (!metricsCache) {
      return
    }
    
    // Start background update
    this.backgroundUpdatePromise = (async () => {
      try {
        const { taskHistory } = await getAllExtensionState(this.context)
        
        if (!taskHistory || taskHistory.length === 0) {
          return
        }
        
        // Check if any tasks have been modified since last calculation
        const needsUpdate = this.checkIfUpdateNeeded(taskHistory, metricsCache)
        
        if (needsUpdate) {
          this.outputChannel.appendLine("Background update: Changes detected, updating metrics...")
          // Do incremental update in background
          const metrics = await this.calculateIncrementalMetrics(taskHistory, metricsCache)
          
          // Update the cache with new data
          const updatedCache: MetricsCache = {
            lastCalculationTime: Date.now(),
            taskMetadataIndex: this.buildTaskMetadataIndex(taskHistory, metricsCache.rawData),
            rawData: metricsCache.rawData,
            processedMetrics: metrics
          }
          
          await this.saveMetricsAndCache(metrics, updatedCache)
        }
      } catch (error) {
        console.error("Error in background metrics update:", error)
      } finally {
        this.backgroundUpdatePromise = null
      }
    })()
  }
  
  // Check if metrics need to be updated
  private checkIfUpdateNeeded(taskHistory: HistoryItem[], metricsCache: MetricsCache): boolean {
    // Check if any tasks have been added or removed
    const cachedTaskIds = Object.keys(metricsCache.taskMetadataIndex)
    const currentTaskIds = taskHistory.map(task => task.id)
    
    // If task count has changed, update is needed
    if (cachedTaskIds.length !== currentTaskIds.length) {
      this.outputChannel.appendLine("Background update: Task count changed, update needed")
      return true
    }
    
    // Check if any tasks have been modified since last calculation
    for (const task of taskHistory) {
      const cachedMetadata = metricsCache.taskMetadataIndex[task.id]
      
      // If task is not in cache or has been modified, update is needed
      if (!cachedMetadata || task.ts > cachedMetadata.lastModified) {
        this.outputChannel.appendLine(`Background update: Task ${task.id} modified, update needed`)
        return true
      }
    }
    
    this.outputChannel.appendLine("Background update: No changes detected, no update needed")
    return false
  }
  
  // Calculate metrics incrementally
  private async calculateIncrementalMetrics(
    taskHistory: HistoryItem[],
    metricsCache: MetricsCache
  ): Promise<MetricsData> {
    // Start with existing raw data (make a deep copy to avoid modifying the original)
    const rawData: RawMetricsData = JSON.parse(JSON.stringify(metricsCache.rawData))
    
    // Get sets of task IDs
    const cachedTaskIds = new Set(Object.keys(metricsCache.taskMetadataIndex))
    const currentTaskIds = new Set(taskHistory.map(task => task.id))
    
    // Find deleted tasks
    const deletedTaskIds = new Set([...cachedTaskIds].filter(id => !currentTaskIds.has(id)))
    
    // Remove data for deleted tasks
    if (deletedTaskIds.size > 0) {
      this.outputChannel.appendLine(`Removing data for ${deletedTaskIds.size} deleted tasks`)
      this.removeDeletedTaskData(rawData, deletedTaskIds)
    }
    
    // Find new or modified tasks
    const tasksToProcess: HistoryItem[] = []
    
    for (const task of taskHistory) {
      const cachedMetadata = metricsCache.taskMetadataIndex[task.id]
      
      // Process task if it's new or modified
      if (!cachedMetadata || task.ts > cachedMetadata.lastModified) {
        tasksToProcess.push(task)
      }
    }
    
    if (tasksToProcess.length > 0) {
      this.outputChannel.appendLine(`Processing ${tasksToProcess.length} new or modified tasks`)
      
      // Process tasks in chunks to avoid blocking UI
      const chunkSize = 5
      for (let i = 0; i < tasksToProcess.length; i += chunkSize) {
        const chunk = tasksToProcess.slice(i, i + chunkSize)
        await this.processTaskChunk(chunk, rawData)
      }
    } else {
      this.outputChannel.appendLine("No new or modified tasks to process")
    }
    
    // Calculate metrics from updated raw data
    return this.calculateMetrics(rawData)
  }
  
  // Process a chunk of tasks
  private async processTaskChunk(tasks: HistoryItem[], rawData: RawMetricsData): Promise<void> {
    // Process each task in the chunk
    for (const task of tasks) {
      // Remove existing data for this task
      this.removeTaskData(rawData, task.id)
      
      // Add basic task data
      rawData.tasks.push({
        id: task.id,
        startTime: task.ts,
        completed: task.completed || false,
        completedTs: task.completedTs,
      })
      
      // Add token usage from history item
      if (task.tokensIn > 0 || task.tokensOut > 0 || task.totalCost > 0) {
        rawData.tokenUsage.push({
          taskId: task.id,
          tokensIn: task.tokensIn || 0,
          tokensOut: task.tokensOut || 0,
          model: "unknown", // HistoryItem doesn't have a model property
          timestamp: task.ts,
          cost: task.totalCost || 0,
          cacheWrites: task.cacheWrites || 0,
          cacheReads: task.cacheReads || 0
        })
      } else {
        // If no token usage in history item, add a placeholder with zero values
        rawData.tokenUsage.push({
          taskId: task.id,
          tokensIn: 0,
          tokensOut: 0,
          model: "unknown",
          timestamp: task.ts,
          cost: 0
        })
      }
      
      // Try to load task messages to extract more detailed metrics
      try {
        // Check if we have this task's messages in memory cache
        let taskMessages = this.memoryCache.taskMessages.get(task.id)
        
        // If not in memory cache, load from disk
        if (!taskMessages) {
          taskMessages = await this.loadTaskMessages(task.id)
          
          // Add to memory cache if loaded successfully
          if (taskMessages) {
            this.memoryCache.taskMessages.set(task.id, taskMessages)
          }
        }
        
        // Extract metrics from messages
        if (taskMessages && taskMessages.length > 0) {
          this.extractMetricsFromMessages(taskMessages, task.id, rawData)
        }
      } catch (error) {
        console.error(`Error processing task ${task.id}:`, error)
      }
    }
  }
  
  // Remove data for a specific task
  private removeTaskData(rawData: RawMetricsData, taskId: string): void {
    // Remove task from tasks array
    rawData.tasks = rawData.tasks.filter(task => task.id !== taskId)
    
    // Remove token usage for this task
    rawData.tokenUsage = rawData.tokenUsage.filter(usage => usage.taskId !== taskId)
    
    // Remove tool usage for this task
    rawData.toolUsage = rawData.toolUsage.filter(usage => usage.taskId !== taskId)
    
    // Remove mode switches for this task
    rawData.modeSwitches = rawData.modeSwitches.filter(modeSwitch => modeSwitch.taskId !== taskId)
  }
  
  // Remove data for deleted tasks
  private removeDeletedTaskData(rawData: RawMetricsData, deletedTaskIds: Set<string>): void {
    // Remove tasks
    rawData.tasks = rawData.tasks.filter(task => !deletedTaskIds.has(task.id))
    
    // Remove token usage
    rawData.tokenUsage = rawData.tokenUsage.filter(usage => !deletedTaskIds.has(usage.taskId))
    
    // Remove tool usage
    rawData.toolUsage = rawData.toolUsage.filter(usage => !deletedTaskIds.has(usage.taskId))
    
    // Remove mode switches
    rawData.modeSwitches = rawData.modeSwitches.filter(modeSwitch => !deletedTaskIds.has(modeSwitch.taskId))
  }
  
  // Build task metadata index
  private buildTaskMetadataIndex(taskHistory: HistoryItem[], rawData: RawMetricsData): TaskMetadataIndex {
    const index: TaskMetadataIndex = {}
    
    for (const task of taskHistory) {
      // Find task data in raw data
      const taskData = rawData.tasks.find(t => t.id === task.id)
      
      // Find token usage for this task
      const hasTokenData = rawData.tokenUsage.some(usage => usage.taskId === task.id)
      
      // Count messages if we have them in memory cache
      const messages = this.memoryCache.taskMessages.get(task.id)
      const messageCount = messages ? messages.length : 0
      
      index[task.id] = {
        lastModified: task.ts,
        messageCount,
        hasTokenData,
        hasCompletionStatus: taskData?.completed || false
      }
    }
    
    return index
  }
  
  // Save metrics and cache
  private async saveMetricsAndCache(metrics: MetricsData, cache: MetricsCache): Promise<void> {
    // Save metrics to global state
    await updateGlobalState(this.context, "metricsData", metrics)
    
    // Save cache to global state
    await updateGlobalState(this.context, "metricsCache", cache)
    
    // Update the last calculation time
    this.lastCalculationTime = Date.now()
  }
  
  // Get empty metrics data (for when no metrics are available)
  private getEmptyMetrics(): MetricsData {
    return {
      lastUpdated: Date.now(),
      timestamp: Date.now(),
      taskMetrics: {
        totalTasks: 0,
        completedTasks: 0,
        averageCompletionTimeMs: 0,
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
      (metrics.taskMetrics.averageCompletionTimeMs / 1000 / 60).toFixed(2)} minutes`)
    
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
    
    // Update existing task history items with completion status
    this.updateExistingTaskHistory().catch(error => {
      console.error("Error updating existing task history:", error)
    })
    
    // Set up a new interval to aggregate metrics every hour
    this.aggregationInterval = setInterval(async () => {
      try {
        await this.getMetrics(true) // Force recalculation
      } catch (error) {
        console.error("Error in scheduled metrics aggregation:", error)
      }
    }, 60 * 60 * 1000) // 1 hour
  }
  
  // Update existing task history items with completion status
  private async updateExistingTaskHistory(): Promise<void> {
    try {
      const { taskHistory } = await getAllExtensionState(this.context)
      if (!taskHistory || taskHistory.length === 0) {
        return
      }
      
      let updated = false
      
      // Process each task in the history
      for (let i = 0; i < taskHistory.length; i++) {
        const task = taskHistory[i]
        
        // Skip tasks that already have the completed field
        if (task.completed !== undefined) {
          continue
        }
        
        // Load task messages to determine completion status
        try {
          const taskMessages = await this.loadTaskMessages(task.id)
          if (taskMessages) {
            // Check for completion indicators in messages
            const isCompleted = this.detectTaskCompletion(taskMessages)
            
            // Find completion timestamp if task is completed
            let completedTs: number | undefined
            if (isCompleted) {
              completedTs = this.findCompletionTimestamp(taskMessages)
            }
            
            // Update the task history item
            taskHistory[i] = {
              ...task,
              completed: isCompleted,
              completedTs: completedTs
            }
            
            updated = true
            this.outputChannel.appendLine(`Updated task ${task.id} completion status: ${isCompleted}`)
          }
        } catch (error) {
          console.error(`Error processing messages for task ${task.id}:`, error)
        }
      }
      
      // Save the updated task history if changes were made
      if (updated) {
        await updateGlobalState(this.context, "taskHistory", taskHistory)
        this.outputChannel.appendLine("Task history updated with completion status")
      }
    } catch (error) {
      console.error("Error updating task history:", error)
      throw error
    }
  }
  
  // Detect if a task is completed based on its messages
  private detectTaskCompletion(messages: ClineMessage[]): boolean {
    // Check for completion_result messages
    const hasCompletionResult = messages.some(m => 
      (m.type === "say" && m.say === "completion_result") || 
      (m.type === "ask" && m.ask === "completion_result")
    )
    
    if (hasCompletionResult) {
      return true
    }
    
    // Check for tool usage that indicates completion
    const hasCompletionTool = messages.some(m => 
      m.type === "say" && m.say === "tool" && m.text && 
      (m.text.includes("completion_result") || m.text.includes("attempt_completion"))
    )
    
    if (hasCompletionTool) {
      return true
    }
    
    // Check for user feedback near the end
    const lastFewMessages = messages.slice(-5)
    const hasFeedbackNearEnd = lastFewMessages.some(m => 
      m.type === "say" && m.say === "user_feedback"
    )
    
    if (hasFeedbackNearEnd) {
      return true
    }
    
    // Check if the task is old (more than a day)
    const lastMessageTime = messages[messages.length - 1]?.ts || 0
    const timeGap = Date.now() - lastMessageTime
    const isOldTask = timeGap > 24 * 60 * 60 * 1000 // More than a day old
    
    if (isOldTask && messages.length > 10) {
      return true
    }
    
    return false
  }
  
  // Find the timestamp when a task was completed
  private findCompletionTimestamp(messages: ClineMessage[]): number | undefined {
    // First check for completion_result messages
    const completionResultMessage = messages.find(m => 
      (m.type === "say" && m.say === "completion_result") || 
      (m.type === "ask" && m.ask === "completion_result")
    )
    
    if (completionResultMessage) {
      return completionResultMessage.ts
    }
    
    // Check for tool usage that indicates completion
    const completionToolMessage = messages.find(m => 
      m.type === "say" && m.say === "tool" && m.text && 
      (m.text.includes("completion_result") || m.text.includes("attempt_completion"))
    )
    
    if (completionToolMessage) {
      return completionToolMessage.ts
    }
    
    // Check for user feedback near the end
    const lastFewMessages = messages.slice(-5)
    const feedbackMessage = lastFewMessages.find(m => 
      m.type === "say" && m.say === "user_feedback"
    )
    
    if (feedbackMessage) {
      return feedbackMessage.ts
    }
    
    // If no specific completion timestamp found, use the last message timestamp
    return messages[messages.length - 1]?.ts
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
      this.outputChannel.appendLine(`Processing ${taskHistory.length} tasks from history`);
      
      for (const task of taskHistory) {
        // Add basic task data
        // Check if the task has completion status in the history item
        rawData.tasks.push({
          id: task.id,
          startTime: task.ts,
          completed: task.completed || false, // Use the completed field if it exists
          completedTs: task.completedTs, // Use the completedTs field if it exists
          // We'll try to extract model and mode from messages
        })
        
        // Add token usage directly from the history item
        // This ensures we have token metrics even if we can't load the message files
        if (task.tokensIn > 0 || task.tokensOut > 0 || task.totalCost > 0) {
          this.outputChannel.appendLine(`Adding token usage from history item for task ${task.id}: ${task.tokensIn} in, ${task.tokensOut} out, $${task.totalCost.toFixed(4)} cost`);
          
          rawData.tokenUsage.push({
            taskId: task.id,
            tokensIn: task.tokensIn || 0,
            tokensOut: task.tokensOut || 0,
            model: "unknown", // We don't have model info in the history item
            timestamp: task.ts,
            cost: task.totalCost || 0,
            cacheWrites: task.cacheWrites || 0,
            cacheReads: task.cacheReads || 0
          });
        } else {
          // If no token usage in history item, add a placeholder with zero values
          // This ensures we have at least some token usage data for every task
          this.outputChannel.appendLine(`No token usage found in history item for task ${task.id}, adding placeholder`);
          
          rawData.tokenUsage.push({
            taskId: task.id,
            tokensIn: 0,
            tokensOut: 0,
            model: "unknown",
            timestamp: task.ts,
            cost: 0
          });
        }
        
        // Try to load task messages to extract more detailed metrics
        try {
          // Check both possible file names for task messages
          const taskMessages = await this.loadTaskMessages(task.id)
          if (taskMessages && taskMessages.length > 0) {
            this.extractMetricsFromMessages(taskMessages, task.id, rawData)
          } else {
            this.outputChannel.appendLine(`No messages found for task ${task.id}, using history item data only`);
          }
        } catch (error) {
          console.error(`Error loading messages for task ${task.id}:`, error)
          this.outputChannel.appendLine(`Error loading messages for task ${task.id}: ${error}`);
        }
      }
    }
    
    // Log summary of token usage
    this.outputChannel.appendLine(`\nCollected ${rawData.tokenUsage.length} token usage entries from ${rawData.tasks.length} tasks`);
    let totalTokensIn = 0;
    let totalTokensOut = 0;
    let totalCost = 0;
    
    for (const usage of rawData.tokenUsage) {
      totalTokensIn += usage.tokensIn;
      totalTokensOut += usage.tokensOut;
      totalCost += usage.cost || 0;
    }
    
    this.outputChannel.appendLine(`Total tokens: ${totalTokensIn} in, ${totalTokensOut} out, $${totalCost.toFixed(4)} cost`);
    
    return rawData
  }
  
  // Load messages for a specific task
  private async loadTaskMessages(taskId: string): Promise<ClineMessage[] | undefined> {
    try {
      const taskDirPath = path.join(this.context.globalStorageUri.fsPath, "tasks", taskId)
      this.outputChannel.appendLine(`Looking for task messages in: ${taskDirPath}`)
      
      const uiMessagesFilePath = path.join(taskDirPath, "ui_messages.json")
      
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
      // Check both api_req_finished and api_req_started messages
      if ((message.type === "say" && message.say === "api_req_finished" && message.text) ||
          (message.type === "say" && message.say === "api_req_started" && message.text)) {
        try {
          const apiReqInfo = JSON.parse(message.text)
          
          // Debug log the raw API request info
          this.outputChannel.appendLine(`Raw API request info for task ${taskId}: ${JSON.stringify(apiReqInfo)}`);
          
          // Check if this message has token information
          // Handle both number and string representations of token counts
          const tokensIn = typeof apiReqInfo.tokensIn === 'string' ? 
            parseInt(apiReqInfo.tokensIn, 10) : apiReqInfo.tokensIn;
          
          const tokensOut = typeof apiReqInfo.tokensOut === 'string' ? 
            parseInt(apiReqInfo.tokensOut, 10) : apiReqInfo.tokensOut;
          
          const cost = typeof apiReqInfo.cost === 'string' ? 
            parseFloat(apiReqInfo.cost) : apiReqInfo.cost;
          
          // Also check for cacheWrites and cacheReads
          const cacheWrites = typeof apiReqInfo.cacheWrites === 'string' ? 
            parseInt(apiReqInfo.cacheWrites, 10) : apiReqInfo.cacheWrites;
          
          const cacheReads = typeof apiReqInfo.cacheReads === 'string' ? 
            parseInt(apiReqInfo.cacheReads, 10) : apiReqInfo.cacheReads;
          
          // Update the model for the task if available
          if (apiReqInfo.model && apiReqInfo.model !== "unknown") {
            lastModel = apiReqInfo.model;
            rawData.tasks[taskIndex].model = apiReqInfo.model;
          }
          
          // Always add token usage, even if zero, to ensure we capture all API requests
          // The deduplication logic will handle removing duplicates
          rawData.tokenUsage.push({
            taskId,
            tokensIn: tokensIn || 0,
            tokensOut: tokensOut || 0,
            model: apiReqInfo.model || "unknown",
            timestamp: message.ts,
            cost: cost || 0
          })
          
          this.outputChannel.appendLine(`Recorded token usage for task ${taskId}: ${tokensIn} in, ${tokensOut} out, cost: $${(cost || 0).toFixed(4)}`);
        } catch (error) {
          console.error("Error parsing API request info:", error)
          this.outputChannel.appendLine(`Error parsing API request info for task ${taskId}: ${error}`);
          
          // Try to log the raw message text for debugging
          try {
            this.outputChannel.appendLine(`Raw message text: ${message.text?.substring(0, 200)}...`);
          } catch (e) {
            this.outputChannel.appendLine(`Could not log raw message text: ${e}`);
          }
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
        rawData.tasks[taskIndex].completedTs = message.ts;
        completionDetected = true;
        this.outputChannel.appendLine(`Task ${taskId} marked as completed via say:completion_result`);
      }
      
      // Also check for completion_result in ask type (for user responses to completion)
      if (message.type === "ask" && message.ask === "completion_result") {
        rawData.tasks[taskIndex].completed = true;
        rawData.tasks[taskIndex].completedTs = message.ts;
        completionDetected = true;
        this.outputChannel.appendLine(`Task ${taskId} marked as completed via ask:completion_result`);
      }
      
      // Additional completion detection: Check for user feedback after a task
      // This often indicates the task was completed and the user is providing feedback
      if (message.type === "say" && message.say === "user_feedback" && 
          messages.findIndex(m => m === message) > 0) {
        // Only mark as completed if it's not the first message (which could be initial feedback)
        rawData.tasks[taskIndex].completed = true;
        rawData.tasks[taskIndex].completedTs = message.ts;
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
          rawData.tasks[taskIndex].completedTs = message.ts;
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
        // Use the last message timestamp as the completion timestamp
        rawData.tasks[taskIndex].completedTs = lastMessageTime;
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
    
    // Get current timestamp
    const now = Date.now()
    
    return {
      lastUpdated: now,
      timestamp: now,
      taskMetrics,
      tokenMetrics,
      toolMetrics,
      modelMetrics
    }
  }
  
  // Calculate task metrics
  private calculateTaskMetrics(rawData: RawMetricsData): TaskMetrics {
    const totalTasks = rawData.tasks.length
    
    // Count completed tasks, prioritizing the completed field if it exists
    const completedTasks = rawData.tasks.filter(task => {
      // If the completed field is explicitly set, use that value
      if (task.completed !== undefined) {
        return task.completed;
      }
      
      // For backward compatibility with existing task history items
      // If the task has an endTime, consider it completed
      if (task.endTime) {
        return true;
      }
      
      // Otherwise, fall back to the message-based detection (which is what set task.completed)
      return false;
    }).length
    
    // Calculate average completion time
    let totalCompletionTime = 0
    let completedTasksWithTime = 0
    
    for (const task of rawData.tasks) {
      // If the task is completed and we have both start and end times
      if (task.completed && task.startTime) {
        // Use completedTs if available, otherwise fall back to endTime
        const endTime = task.completedTs || task.endTime;
        
        if (endTime) {
          // Calculate time difference
          const timeDiff = endTime - task.startTime;
          
          // Handle negative time differences (can happen if system clock was adjusted)
          if (timeDiff < 0) {
            // Use absolute value for negative time differences
            const absTimeDiff = Math.abs(timeDiff);
            totalCompletionTime += absTimeDiff;
            completedTasksWithTime++;
            this.outputChannel.appendLine(`Task ${task.id}: Corrected negative completion time: ${(timeDiff / 1000 / 60).toFixed(2)} minutes -> ${(absTimeDiff / 1000 / 60).toFixed(2)} minutes`);
          } else {
            // Normal case - positive time difference
            totalCompletionTime += timeDiff;
            completedTasksWithTime++;
            this.outputChannel.appendLine(`Task ${task.id}: Valid completion time: ${(timeDiff / 1000 / 60).toFixed(2)} minutes`);
          }
        }
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
      averageCompletionTimeMs: averageCompletionTime,
      tasksPerDay
    }
  }
  
  // Calculate token metrics
  private calculateTokenMetrics(rawData: RawMetricsData): TokenMetrics {
    // Deduplicate token usage entries to avoid double-counting
    const deduplicatedTokenUsage = this.deduplicateTokenUsage(rawData.tokenUsage);
    
    let totalTokensIn = 0
    let totalTokensOut = 0
    let totalCost = 0
    
    // Calculate totals
    for (const usage of deduplicatedTokenUsage) {
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
    for (const usage of deduplicatedTokenUsage) {
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
    
    // Aggregate usage by day using deduplicated token usage
    for (const usage of deduplicatedTokenUsage) {
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
    
    // Calculate task metrics, tool metrics, and model metrics
    // These will be populated by the parent calculateMetrics method
    // We're just creating placeholders here to match the desired return structure
    const taskMetrics = undefined;
    const toolMetrics = undefined;
    const modelMetrics = undefined;
    
    return {
      lastUpdated: Date.now(),
      timestamp: Date.now(),
      totalTokensIn,
      totalTokensOut,
      totalCost,
      usageByDay: usageByDayArray,
      taskMetrics,
      toolMetrics,
      modelMetrics
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
  
  // Deduplicate token usage entries to avoid double-counting
  private deduplicateTokenUsage(tokenUsage: RawMetricsData['tokenUsage']): RawMetricsData['tokenUsage'] {
    // Group token usage by taskId and timestamp (rounded to the nearest minute)
    // This helps identify duplicate entries from api_req_started and api_req_finished
    const groupedByTaskAndTime = new Map<string, RawMetricsData['tokenUsage'][0]>();
    
    // Sort by timestamp to ensure we process entries in chronological order
    const sortedUsage = [...tokenUsage].sort((a, b) => a.timestamp - b.timestamp);
    
    for (const usage of sortedUsage) {
      // Round timestamp to the nearest minute to group related entries
      const roundedTimestamp = Math.floor(usage.timestamp / 60000) * 60000;
      const key = `${usage.taskId}-${roundedTimestamp}-${usage.model}`;
      
      // If we already have an entry for this key, update it only if the new entry has more tokens
      // This ensures we keep the most complete information
      const existing = groupedByTaskAndTime.get(key);
      if (existing) {
        // If the new entry has more tokens or cost information, update the existing entry
        if (usage.tokensIn > existing.tokensIn || 
            usage.tokensOut > existing.tokensOut || 
            (usage.cost && (!existing.cost || usage.cost > existing.cost))) {
          
          groupedByTaskAndTime.set(key, {
            taskId: usage.taskId,
            tokensIn: Math.max(existing.tokensIn, usage.tokensIn),
            tokensOut: Math.max(existing.tokensOut, usage.tokensOut),
            model: usage.model,
            timestamp: usage.timestamp, // Keep the original timestamp
            cost: Math.max(existing.cost || 0, usage.cost || 0)
          });
          
          this.outputChannel.appendLine(`Deduplicated token usage for task ${usage.taskId}: using max values`);
        }
      } else {
        // No existing entry, add this one
        groupedByTaskAndTime.set(key, usage);
      }
    }
    
    // Convert the map back to an array
    return Array.from(groupedByTaskAndTime.values());
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
