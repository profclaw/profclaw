/**
 * Skills System
 *
 * Dynamic knowledge system for teaching AI about available capabilities.
 * Following OpenClaw's proven patterns.
 *
 * Skills are Markdown files (SKILL.md) that teach the AI:
 * - What tools are available
 * - How to use them
 * - Best practices and workflows
 *
 * This enables dynamic capability extension without hardcoding every tool.
 */

// TODO(@copilot): Generate unit tests for this module
// Key functions to test: parseFrontmatter, getMarkdownContent, resolveMetadata, resolveSkillInvocationPolicy, parseSkillFile, loadAllSkills, filterSkills, parseSkillMd, checkEligibility, hasBinary, buildSkillSnapshotSync, buildSkillsStatus, applySkillEnvOverrides, formatSkillsForPrompt, buildSkillSnapshot, buildSkillsPrompt, resolveSkillsPromptForRun, getSkillFromSnapshot, estimateSkillsTokenCost, getSkillsRegistry, initializeSkillsRegistry
// Test file location: src/skills/tests/index.test.ts

// Types
export * from './types.js';

// Frontmatter parsing
export {
  parseFrontmatter,
  getMarkdownContent,
  resolveMetadata,
  resolveSkillInvocationPolicy,
  parseSkillFile,
} from './frontmatter.js';

// Skill loading
export {
  loadAllSkills,
  filterSkills,
  parseSkillMd,
  checkEligibility,
  hasBinary,
  clearBinaryCache,
  buildSkillSnapshotSync,
  buildSkillsStatus,
  applySkillEnvOverrides,
} from './loader.js';

// Prompt building
export {
  formatSkillsForPrompt,
  buildSkillSnapshot,
  buildSkillsPrompt,
  resolveSkillsPromptForRun,
  getSkillFromSnapshot,
  estimateSkillsTokenCost,
} from './prompt-builder.js';

// Registry
export {
  SkillsRegistry,
  getSkillsRegistry,
  initializeSkillsRegistry,
  type MCPServerInfo,
} from './registry.js';
