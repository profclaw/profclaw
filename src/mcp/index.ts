/**
 * MCP Module
 *
 * Model Context Protocol server for Claude Code integration.
 * Run as a separate process, not imported into the main server.
 *
 * Usage:
 *   npx @profclaw/profclaw-mcp
 *   node dist/mcp/server.js
 */

// TODO(@copilot): Generate unit tests for this module
// Key functions to test: MCP server exports from server.js
// Test file location: src/mcp/tests/index.test.ts
// Note: This module is a wrapper for the MCP server - test the actual server.js implementation

// Re-export for programmatic usage if needed
export * from './server.js';
