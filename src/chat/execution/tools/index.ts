/**
 * Built-in Tools
 *
 * Export all built-in tools and registration function.
 */

import { getToolRegistry } from '../registry.js';
import type { ToolDefinition } from '../types.js';

// Core tools
import { execTool } from './exec.js';
import { webFetchTool } from './web-fetch.js';
import { readFileTool, writeFileTool, searchFilesTool, grepTool, editFileTool, directoryTreeTool, patchApplyTool } from './file-ops.js';

// GitHub tools
import { githubPrTool } from './github.js';

// Test tools
import { testRunTool } from './test-run.js';

// Image tools
import { imageAnalyzeTool } from './image-analyze.js';

// Git tools
import {
  gitStatusTool,
  gitDiffTool,
  gitLogTool,
  gitCommitTool,
  gitBranchTool,
  gitStashTool,
  gitRemoteTool,
} from './git.js';

// System tools
import {
  envTool,
  systemInfoTool,
  processListTool,
  pathInfoTool,
  whichTool,
} from './system.js';
import { dbMaintenanceTool } from './maintenance.js';

// Session tools
import { sessionStatusTool } from './session-status.js';
import { sessionsListTool } from './sessions-list.js';
import { sessionsSpawnTool } from './sessions-spawn.js';
import { sessionsSendTool } from './sessions-send.js';

// Agent tools
import { agentsListTool } from './agents-list.js';

// Memory tools
import { memorySearchTool, memoryGetTool, memoryStatsTool } from './memory-tools.js';

// Web search tool
import { webSearchTool } from './web-search.js';

// Task completion tool
import { completeTaskTool } from './complete-task.js';

// Cron tools
import {
  cronCreateTool,
  cronListTool,
  cronTriggerTool,
  cronPauseTool,
  cronArchiveTool,
  cronDeleteTool,
  cronHistoryTool,
  cronTools,
} from './cron-tool.js';

// profClaw ops tools (ticket, project management)
import {
  createTicketTool,
  createProjectTool,
  listTicketsTool,
  listProjectsTool,
  updateTicketTool,
  getTicketTool,
  profclawTools,
} from './profclaw-ops.js';

// Browser tools
import {
  browserNavigateTool,
  browserSnapshotTool,
  browserClickTool,
  browserTypeTool,
  browserSearchTool,
  browserScreenshotTool,
  browserPagesTool,
  browserCloseTool,
  browserTools,
} from './browser.js';

// Canvas tools
import { canvasRenderTool } from './canvas.js';

// Session spawn tools (hierarchical agent sessions)
import {
  spawnSessionTool,
  sendMessageTool,
  receiveMessagesTool,
  listSessionsTool,
  sessionSpawnTools,
} from './session-spawn.js';

// Integration tools (screen capture, clipboard, notifications)
import { screenCaptureTool, clipboardReadTool, clipboardWriteTool, notifyTool } from './integrations.js';

// Export individual tools
export { execTool } from './exec.js';
export { webFetchTool } from './web-fetch.js';
export { readFileTool, writeFileTool, searchFilesTool, grepTool, editFileTool, directoryTreeTool, patchApplyTool } from './file-ops.js';

// GitHub tools exports
export { githubPrTool } from './github.js';

// Test tools exports
export { testRunTool } from './test-run.js';

// Image tools exports
export { imageAnalyzeTool } from './image-analyze.js';
export {
  gitStatusTool,
  gitDiffTool,
  gitLogTool,
  gitCommitTool,
  gitBranchTool,
  gitStashTool,
  gitRemoteTool,
} from './git.js';
export {
  envTool,
  systemInfoTool,
  processListTool,
  pathInfoTool,
  whichTool,
} from './system.js';
export { sessionStatusTool, getSessionModel, setSessionModel, clearSessionModel } from './session-status.js';
export { sessionsListTool } from './sessions-list.js';
export { sessionsSpawnTool } from './sessions-spawn.js';
export { sessionsSendTool } from './sessions-send.js';

// Agent tools exports
export { agentsListTool } from './agents-list.js';

// Memory tools exports
export { memorySearchTool, memoryGetTool, memoryStatsTool } from './memory-tools.js';

// Web search tool exports
export { webSearchTool } from './web-search.js';

// Task completion tool exports
export { completeTaskTool } from './complete-task.js';

// Cron tools exports
export {
  cronCreateTool,
  cronListTool,
  cronTriggerTool,
  cronPauseTool,
  cronArchiveTool,
  cronDeleteTool,
  cronHistoryTool,
  cronTools,
} from './cron-tool.js';

