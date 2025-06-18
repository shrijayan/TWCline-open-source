# Cline Extension Memory Bank

## Project Context
This is the Cline VSCode extension - an AI-powered coding assistant that provides intelligent code completion, analysis, and task automation through a React-based webview interface.

## Recent Changes - TypeScript Error Fixes (COMPLETED)

### Files Modified and Their Purpose

#### 1. `src/core/controller/index.ts`
**Purpose**: Main controller class that manages extension state, webview communication, and task execution.

**Key Methods Added**:
- `recordFileEditPresented()`: Tracks when file edit suggestions are presented to users. Increments totalSuggestions counter in global state and updates webview.
- `incrementAcceptedFileEdits()`: Tracks when users accept file edit suggestions. Increments acceptedSuggestions counter in global state and updates webview.
- `recordFileEditRejected()`: Placeholder method for tracking rejected file edits. Currently just updates webview state for future enhancement.

**Key Imports Added**:
- `handleModelsServiceRequest`: Function to handle gRPC model service requests for OpenRouter model refreshing
- `EmptyRequest`: Protocol buffer message type for empty gRPC requests

**Key Functionality**:
- Manages VSCode extension lifecycle and webview communication
- Handles task initialization and execution
- Manages API configurations and model switching
- Tracks file edit statistics for user analytics
- Integrates with MCP (Model Context Protocol) servers

#### 2. `src/shared/WebviewMessage.ts`
**Purpose**: Defines TypeScript interfaces for messages sent from webview to extension.

**Changes Made**:
- Added `"webviewDidLaunch"` to the WebviewMessage type union
- This message type is sent when the React webview component initializes

**Key Functionality**:
- Defines all possible message types that can be sent from webview to extension
- Includes user actions, configuration changes, and lifecycle events
- Ensures type safety for webview-extension communication

#### 3. `src/shared/ExtensionMessage.ts`
**Purpose**: Defines TypeScript interfaces for messages sent from extension to webview.

**Changes Made**:
- Added `"openRouterModels"` to the ExtensionMessage type union
- Added `openRouterModels?: Record<string, ModelInfo>` property to interface
- Added missing message types: `"theme"`, `"workspaceUpdated"`, `"mcpMarketplaceCatalog"`, `"totalTasksSize"`
- Added missing properties: `filePaths?: string[]`, `totalTasksSize?: number`

**Key Functionality**:
- Defines all possible message types sent from extension to webview
- Includes state updates, model information, and user data
- Supports real-time updates to React components
- Now includes all message types used by webview context

#### 4. `src/core/storage/state-keys.ts`
**Purpose**: Defines TypeScript types for all possible state keys used in VSCode's storage APIs.

**Changes Made**:
- Added `"openRouterModelInfo"` to the GlobalStateKey type union

**Key Functionality**:
- Ensures type safety for all state storage operations
- Separates global state (across all VSCode instances) from workspace state (per project)
- Includes secret keys for sensitive data like API keys

#### 5. `webview-ui/src/context/ExtensionStateContext.tsx`
**Purpose**: React context provider that manages webview state and communication with extension.

**Changes Made**:
- Removed duplicate import statements for ExtensionMessage, ExtensionState, and DEFAULT_PLATFORM
- Added proper import of vscode wrapper: `import { vscode } from "../utils/vscode"`
- Fixed vscode global declaration issue by using the proper wrapper

**Key Functionality**:
- Manages React state for webview components
- Handles real-time communication with extension via gRPC and message passing
- Provides context for all webview components to access extension state
- Now properly imports vscode API wrapper instead of using undefined global

#### 6. `src/core/commands.ts`
**Purpose**: Registers VSCode commands that can be triggered by users or other extensions.

**Key Functionality**:
- Registers file edit tracking commands that call Controller methods
- Commands: `cline.fileEditPresented`, `cline.fileEditAccepted`, `cline.fileEditRejected`
- These commands are likely triggered by diff view interactions or code suggestions

## Architecture Overview

### Core Components
1. **Controller**: Main orchestrator managing state, tasks, and communication
2. **Task**: Handles AI request execution and tool operations  
3. **WebviewProvider**: Manages React webview lifecycle and HTML generation
4. **McpHub**: Manages Model Context Protocol server connections
5. **WorkspaceTracker**: Tracks file system changes and workspace state

### Data Flow
1. User interacts with React webview
2. Webview sends WebviewMessage to Controller
3. Controller processes message and updates state
4. Controller sends ExtensionMessage back to webview
5. React components re-render with new state

### State Management
- **Global State**: Settings, user info, task history (persists across VSCode sessions)
- **Workspace State**: API configs, model selections (per project)
- **Secrets**: API keys and sensitive data (encrypted storage)

### File Edit Statistics
- Tracks user interaction with AI-generated code suggestions
- `totalSuggestions`: Count of all suggestions presented
- `acceptedSuggestions`: Count of suggestions user accepted
- Used for analytics and improving AI suggestions

## Development Notes
- Extension follows VSCode's disposable pattern for resource cleanup
- Uses TypeScript for type safety across all components
- React webview communicates via VSCode's postMessage API
- Supports multiple AI providers (Anthropic, OpenRouter, etc.)
- Implements Plan/Act mode for different AI interaction patterns
