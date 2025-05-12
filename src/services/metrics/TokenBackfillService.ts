import * as vscode from "vscode"
import * as path from "path"
import * as fs from "fs/promises"
import { HistoryItem } from "@shared/HistoryItem"
import { ClineMessage } from "@shared/ExtensionMessage"
import { getGlobalState, updateGlobalState } from "@core/storage/state"
import { fileExistsAtPath } from "@utils/fs"

/**
 * Service for backfilling token usage data for historical tasks
 */
export class TokenBackfillService {
  private context: vscode.ExtensionContext
  private outputChannel: vscode.OutputChannel
  
  constructor(context: vscode.ExtensionContext) {
    this.context = context
    this.outputChannel = vscode.window.createOutputChannel("Cline Token Backfill")
  }
  
  /**
   * Backfill token usage for all tasks in history
   * @returns Number of tasks updated
   */
  public async backfillAllTasks(): Promise<number> {
    try {
      // Get task history
      const taskHistory = ((await getGlobalState(this.context, "taskHistory")) as HistoryItem[]) || []
      
      if (taskHistory.length === 0) {
        this.outputChannel.appendLine("No tasks found in history")
        return 0
      }
      
      this.outputChannel.appendLine(`Starting backfill for ${taskHistory.length} tasks`)
      this.outputChannel.show(true)
      
      // Filter tasks that need backfilling
      const tasksNeedingBackfill = taskHistory.filter(task => 
        task.tokensIn === 0 && task.tokensOut === 0 && (!task.totalCost || task.totalCost === 0)
      )
      
      this.outputChannel.appendLine(`Found ${tasksNeedingBackfill.length} tasks needing backfill`)
      
      // Process tasks in batches to avoid blocking UI
      const batchSize = 5
      let updatedCount = 0
      
      for (let i = 0; i < tasksNeedingBackfill.length; i += batchSize) {
        const batch = tasksNeedingBackfill.slice(i, i + batchSize)
        
        // Process each task in the batch
        const results = await Promise.all(
          batch.map(task => this.backfillTask(task.id, task))
        )
        
        // Count updated tasks
        updatedCount += results.filter(Boolean).length
        
        // Allow UI to update between batches
        await new Promise(resolve => setTimeout(resolve, 10))
      }
      
      this.outputChannel.appendLine(`Backfill complete. Updated ${updatedCount} tasks.`)
      return updatedCount
    } catch (error) {
      this.outputChannel.appendLine(`Error in backfill process: ${error}`)
      return 0
    }
  }
  
  /**
   * Backfill token usage for a single task
   * @param taskId Task ID
   * @param historyItem Task history item
   * @returns Whether the task was updated
   */
  private async backfillTask(taskId: string, historyItem: HistoryItem): Promise<boolean> {
    // Skip tasks that already have token data
    if (historyItem.tokensIn > 0 || historyItem.tokensOut > 0) {
      this.outputChannel.appendLine(`Task ${taskId} already has token data, skipping`)
      return false
    }
    
    try {
      // Load task messages
      const taskMessages = await this.loadTaskMessages(taskId)
      if (!taskMessages || taskMessages.length === 0) {
        this.outputChannel.appendLine(`No messages found for task ${taskId}`)
        return false
      }
      
      // Extract token usage from API request messages
      let tokensIn = 0
      let tokensOut = 0
      let cacheWrites = 0
      let cacheReads = 0
      let totalCost = 0
      
      for (const message of taskMessages) {
        if (message.type === "say" && 
            (message.say === "api_req_finished" || message.say === "api_req_started") && 
            message.text) {
          try {
            const apiReqInfo = JSON.parse(message.text)
            
            // Add token counts from this message
            tokensIn += Number(apiReqInfo.tokensIn) || 0
            tokensOut += Number(apiReqInfo.tokensOut) || 0
            cacheWrites += Number(apiReqInfo.cacheWrites) || 0
            cacheReads += Number(apiReqInfo.cacheReads) || 0
            totalCost += Number(apiReqInfo.cost) || 0
          } catch (error) {
            this.outputChannel.appendLine(`Error parsing API request info: ${error}`)
          }
        }
      }
      
      // If we found token usage, update the history item
      if (tokensIn > 0 || tokensOut > 0 || totalCost > 0) {
        this.outputChannel.appendLine(`Updating task ${taskId} with token data: ${tokensIn} in, ${tokensOut} out, $${totalCost.toFixed(4)} cost`)
        return await this.updateTaskHistory(taskId, {
          tokensIn,
          tokensOut,
          cacheWrites,
          cacheReads,
          totalCost
        })
      }
      
      return false
    } catch (error) {
      this.outputChannel.appendLine(`Error backfilling task ${taskId}: ${error}`)
      return false
    }
  }
  
  /**
   * Update task history with token usage data
   * @param taskId Task ID
   * @param tokenData Token usage data
   * @returns Whether the update was successful
   */
  private async updateTaskHistory(taskId: string, tokenData: {
    tokensIn: number
    tokensOut: number
    cacheWrites: number
    cacheReads: number
    totalCost: number
  }): Promise<boolean> {
    try {
      // Get current task history
      const taskHistory = ((await getGlobalState(this.context, "taskHistory")) as HistoryItem[]) || []
      
      // Find the task in history
      const taskIndex = taskHistory.findIndex(task => task.id === taskId)
      if (taskIndex === -1) {
        this.outputChannel.appendLine(`Task ${taskId} not found in history`)
        return false
      }
      
      // Update the task with token data
      taskHistory[taskIndex] = {
        ...taskHistory[taskIndex],
        tokensIn: tokenData.tokensIn,
        tokensOut: tokenData.tokensOut,
        cacheWrites: tokenData.cacheWrites,
        cacheReads: tokenData.cacheReads,
        totalCost: tokenData.totalCost
      }
      
      // Save updated history
      await updateGlobalState(this.context, "taskHistory", taskHistory)
      return true
    } catch (error) {
      this.outputChannel.appendLine(`Error updating task history: ${error}`)
      return false
    }
  }
  
  /**
   * Load messages for a task
   * @param taskId Task ID
   * @returns Task messages or undefined if not found
   */
  private async loadTaskMessages(taskId: string): Promise<ClineMessage[] | undefined> {
    try {
      const taskDirPath = path.join(this.context.globalStorageUri.fsPath, "tasks", taskId)
      const uiMessagesFilePath = path.join(taskDirPath, "ui_messages.json")
      
      if (await fileExistsAtPath(uiMessagesFilePath)) {
        const messagesJson = await fs.readFile(uiMessagesFilePath, "utf8")
        return JSON.parse(messagesJson)
      }
      
      return undefined
    } catch (error) {
      this.outputChannel.appendLine(`Error loading messages for task ${taskId}: ${error}`)
      return undefined
    }
  }
}
