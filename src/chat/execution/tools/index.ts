/**
 * Built-in Tools
 *
 * Export all built-in tools and registration function.
 */

import { getToolRegistry } from '../registry.js';
import type { ToolDefinition, ToolTier } from '../types.js';
import { hasCapability } from '../../../core/deployment.js';

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
import { cronTools } from './cron-tool.js';

// profClaw ops tools (ticket, project management)
import { profclawTools } from './profclaw-ops.js';

// Browser tools
import { browserTools } from './browser.js';

// Canvas tools
import { canvasRenderTool } from './canvas.js';

// Session spawn tools (hierarchical agent sessions)
import { sessionSpawnTools } from './session-spawn.js';

// Integration tools (screen capture, clipboard, notifications)
import { screenCaptureTool, clipboardReadTool, clipboardWriteTool, notifyTool } from './integrations.js';

// Feed tools
import { feedTools } from './feed-tools.js';

// Code tools (typecheck, lint, build, format, project_info, create_pr)
import { codeTools } from './code-tools.js';

// Multi-file patch tool
import { multiPatchTool } from './multi-patch.js';

// Phase 3 parity tools
import { openaiImageGenTool } from './openai-image-gen.js';
import { ttsSpeakTool } from './tts-speak.js';
import { linkUnderstandTool } from './link-understand.js';
import { subagentOrchestrateTool } from './subagent-orchestrate.js';
import { discordActionsTool } from './discord-actions.js';
import { slackActionsTool } from './slack-actions.js';
import { telegramActionsTool } from './telegram-actions.js';

// Export individual tools
export { execTool } from './exec.js';
export { webFetchTool } from './web-fetch.js';
export { readFileTool, writeFileTool, searchFilesTool, grepTool, editFileTool, directoryTreeTool, patchApplyTool } from './file-ops.js';
export { multiPatchTool } from './multi-patch.js';
export type { MultiPatchParams, MultiPatchResult, MultiPatchFileResult } from './multi-patch.js';

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

// Code tools exports
export {
  typeCheckTool,
  lintTool,
  buildTool,
  formatTool,
  projectInfoTool,
  createPrTool,
  codeTools,
} from './code-tools.js';

// Feed tools exports
export {
  feedListTool,
  feedAddTool,
  feedBundleInstallTool,
  feedPollTool,
  feedDigestTool,
  feedDiscoverTool,
  feedTools,
} from './feed-tools.js';

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

// Phase 3 parity tools exports
export { openaiImageGenTool, setImageGenConfig, getImageGenConfig } from './openai-image-gen.js';
export type { ImageGenResult } from './openai-image-gen.js';
export { ttsSpeakTool } from './tts-speak.js';
export type { TtsSpeakResult } from './tts-speak.js';
export { linkUnderstandTool } from './link-understand.js';
export type { LinkUnderstandResult } from './link-understand.js';
export { subagentOrchestrateTool } from './subagent-orchestrate.js';
export type { SubagentOrchestrateResult, SubtaskResult } from './subagent-orchestrate.js';
export { discordActionsTool } from './discord-actions.js';
export type { DiscordActionsResult } from './discord-actions.js';
export { slackActionsTool } from './slack-actions.js';
export type { SlackActionsResult } from './slack-actions.js';
export { telegramActionsTool } from './telegram-actions.js';
export type { TelegramActionsResult } from './telegram-actions.js';

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

// Tool Tier Assignments

/**
 * Tool tier map: assigns each tool to essential/standard/full tier.
 *
 * Essential (10): Core tools any model can use reliably.
 *   read_file, write_file, edit_file, exec, grep, search_files,
 *   directory_tree, git_status, web_fetch, complete_task
 *
 * Standard (25): Need moderate reasoning. Good for 14B+ models.
 *   All essential + git ops, memory, system, web_search, profclaw ops, test_run
 *
 * Full (72): Everything. Only for frontier models (Claude, GPT-4, etc.)
 *   All standard + browser, cron, sessions, integrations, media, subagent
 */
