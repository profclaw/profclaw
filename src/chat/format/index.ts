/**
 * Chat Format Module
 *
 * Shared formatters for tool results across web UI and messaging channels.
 */

export {
  formatToolResult,
  type ChannelFormat,
  type FormattedToolResult,
} from './tool-result-formatter.js';

export {
  convertMarkdown,
  stripMarkdown,
  type FormatTarget,
} from './markdown-convert.js';
