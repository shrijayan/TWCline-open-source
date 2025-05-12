import * as vscode from "vscode"
import crypto from "crypto"
import axios, { AxiosRequestConfig } from "axios"
import { ExtensionMessage } from "@shared/ExtensionMessage"
import { getSecret, storeSecret } from "@core/storage/state"

/**
 * Interface for the statistics user information
 */
export interface StatsUserInfo {
    displayName: string | null
    email: string | null
}

/**
 * Service for handling statistics-specific authentication
 * This is completely separate from the main Cline authentication
 */
export class StatsAuthService {
    // Storage keys for stats authentication
    private static readonly STATS_AUTH_TOKEN_KEY = "statsAuthToken"
    private static readonly STATS_AUTH_NONCE_KEY = "statsAuthNonce"
    
    // Base URL for the statistics API - to be configured later
    // INTEGRATION NOTE: Update this URL when your statistics API is ready
    private readonly baseUrl = "https://api.stats.example.com/v1"
    
    private postMessageToWebview: (message: ExtensionMessage) => Promise<void>
    private context: vscode.ExtensionContext

    constructor(
        context: vscode.ExtensionContext,
        postMessageToWebview: (message: ExtensionMessage) => Promise<void>
    ) {
        this.context = context
        this.postMessageToWebview = postMessageToWebview
    }

    /**
     * Handles the user clicking the login button in the statistics tab
     * Uses VS Code Authentication API for Google SSO
     */
    async statsLoginClicked(): Promise<string> {
        try {
            console.log("Stats login button clicked")
            
            // Show a notification to the user
            vscode.window.showInformationMessage("Initiating Google login...")
            
            // Use the VS Code Authentication API to get a session
            const session = await vscode.authentication.getSession(
                'tw-cline-stats-google', 
                ['email', 'profile'], 
                { 
                    createIfNone: true
                }
            )
            
            if (!session) {
                throw new Error("Failed to get authentication session");
            }
            
            console.log("Authentication session obtained:", session.id)
            
            // Extract user info from the session
            const userInfo: StatsUserInfo = {
                displayName: session.account.label || null,
                email: session.account.label || null // Usually the label is the email
            };
            
            // Store the token securely
            await storeSecret(this.context, StatsAuthService.STATS_AUTH_TOKEN_KEY, session.accessToken)
            
            // Update the UI
            await this.postMessageToWebview({
                type: "statsAuthStateChanged",
                statsUserInfo: userInfo
            })
            
            // Refresh metrics
            await this.postMessageToWebview({
                type: "refreshMetrics",
                dateRange: "7d",
                forceRecalculate: true
            })
            
            vscode.window.showInformationMessage("Successfully logged in to Statistics")
            
            return session.accessToken
        } catch (error) {
            console.error("Error in statsLoginClicked:", error)
            vscode.window.showErrorMessage("Failed to login: " + (error instanceof Error ? error.message : String(error)))
            throw error
        }
    }
    
