export * from './types.js'
export * from './updates.js'
export * from './connection.js'
export * from './session-store.js'
export * from './connection-store.js'
export * from './project.js'

// Re-export the protocol types the UI needs, so packages/ui never imports the
// SDK directly. This is the single place that decides what the UI may know.
export type {
  ContentBlock,
  Diff,
  Plan,
  PlanEntry,
  PromptResponse,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionConfigOption,
  SessionModeState,
  SessionNotification,
  StopReason,
  Terminal,
  ToolCall,
  ToolCallContent,
  ToolCallLocation,
  ToolCallUpdate,
  ToolKind,
  UsageUpdate,
} from '@agentclientprotocol/sdk'