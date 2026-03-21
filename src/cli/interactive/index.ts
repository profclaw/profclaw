/**
 * profClaw Interactive CLI
 *
 * Claude-like interactive chat with streaming responses, tool display,
 * markdown rendering, slash commands, and session management.
 *
 * Designed as a self-contained module that can be extracted to its own
 * package in the future (e.g., @profclaw/interactive or profclaw-cli).
 *
 * Dependencies (all peer/optional in standalone mode):
 *   - chalk (terminal colors)
 *   - ora (spinners)
 *   - node:readline (input)
 *   - node:fs (history persistence)
 *
 * @package profclaw-interactive
 */

export { startInteractiveREPL } from './repl.js';
export { createRenderer, renderMarkdownLite, formatElapsed, formatTokens, highlightCode } from './renderer.js';
export { streamChat, createConversation, sendMessage } from './stream-client.js';
export { ensureServer, checkServer, autoStartServer } from './auto-serve.js';
export { showPicker } from './picker.js';
export type { PickerItem, PickerOptions } from './picker.js';

export type {
  InteractiveOptions,
  REPLState,
  SlashCommand,
  ServerConfig,
  Session,
  ChatMessage,
  ToolCallInfo,
  TokenUsage,
  SSEEvent,
  SSEEventType,
  Renderer,
} from './types.js';