const TOOL_TIER_MAP: Record<string, ToolTier> = {
  // Essential tier - works with any model
  read_file: 'essential',
  write_file: 'essential',
  edit_file: 'essential',
  exec: 'essential',
  grep: 'essential',
  search_files: 'essential',
  directory_tree: 'essential',
  git_status: 'essential',
  web_fetch: 'essential',
  complete_task: 'essential',

  // Standard tier - needs moderate reasoning (14B+)
  git_diff: 'standard',
  git_log: 'standard',
  git_commit: 'standard',
  git_branch: 'standard',
  patch_apply: 'standard',
  multi_patch: 'standard',
  web_search: 'essential',
  memory_search: 'standard',
  memory_get: 'standard',
  memory_stats: 'standard',
  env: 'standard',
  system_info: 'standard',
  path_info: 'standard',
  which: 'standard',
  create_ticket: 'standard',
  list_tickets: 'standard',
  update_ticket: 'standard',
  get_ticket: 'standard',
  create_project: 'standard',
  list_projects: 'standard',
  test_run: 'standard',
  image_analyze: 'standard',
  link_understand: 'standard',
  github_pr: 'standard',
  notify: 'standard',
  feed_list: 'standard',
  feed_add: 'standard',
  feed_bundle_install: 'standard',
  feed_poll: 'standard',
  feed_digest: 'standard',
  feed_discover: 'standard',
  typecheck: 'standard',
  lint: 'standard',
  build: 'standard',
  format: 'standard',
  project_info: 'essential',
  create_pr: 'standard',

  // Full tier - only for large/frontier models (everything else)
  // git_stash, git_remote, canvas_render, all session tools,
  // all browser tools, all cron tools, all integration tools,
  // all media tools, all channel-specific tools, subagent, maintenance
};

/** Apply tier assignments to an array of tool definitions */
function applyTiers(tools: ToolDefinition[]): ToolDefinition[] {
  return tools.map((tool) => {
    const tier = TOOL_TIER_MAP[tool.name] ?? 'full';
    return Object.assign(tool, { tier });
  });
}

// All built-in tools (typed as generic ToolDefinition array)
const rawBuiltinTools = [
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
  multiPatchTool,
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
  // Feed tools (6)
  ...feedTools,
  // Code tools (6) - typecheck, lint, build, format, project_info, create_pr
  ...codeTools,
  // Phase 3 parity tools (7)
  openaiImageGenTool,
  ttsSpeakTool,
  linkUnderstandTool,
  subagentOrchestrateTool,
  discordActionsTool,
  slackActionsTool,
  telegramActionsTool,
] as unknown as ToolDefinition[];

// Apply tier assignments to all tools
export const builtinTools: ToolDefinition[] = applyTiers(rawBuiltinTools);

/** Tool names that require specific deployment mode capabilities */
const BROWSER_TOOL_NAMES = new Set([
  'browser_navigate', 'browser_snapshot', 'browser_click', 'browser_type',
  'browser_search', 'browser_screenshot', 'browser_pages', 'browser_close',
]);

const CRON_TOOL_NAMES = new Set([
  'cron_create', 'cron_list', 'cron_trigger', 'cron_pause',
  'cron_archive', 'cron_delete', 'cron_history',
]);

const FEED_TOOL_NAMES = new Set([
  'feed_list', 'feed_add', 'feed_bundle_install', 'feed_poll',
  'feed_digest', 'feed_discover',
]);

const CHANNEL_TOOL_NAMES = new Set([
  'discord_actions', 'slack_actions', 'telegram_actions',
]);

const INTEGRATION_TOOL_NAMES = new Set([
  'create_ticket', 'list_tickets', 'update_ticket', 'get_ticket',
  'create_project', 'list_projects',
]);

/**
 * Register all built-in tools (with tier assignments and mode gating)
 */
export function registerBuiltinTools(): void {
  const registry = getToolRegistry();

  const modeFilteredTools = builtinTools.filter((tool) => {
    // Browser tools: pro only (browser_tools capability)
    if (BROWSER_TOOL_NAMES.has(tool.name)) return hasCapability('browser_tools');
    // Cron tools: mini+ (cron capability)
    if (CRON_TOOL_NAMES.has(tool.name)) return hasCapability('cron');
    // Feed tools: mini+ (cron capability - feeds are part of automation)
    if (FEED_TOOL_NAMES.has(tool.name)) return hasCapability('cron');
    // Channel action tools: mini+ (chat_channels capability)
    if (CHANNEL_TOOL_NAMES.has(tool.name)) return hasCapability('chat_channels');
    // Integration tools: mini+ (integrations capability)
    if (INTEGRATION_TOOL_NAMES.has(tool.name)) return hasCapability('integrations');
    // Screen capture: pro only (sandbox_full capability)
    if (tool.name === 'screen_capture') return hasCapability('sandbox_full');
    // Canvas render: pro only (browser_tools - needs headless browser)
    if (tool.name === 'canvas_render') return hasCapability('browser_tools');
    // Everything else: always available
    return true;
  });

  for (const tool of modeFilteredTools) {
    registry.register(tool as unknown as ToolDefinition<never, unknown>);
  }
}
