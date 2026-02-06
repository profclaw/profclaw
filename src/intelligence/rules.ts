/**
 * Rules Engine for Pattern-Based Inference
 *
 * Zero-cost intelligence layer that handles ~70% of inference needs
 * without requiring any LLM calls.
 *
 * Uses deterministic rules to infer:
 * - Task type from file paths
 * - Action type from tool usage
 * - Issue/PR links from content
 * - Commit messages from git commands
 */

import type { HookInference } from '../hooks/types.js';
import type { PostToolUsePayload, BashToolInput } from '../hooks/schemas.js';

// File Path Patterns

// Pre-compiled patterns at module scope for performance
const PATH_PATTERNS = {
  auth: /\/(auth|login|logout|session|oauth|jwt|token)\//i,
  api: /\/(api|routes|endpoints|handlers|controllers)\//i,
  db: /\/(db|database|models|schema|migrations|drizzle)\//i,
  test: /\.(test|spec|e2e)\.(ts|tsx|js|jsx)$/i,
  config: /\/(config|settings|env|\.env)/i,
  ui: /\/(components|pages|views|screens|ui)\//i,
  hooks: /\/hooks\//i,
  utils: /\/(utils|helpers|lib|common)\//i,
  types: /\/(types|interfaces|schemas)\//i,
  docs: /\.(md|mdx|rst|txt)$/i,
  styles: /\.(css|scss|sass|less|styled)\./i,
} as const;

const COMPONENT_PATTERNS = {
  authentication: PATH_PATTERNS.auth,
  api: PATH_PATTERNS.api,
  database: PATH_PATTERNS.db,
  testing: PATH_PATTERNS.test,
  configuration: PATH_PATTERNS.config,
  frontend: PATH_PATTERNS.ui,
  hooks: PATH_PATTERNS.hooks,
  utilities: PATH_PATTERNS.utils,
  types: PATH_PATTERNS.types,
  documentation: PATH_PATTERNS.docs,
  styling: PATH_PATTERNS.styles,
} as const;

// Issue/PR Patterns

