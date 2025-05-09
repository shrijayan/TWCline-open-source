import * as vscode from "vscode"
import { MetricsService } from "./MetricsService"
import { TokenBackfillService } from "./TokenBackfillService"
import { ExtensionMessage } from "@shared/ExtensionMessage"
import { MetricsData } from "@shared/metrics"
import { StatsAuthService } from "../stats-auth/StatsAuthService"

/**
 * Controller for metrics-related functionality
 */
export class MetricsController {
  private metricsService: MetricsService
  private tokenBackfillService: TokenBackfillService
  public statsAuthService: StatsAuthService
  private context: vscode.ExtensionContext
  private postMessageToWebview: (message: ExtensionMessage) => Thenable<boolean> | undefined

  constructor(
    context: vscode.ExtensionContext,
    postMessageToWebview: (message: ExtensionMessage) => Thenable<boolean> | undefined
  ) {
    this.context = context
    this.postMessageToWebview = postMessageToWebview
    this.metricsService = MetricsService.getInstance(context)
    this.tokenBackfillService = new TokenBackfillService(context)
    
    // Create a wrapper function to convert the return type for StatsAuthService
    const postMessageWrapper = async (message: ExtensionMessage): Promise<void> => {
      await this.postMessageToWebview(message)
    }
    
    this.statsAuthService = new StatsAuthService(context, postMessageWrapper)
    
    // Start the metrics aggregation process
    this.metricsService.startAggregation()
  }

  /**
   * Get metrics data, optionally forcing recalculation
   */
  public async getMetrics(forceRecalculate: boolean = false): Promise<MetricsData> {
    return this.metricsService.getMetrics(forceRecalculate)
  }

  /**
   * Get metrics data for a specific date range
   */
  public async getMetricsForDateRange(
    range: "7d" | "30d" | "all" = "7d",
    forceRecalculate: boolean = false
  ): Promise<MetricsData> {
    return this.metricsService.getMetricsForDateRange(range, forceRecalculate)
  }

  /**
   * Send metrics data to the webview
   */
  public async sendMetricsToWebview(
    range: "7d" | "30d" | "all" = "7d",
    forceRecalculate: boolean = false
  ): Promise<void> {
    // First send cached metrics immediately for fast UI response
    const cachedMetrics = await this.getMetricsForDateRange(range, false)
    await this.postMessageToWebview({
      type: "metricsData",
      metricsData: cachedMetrics
    })
    
    // If a recalculation was requested, do it in the background
    if (forceRecalculate) {
      // Show loading indicator
      await this.postMessageToWebview({
        type: "metricsLoading",
        isLoading: true
      })
      
      // Run token backfill before calculating fresh metrics
      try {
        const updatedCount = await this.tokenBackfillService.backfillAllTasks()
        if (updatedCount > 0) {
          console.log(`Updated token usage for ${updatedCount} tasks before calculating metrics`)
        }
      } catch (error) {
        console.error("Error during token backfill:", error)
      }
      
      // Calculate fresh metrics
      const freshMetrics = await this.getMetricsForDateRange(range, true)
      
      // Send updated metrics
      await this.postMessageToWebview({
        type: "metricsData",
        metricsData: freshMetrics
      })
      
      // Hide loading indicator
      await this.postMessageToWebview({
        type: "metricsLoading",
        isLoading: false
      })
    }
  }

  /**
   * Handle metrics-related webview messages
   */
  public async handleMetricsMessage(message: any): Promise<void> {
    if (message.type === "refreshMetrics") {
      await this.sendMetricsToWebview(
        message.dateRange || "7d",
        message.forceRecalculate || false
      )
    } else if (message.type === "statsLoginClicked") {
      await this.handleStatsLogin()
    } else if (message.type === "statsLogoutClicked") {
      await this.handleStatsLogout()
    } else if (message.type === "statsAuthStateChanged") {
      // This is handled by the StatsAuthService
    }
  }
  
  /**
   * Handle statistics login
   */
  private async handleStatsLogin(): Promise<void> {
    console.log("MetricsController: handleStatsLogin called")
    try {
      // The statsLoginClicked method now handles the entire mock authentication flow
      const mockAuthUrl = await this.statsAuthService.statsLoginClicked()
      console.log("MetricsController: Mock auth completed:", mockAuthUrl)
    } catch (error) {
      console.error("MetricsController: Error in handleStatsLogin:", error)
      vscode.window.showErrorMessage("Failed to login: " + (error instanceof Error ? error.message : String(error)))
    }
  }
  
  /**
   * Handle statistics logout
   */
  private async handleStatsLogout(): Promise<void> {
    console.log("MetricsController: handleStatsLogout called")
    try {
      await this.statsAuthService.handleSignOut()
      console.log("MetricsController: User logged out successfully")
    } catch (error) {
      console.error("MetricsController: Error in handleStatsLogout:", error)
      vscode.window.showErrorMessage("Failed to logout: " + (error instanceof Error ? error.message : String(error)))
    }
  }

  /**
   * Dispose of resources
   */
  public dispose(): void {
    this.metricsService.stopAggregation()
  }
}