    /**
     * Extracts user information from a JWT token
     */
    private extractUserInfoFromToken(token: string): StatsUserInfo {
        try {
            // For JWT tokens, extract the payload
            const parts = token.split('.')
            if (parts.length === 3) {
                const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString())
                return {
                    displayName: payload.name || null,
                    email: payload.email || null
                }
            }
            return { displayName: null, email: null }
        } catch (error) {
            console.error("Error extracting user info from token:", error)
            return { displayName: null, email: null }
        }
    }

    /**
     * Validates the authentication state parameter
     * This prevents CSRF attacks by ensuring the auth request originated from this extension
     */
    public async validateAuthState(state: string | null): Promise<boolean> {
        const storedNonce = await getSecret(this.context, StatsAuthService.STATS_AUTH_NONCE_KEY)
        if (!state || state !== storedNonce) {
            return false
        }
        
        // Clear the nonce after use
        await storeSecret(this.context, StatsAuthService.STATS_AUTH_NONCE_KEY, undefined)
        return true
    }

    /**
     * Handles the authentication callback after successful Google SSO login
     * 
     * INTEGRATION NOTE: Update this method to match your authentication response format
     * The token parameter should be the authentication token from your service
     */
    async handleAuthCallback(token: string, userInfo?: StatsUserInfo): Promise<void> {
        try {
            // Store the authentication token securely
            await storeSecret(this.context, StatsAuthService.STATS_AUTH_TOKEN_KEY, token)
            
            // Send user info to webview if provided
            if (userInfo) {
                await this.postMessageToWebview({
                    type: "statsAuthStateChanged",
                    statsUserInfo: userInfo
                })
            }
            
            // Refresh metrics data with the new authentication
            await this.postMessageToWebview({
                type: "refreshMetrics",
                dateRange: "7d",
                forceRecalculate: true
            })
            
            vscode.window.showInformationMessage("Successfully logged in to Statistics")
        } catch (error) {
            console.error("Failed to handle stats auth callback:", error)
            vscode.window.showErrorMessage("Failed to log in to Statistics")
        }
    }

    /**
     * Handles user logout from statistics
     */
    async handleSignOut(): Promise<void> {
        try {
            console.log("StatsAuthService: handleSignOut called")
            
            // Clear the authentication token
            await storeSecret(this.context, StatsAuthService.STATS_AUTH_TOKEN_KEY, undefined)
            
            // Update the webview
            await this.postMessageToWebview({
                type: "statsAuthStateChanged",
                statsUserInfo: undefined
            })
            
            // Refresh metrics with unauthenticated data
            await this.postMessageToWebview({
                type: "refreshMetrics",
                dateRange: "7d",
                forceRecalculate: true
            })
            
            // Note: We don't need to explicitly log out of the VS Code authentication session
            // The session will remain valid, but our app won't use it until the user logs in again
            
            vscode.window.showInformationMessage("Successfully logged out of Statistics")
            console.log("StatsAuthService: User logged out successfully")
        } catch (error) {
            console.error("Failed to sign out from statistics:", error)
            vscode.window.showErrorMessage("Failed to log out from Statistics")
        }
    }

    /**
     * Gets the authentication token for API requests
     */
    async getAuthToken(): Promise<string | undefined> {
        return getSecret(this.context, StatsAuthService.STATS_AUTH_TOKEN_KEY)
    }

    /**
     * Checks if the user is authenticated
     */
    async isAuthenticated(): Promise<boolean> {
        const token = await this.getAuthToken()
        return !!token
    }

    /**
     * Helper function to make authenticated requests to the Statistics API
     * 
     * INTEGRATION NOTE: Update this method to match your API's authentication requirements
     * This is a template that assumes Bearer token authentication
     */
    async authenticatedRequest<T>(endpoint: string, config: AxiosRequestConfig = {}): Promise<T> {
        const token = await this.getAuthToken()
        
        if (!token) {
            throw new Error("Not authenticated to Statistics API")
        }
        
        const url = `${this.baseUrl}${endpoint}`
        const requestConfig: AxiosRequestConfig = {
            ...config,
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
                ...config.headers,
            },
        }
        
        try {
            const response = await axios.get(url, requestConfig)
            
            if (!response.data) {
                throw new Error(`Invalid response from ${endpoint} API`)
            }
            
            return response.data
        } catch (error) {
            console.error(`Error in stats API request to ${endpoint}:`, error)
            throw error
        }
    }

    /**
     * Fetches leaderboard data from the statistics API
     * 
     * INTEGRATION NOTE: Update this method to match your leaderboard API endpoint and response format
     * This is a placeholder that returns mock data until the API is implemented
     */
    async fetchLeaderboard(): Promise<any> {
        try {
            // If authenticated, try to fetch from API
            if (await this.isAuthenticated()) {
                try {
                    // INTEGRATION NOTE: Replace '/leaderboard' with your actual endpoint
                    return await this.authenticatedRequest('/leaderboard')
                } catch (error) {
                    console.error("Error fetching leaderboard, falling back to mock data:", error)
                    // Fall back to mock data on error
                }
            }
            
            // Return mock data for development
            return {
                rankings: [
                    { rank: 1, name: "User 1", score: 1000 },
                    { rank: 2, name: "User 2", score: 950 },
                    { rank: 3, name: "User 3", score: 900 },
                ]
            }
        } catch (error) {
            console.error("Failed to fetch leaderboard:", error)
            return { rankings: [] }
        }
    }
    
    /**
     * Disposes of resources used by the service
     * This is a no-op in the current implementation but is required for compatibility
     */
    async dispose(): Promise<void> {
        // No resources to clean up
    }
}
