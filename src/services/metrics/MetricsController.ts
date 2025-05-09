import * as vscode from "vscode"
import { MetricsService } from "./MetricsService"
import { ExtensionMessage } from "@shared/ExtensionMessage"
import { MetricsData } from "@shared/metrics"

/**
 * Controller for metrics-related functionality
 */
export class MetricsController {
  private metricsService: MetricsService
  private context: vscode.ExtensionContext
  private postMessageToWebview: (message: ExtensionMessage) => Thenable<boolean> | undefined

  constructor(
    context: vscode.ExtensionContext,
    postMessageToWebview: (message: ExtensionMessage) => Thenable<boolean> | undefined
  ) {
    this.context = context
    this.postMessageToWebview = postMessageToWebview
    this.metricsService = MetricsService.getInstance(context)
    
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
    const metrics = await this.getMetricsForDateRange(range, forceRecalculate)
    await this.postMessageToWebview({
      type: "metricsData",
      metricsData: metrics
    })
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
    }
  }

  /**
   * Dispose of resources
   */
  public dispose(): void {
    this.metricsService.stopAggregation()
  }
}
