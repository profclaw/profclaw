/**
 * Intelligence Module
 *
 * Tiered inference system for zero-cost smart decisions.
 * Priority: Rules Engine → Ollama → Copilot → Gemini
 */

export {
  inferFromToolUse,
  inferFromFilePath,
  inferActionFromTool,
  inferFromBashCommand,
  extractLinks,
  aggregateInferences,
} from './rules.js';