const ISSUE_PATTERN = /#(\d+)/g;
const PR_PATTERN = /(?:pull\/|pr\/|PR\s*#?)(\d+)/gi;
const BRANCH_ISSUE_PATTERN = /(?:feat|fix|issue|bug)[/-](\d+)/i;

// Git command patterns
const GIT_COMMIT_PATTERN = /git\s+commit\s+(?:-m\s+)?["']([^"']+)["']/i;
const GIT_PUSH_PATTERN = /git\s+push/i;
const GIT_BRANCH_PATTERN = /git\s+(?:checkout|switch)\s+(?:-[bB]\s+)?(\S+)/i;

// Main Inference Functions

/**
 * Infer task metadata from a PostToolUse hook payload
 */
export function inferFromToolUse(payload: PostToolUsePayload): HookInference {
  const inference: HookInference = {
    confidence: 0,
  };

  // Extract file path if available
  const filePath = extractFilePath(payload);
  if (filePath) {
    const pathInferences = inferFromFilePath(filePath);
    Object.assign(inference, pathInferences);
  }

  // Infer action from tool type
  const action = inferActionFromTool(payload.tool);
  if (action) {
    inference.taskType = inference.taskType || action;
  }

  // Check for issue/PR links in content
  const content = extractContent(payload);
  if (content) {
    const links = extractLinks(content);
    Object.assign(inference, links);
  }

  // Handle Bash commands specially
  if (payload.tool === 'Bash') {
    const bashInferences = inferFromBashCommand(payload.input as BashToolInput);
    Object.assign(inference, bashInferences);
  }

  // Calculate confidence based on how many inferences we made
  inference.confidence = calculateConfidence(inference);

  return inference;
}

/**
 * Infer task type and component from file path
 */
export function inferFromFilePath(filePath: string): Partial<HookInference> {
  const result: Partial<HookInference> = {};

  // Check for task type patterns
  for (const [component, pattern] of Object.entries(COMPONENT_PATTERNS)) {
    if (pattern.test(filePath)) {
      result.component = component;
      result.taskType = mapComponentToTaskType(component);
      break;
    }
  }

  // Check for issue number in path
  const branchMatch = filePath.match(BRANCH_ISSUE_PATTERN);
  if (branchMatch) {
    result.linkedIssue = branchMatch[1];
  }

  return result;
}

/**
 * Infer action type from tool name
 */
export function inferActionFromTool(tool: string): string | undefined {
  const toolActions: Record<string, string> = {
    Edit: 'modify',
    Write: 'create',
    Read: 'read',
    Bash: 'execute',
    Glob: 'search',
    Grep: 'search',
    Delete: 'delete',
    TodoWrite: 'planning',
    Task: 'orchestration',
  };

  return toolActions[tool];
}

/**
 * Infer from Bash command content
 */
export function inferFromBashCommand(input: BashToolInput): Partial<HookInference> {
  const result: Partial<HookInference> = {};
  const command = input.command;

  // Extract commit message
  const commitMatch = command.match(GIT_COMMIT_PATTERN);
  if (commitMatch) {
    result.commitMessage = commitMatch[1];
    result.taskType = 'commit';

    // Try to extract issue from commit message (use exec for capture groups with global regex)
    ISSUE_PATTERN.lastIndex = 0;
    const issueMatch = ISSUE_PATTERN.exec(commitMatch[1]);
    if (issueMatch) {
      result.linkedIssue = issueMatch[1];
    }
  }

  // Check for push (indicates PR might follow)
  if (GIT_PUSH_PATTERN.test(command)) {
    result.taskType = 'push';
  }

  // Extract branch name
  const branchMatch = command.match(GIT_BRANCH_PATTERN);
  if (branchMatch) {
    const branchName = branchMatch[1];
    const issueInBranch = branchName.match(BRANCH_ISSUE_PATTERN);
    if (issueInBranch) {
      result.linkedIssue = issueInBranch[1];
    }
  }

  // Detect test runs
  if (/(?:npm|pnpm|yarn)\s+(?:run\s+)?test/i.test(command)) {
    result.taskType = 'testing';
  }

  // Detect build commands
  if (/(?:npm|pnpm|yarn)\s+(?:run\s+)?build/i.test(command)) {
    result.taskType = 'build';
  }

  // Detect lint commands
  if (/(?:npm|pnpm|yarn)\s+(?:run\s+)?lint/i.test(command)) {
    result.taskType = 'lint';
  }

  return result;
}

/**
 * Extract issue and PR links from text content
 */
export function extractLinks(content: string): Partial<HookInference> {
  const result: Partial<HookInference> = {};

  // Find issue references
  ISSUE_PATTERN.lastIndex = 0;
  const issueMatch = ISSUE_PATTERN.exec(content);
  if (issueMatch) {
    result.linkedIssue = issueMatch[1];
  }

  // Find PR references
  PR_PATTERN.lastIndex = 0;
  const prMatch = PR_PATTERN.exec(content);
  if (prMatch) {
    result.linkedPr = prMatch[1];
  }

  return result;
}

// Helper Functions

/**
 * Extract file path from hook payload input
 */
function extractFilePath(payload: PostToolUsePayload): string | undefined {
  const input = payload.input as Record<string, unknown>;
  return (input.file_path || input.path) as string | undefined;
}

/**
 * Extract relevant content from payload for link detection
 */
function extractContent(payload: PostToolUsePayload): string {
  const parts: string[] = [];
  const input = payload.input as Record<string, unknown>;

  // Add file path
  if (input.file_path) parts.push(String(input.file_path));

  // Add old/new strings from Edit
  if (input.old_string) parts.push(String(input.old_string));
  if (input.new_string) parts.push(String(input.new_string));

  // Add content from Write
  if (input.content) parts.push(String(input.content));

  // Add command from Bash
  if (input.command) parts.push(String(input.command));

  return parts.join(' ');
}

/**
 * Map component type to task type
 */
function mapComponentToTaskType(component: string): string {
  const mapping: Record<string, string> = {
    authentication: 'security',
    api: 'backend',
    database: 'data',
    testing: 'quality',
    configuration: 'config',
    frontend: 'ui',
    hooks: 'logic',
    utilities: 'refactor',
    types: 'types',
    documentation: 'docs',
    styling: 'ui',
  };

  return mapping[component] || 'general';
}

/**
 * Calculate confidence score based on inferences
 */
function calculateConfidence(inference: HookInference): number {
  let score = 0;

  if (inference.taskType) score += 0.3;
  if (inference.component) score += 0.2;
  if (inference.linkedIssue) score += 0.25;
  if (inference.linkedPr) score += 0.15;
  if (inference.commitMessage) score += 0.1;

  return Math.min(score, 1);
}

// Aggregate Inference

/**
 * Combine multiple hook inferences into a session-level inference
 */
export function aggregateInferences(inferences: HookInference[]): HookInference {
  if (inferences.length === 0) {
    return { confidence: 0 };
  }

  // Find most common task type
  const taskTypeCounts = new Map<string, number>();
  const componentCounts = new Map<string, number>();
  let linkedIssue: string | undefined;
  let linkedPr: string | undefined;
  let commitMessage: string | undefined;

  for (const inf of inferences) {
    if (inf.taskType) {
      taskTypeCounts.set(inf.taskType, (taskTypeCounts.get(inf.taskType) || 0) + 1);
    }
    if (inf.component) {
      componentCounts.set(inf.component, (componentCounts.get(inf.component) || 0) + 1);
    }
    // Take first found issue/PR
    if (!linkedIssue && inf.linkedIssue) linkedIssue = inf.linkedIssue;
    if (!linkedPr && inf.linkedPr) linkedPr = inf.linkedPr;
    // Take last commit message
    if (inf.commitMessage) commitMessage = inf.commitMessage;
  }

  // Get most common values
  const taskType = getMostCommon(taskTypeCounts);
  const component = getMostCommon(componentCounts);

  const result: HookInference = {
    taskType,
    component,
    linkedIssue,
    linkedPr,
    commitMessage,
    confidence: 0,
  };

  result.confidence = calculateConfidence(result);

  return result;
}

/**
 * Get the most common value from a count map
 */
function getMostCommon(counts: Map<string, number>): string | undefined {
  let maxCount = 0;
  let result: string | undefined;

  for (const [value, count] of counts) {
    if (count > maxCount) {
      maxCount = count;
      result = value;
    }
  }

  return result;
}