// profClaw ops tools exports
export {
  createTicketTool,
  createProjectTool,
  listTicketsTool,
  listProjectsTool,
  updateTicketTool,
  getTicketTool,
  profclawTools,
} from './profclaw-ops.js';
export type {
  CronCreateParams,
  CronCreateResult,
  CronListParams,
  CronListResult,
  CronTriggerParams,
  CronTriggerResult,
  CronPauseParams,
  CronPauseResult,
  CronArchiveParams,
  CronArchiveResult,
  CronDeleteParams,
  CronDeleteResult,
  CronHistoryParams,
  CronHistoryResult,
} from './cron-tool.js';

// Browser tools exports
export {
  browserNavigateTool,
  browserSnapshotTool,
  browserClickTool,
  browserTypeTool,
  browserSearchTool,
  browserScreenshotTool,
  browserPagesTool,
  browserCloseTool,
  browserTools,
} from './browser.js';

// Canvas tools exports
export { canvasRenderTool } from './canvas.js';
export type { CanvasRenderResult, CanvasArtifact } from './canvas.js';
export { getArtifact, listArtifacts, clearArtifacts } from './canvas.js';

// Integration tools exports
export { screenCaptureTool, clipboardReadTool, clipboardWriteTool, notifyTool } from './integrations.js';
export type { ScreenCaptureResult, ClipboardReadResult, ClipboardWriteResult, NotifyResult } from './integrations.js';

// Session spawn tools exports (hierarchical agent sessions)
export {
  spawnSessionTool,
  sendMessageTool,
  receiveMessagesTool,
  listSessionsTool,
  sessionSpawnTools,
} from './session-spawn.js';

// Export types for external use
export type { ExecResult } from './exec.js';
export type { WebFetchResult } from './web-fetch.js';
export type { ReadFileResult, WriteFileResult, SearchFilesResult, GrepResult, GrepMatch, EditFileResult, DirectoryTreeResult, PatchApplyResult } from './file-ops.js';
export type { GithubPrResult } from './github.js';
export type { TestRunResult, TestFailure } from './test-run.js';
export type { ImageAnalyzeResult } from './image-analyze.js';
export type { GitResult } from './git.js';
export type {
  EnvResult,
  SystemInfoResult,
  ProcessListResult,
  PathInfoResult,
  WhichResult,
} from './system.js';
export type { SessionStatusResult } from './session-status.js';
export type { SessionsSpawnParams, SessionsSpawnResult } from './sessions-spawn.js';
export type { SessionsSendParams, SessionsSendResult } from './sessions-send.js';
export type {
  BrowserNavigateResult,
  BrowserSnapshotResult,
  BrowserClickResult,
  BrowserTypeResult,
  BrowserSearchResult,
  BrowserScreenshotResult,
  BrowserPagesResult,
  BrowserCloseResult,
} from './browser.js';

// All built-in tools (typed as generic ToolDefinition array)
export const builtinTools: ToolDefinition<any, any>[] = [
  // Core tools (11)
  execTool,
  webFetchTool,
  readFileTool,
  writeFileTool,
  editFileTool,
  searchFilesTool,
  grepTool,
  directoryTreeTool,
  patchApplyTool,
  imageAnalyzeTool,
  canvasRenderTool,
  // Git tools (7)
  gitStatusTool,
  gitDiffTool,
  gitLogTool,
  gitCommitTool,
  gitBranchTool,
  gitStashTool,
  gitRemoteTool,
  // System tools (5)
  envTool,
  systemInfoTool,
  processListTool,
  pathInfoTool,
  whichTool,
  // Session tools (4)
  sessionStatusTool,
  sessionsListTool,
  sessionsSpawnTool,
  sessionsSendTool,
  // Agent tools (1)
  agentsListTool,
  // Memory tools (3)
  memorySearchTool,
  memoryGetTool,
  memoryStatsTool,
  // Web search (1)
  webSearchTool,
  // Task completion (1)
  completeTaskTool,
  // Cron tools (7)
  ...cronTools,
  // Browser tools (8)
  ...browserTools,
  // profClaw ops tools (6)
  ...profclawTools,
  // Session spawn tools (4) - hierarchical agent sessions
  ...sessionSpawnTools,
  // Maintenance tools (1)
  dbMaintenanceTool,
  // GitHub tools (1)
  githubPrTool,
  // Test tools (1)
  testRunTool,
  // Integration tools (4) - screen capture, clipboard, notifications
  screenCaptureTool,
  clipboardReadTool,
  clipboardWriteTool,
  notifyTool,
];

/**
 * Register all built-in tools
 */
export function registerBuiltinTools(): void {
  const registry = getToolRegistry();
  for (const tool of builtinTools) {
    registry.register(tool);
  }
}
