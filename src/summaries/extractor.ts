/**
 * Summary Extractor
 *
 * Extracts structured summaries from agent outputs without
 * requiring additional AI calls (zero-cost extraction).
 */

import type {
  CreateSummaryInput,
  FileChange,
  Decision,
  Blocker,
  ArtifactReference,
} from '../types/summary.js';
import type { TaskResult, TaskArtifact } from '../types/task.js';
import type { SessionAggregate, HookInference } from '../hooks/types.js';
import { getSettings } from '../settings/index.js';
import { getOllamaService } from '../intelligence/ollama.js';

// ============================================================================
// Patterns for extraction
// ============================================================================

export const FILE_CREATED_PATTERN = /(?:created?|added?|wrote?|new file)[:\s]+[`"']?([a-zA-Z0-9_\-\.\/]+\.[a-z0-9]+|(?:\.[a-z0-9_\-]+))[`"']?/gi;
export const FILE_MODIFIED_PATTERN = /(?:modified?|updated?|changed?|edited?|wrote?)[:\s]+[`"']?([a-zA-Z0-9_\-\.\/]+\.[a-z0-9]+|(?:\.[a-z0-9_\-]+))[`"']?/gi;
export const FILE_DELETED_PATTERN = /(?:deleted?|removed?)[:\s]+[`"']?([a-zA-Z0-9_\-\.\/]+\.[a-z0-9]+|(?:\.[a-z0-9_\-]+))[`"']?/gi;

export const COMMIT_SHA_PATTERN = /\b([a-f0-9]{7,40})\b/g;
export const PR_URL_PATTERN = /https:\/\/(?:github\.com|gitlab\.com)\/[^/]+\/[^/]+\/(?:pull|merge_requests)\/(\d+)/gi;
export const GITHUB_ISSUE_PATTERN = /#(\d+)/g;
export const GENERIC_ISSUE_PATTERN = /\b([A-Z]{2,10}-\d+)\b/g;
export const BRANCH_PATTERN = /(?:branch|checkout|switch|on)[:\s]+[`"']?([a-zA-Z0-9_\-./]+)[`"']?/gi;

export const DECISION_PATTERNS = [
  /(?:decided?|chose?|opted?|selected?|used|implemented)(?:\s+to)?[:\s]+(.+?)(?:\.|\n|$)/gi,
  /(?:instead of|rather than)[:\s]+(.+?)(?:,|\.|\n|$)/gi,
];

export const ERROR_PATTERN = /(?:error|failed?|couldn't|cannot|issue)[:\s]+(.+?)(?:\.|$)/gi;
export const WARNING_PATTERN = /(?:warning|warn|caution)[:\s]+(.+?)(?:\.|$)/gi;

export const SUMMARY_SECTION_PATTERN = /##?\s*(?:summary|what changed|changes)[:\s]*\n([\s\S]*?)(?=\n##|$)/i;
export const WHY_SECTION_PATTERN = /##?\s*(?:why|motivation|reason)[:\s]*\n([\s\S]*?)(?=\n##|$)/i;
export const HOW_SECTION_PATTERN = /##?\s*(?:how|approach|implementation)[:\s]*\n([\s\S]*?)(?=\n##|$)/i;

const TASK_TYPE_KEYWORDS: Record<string, string[]> = {
  bug_fix: ['fix', 'bug', 'issue', 'error', 'crash', 'broken', 'repair', 'patch', 'resolve'],
  feature: ['add', 'new', 'implement', 'create', 'feature', 'introduce', 'enable'],
  refactor: ['refactor', 'restructure', 'reorganize', 'clean', 'improve', 'simplify', 'extract'],
  documentation: ['docs', 'documentation', 'readme', 'comment', 'jsdoc', 'typedoc', 'explain'],
  test: ['test', 'spec', 'coverage', 'mock', 'stub', 'jest', 'vitest', 'testing'],
  performance: ['performance', 'perf', 'speed', 'optimize', 'cache', 'lazy', 'faster', 'memory'],
  security: ['security', 'auth', 'password', 'permission', 'vulnerability', 'xss', 'csrf', 'token', 'encrypt'],
  chore: ['chore', 'upgrade', 'dependency', 'package', 'version', 'config', 'lint', 'build', 'gitignore'],
};

const COMPONENT_PATTERNS: Array<{ pattern: RegExp; component: string }> = [
  { pattern: /\/(components?|ui)\//i, component: 'ui' },
  { pattern: /\/(views?|pages?|screens?)\//i, component: 'views' },
  { pattern: /\/(api|routes?|endpoints?)\//i, component: 'api' },
  { pattern: /\/(utils?|helpers?|lib)\//i, component: 'utils' },
  { pattern: /\/(hooks?)\//i, component: 'hooks' },
  { pattern: /\/(store|state|redux|context)\//i, component: 'state' },
  { pattern: /\/(types?|interfaces?)\//i, component: 'types' },
  { pattern: /\/(tests?|specs?|__tests__)\//i, component: 'tests' },
  { pattern: /\/(styles?|css|scss)\//i, component: 'styles' },
  { pattern: /\/(auth|authentication|login)\//i, component: 'auth' },
  { pattern: /\/(database|db|storage|models?)\//i, component: 'database' },
  { pattern: /\/(config|settings)\//i, component: 'config' },
];

/**
 * Extract a summary from a task result
 */
export async function extractFromTaskResult(
  result: TaskResult,
  context?: {
    taskId?: string;
    agent?: string;
    model?: string;
    startedAt?: Date;
  }
): Promise<CreateSummaryInput> {
  const settings = await getSettings();
  if (settings.aiProvider?.defaultProvider === 'ollama') {
      const ollama = getOllamaService();
      const summary = await ollama.generateSummary(result, { taskId: context?.taskId, agent: context?.agent, model: context?.model });
      return {
          ...summary,
          taskId: context?.taskId,
          agent: context?.agent || 'ollama',
          model: context?.model,
          rawOutput: result.output,
      } as CreateSummaryInput;
  }

  const output = result.output || '';
  const summary = extractFromRawOutput(output, {
    taskId: context?.taskId,
    agent: context?.agent,
    model: context?.model,
  });

  if (result.error) {
    summary.blockers = [
      ...(summary.blockers || []),
      { description: result.error.message, severity: 'error', resolved: false },
    ];
  }

  return summary;
}

/**
 * Extract a summary from session aggregate
 */
export function extractFromSession(
  session: SessionAggregate,
  inference?: HookInference
): CreateSummaryInput {
  let filesChanged: FileChange[] = [];
  
  if (session.filesCreated?.length || session.filesModified?.length) {
      filesChanged = [
          ...(session.filesCreated || []).map(path => ({ path, action: 'created' as const })),
          ...(session.filesModified || []).map(path => ({ path, action: 'modified' as const }))
      ];
  } else if (session.summary) {
      filesChanged = extractFileChanges(session.summary);
  }

  const artifacts = session.summary ? extractArtifacts(session.summary) : [];
  
  const whatChanged = inference?.commitMessage
    || (session.summary ? generateWhatChanged(filesChanged, artifacts) : 'Session activity');
    
  const taskType = inference?.taskType || (session.summary ? inferTaskType(session.summary, filesChanged) : 'chore');
  const title = (inference as any)?.commitMessage || generateSmartTitle(whatChanged, filesChanged, artifacts, taskType);

  return {
    sessionId: session.sessionId,
    agent: 'claude-code',
    startedAt: session.startTime,
    completedAt: session.endTime,
    durationMs: session.endTime && session.startTime
      ? session.endTime.getTime() - session.startTime.getTime()
      : undefined,
    title,
    whatChanged,
    filesChanged,
    taskType,
    component: inference?.component,
    linkedIssue: inference?.linkedIssue,
    linkedPr: inference?.linkedPr,
  };
}

/**
 * Extract a summary from raw agent output
 */
export function extractFromRawOutput(
  output: string,
  context?: {
    agent?: string;
    model?: string;
    taskId?: string;
    sessionId?: string;
  }
): CreateSummaryInput {
  const filesChanged = extractFileChanges(output);
  const decisions = extractDecisions(output);
  const blockers = extractBlockers(output);
  const artifacts = extractArtifacts(output);

  const whatChanged = extractSection(output, SUMMARY_SECTION_PATTERN) ||
    generateWhatChanged(filesChanged, artifacts);
  const whyChanged = extractSection(output, WHY_SECTION_PATTERN);
  const howChanged = extractSection(output, HOW_SECTION_PATTERN);

  const taskType = inferTaskType(output, filesChanged);
  const component = inferComponent(filesChanged);
  const title = generateSmartTitle(whatChanged, filesChanged, artifacts, taskType);

  const linkedPr = artifacts.find(a => a.type === 'pull_request')?.url;
  const linkedIssue = artifacts.find(a => a.identifier && /^[A-Z]{2,10}-\d+$/.test(a.identifier))?.identifier 
                    || artifacts.find(a => a.type === 'other' && a.title === 'Issue')?.identifier;

  return {
    taskId: context?.taskId,
    sessionId: context?.sessionId,
    agent: context?.agent || 'unknown',
    model: context?.model,
    title,
    whatChanged,
    whyChanged,
    howChanged,
    filesChanged,
    decisions,
    blockers,
    artifacts,
    taskType,
    component,
    linkedIssue,
    linkedPr,
    rawOutput: output,
  };
}

export function extractFileChanges(output: string, artifacts?: TaskArtifact[]): FileChange[] {
  const changes: FileChange[] = [];
  const seen = new Set<string>();

  if (artifacts) {
    for (const a of artifacts) {
      if (a.type === 'file' && a.path && !seen.has(a.path)) {
        seen.add(a.path);
        changes.push({ path: a.path, action: 'modified' });
      }
    }
  }

  const addFromPattern = (pattern: RegExp, action: FileChange['action']) => {
    let match;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(output)) !== null) {
      const path = match[1];
      if (path && !seen.has(path) && isValidFilePath(path)) {
        seen.add(path);
        changes.push({ path, action });
      }
    }
  };

  addFromPattern(FILE_CREATED_PATTERN, 'created');
  addFromPattern(FILE_MODIFIED_PATTERN, 'modified');
  addFromPattern(FILE_DELETED_PATTERN, 'deleted');
  return changes;
}

export function extractDecisions(output: string): Decision[] {
  const decisions: Decision[] = [];
  for (const pattern of DECISION_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(output)) !== null) {
      const description = match[1].trim();
      if (description.length > 5 && description.length < 500) {
        decisions.push({ description });
      }
    }
  }
  return decisions.slice(0, 10);
}

export function extractBlockers(output: string, error?: TaskResult['error']): Blocker[] {
  const blockers: Blocker[] = [];
  if (error) {
    blockers.push({ description: error.message, severity: 'error', resolved: false });
  }
  ERROR_PATTERN.lastIndex = 0;
  let match;
  while ((match = ERROR_PATTERN.exec(output)) !== null) {
    const d = match[1].trim();
    if (d.length > 2) blockers.push({ description: d, severity: 'error', resolved: true });
  }
  WARNING_PATTERN.lastIndex = 0;
  while ((match = WARNING_PATTERN.exec(output)) !== null) {
    const d = match[1].trim();
    if (d.length > 2) blockers.push({ description: d, severity: 'warning', resolved: true });
  }
  return blockers.slice(0, 10);
}

export function extractArtifacts(output: string, taskArtifacts?: TaskArtifact[]): ArtifactReference[] {
  const artifacts: ArtifactReference[] = [];
  const seen = new Set<string>();

  if (taskArtifacts) {
    for (const a of taskArtifacts) {
      const key = `${a.type}:${a.url || a.sha || a.path}`;
      if (!seen.has(key)) {
        seen.add(key);
        artifacts.push({ type: a.type, url: a.url, identifier: a.sha });
      }
    }
  }

  PR_URL_PATTERN.lastIndex = 0;
  let match;
  while ((match = PR_URL_PATTERN.exec(output)) !== null) {
    const key = `pr:${match[1]}`;
    if (!seen.has(key)) {
      seen.add(key);
      artifacts.push({ type: 'pull_request', url: match[0], identifier: match[1] });
    }
  }

  COMMIT_SHA_PATTERN.lastIndex = 0;
  while ((match = COMMIT_SHA_PATTERN.exec(output)) !== null) {
    const sha = match[1];
    if (sha.length >= 7 && !seen.has(`commit:${sha}`)) {
        seen.add(`commit:${sha}`);
        artifacts.push({ type: 'commit', identifier: sha });
    }
  }

  GENERIC_ISSUE_PATTERN.lastIndex = 0;
  while ((match = GENERIC_ISSUE_PATTERN.exec(output)) !== null) {
    const issueId = match[1];
    if (!seen.has(`issue:${issueId}`)) {
      seen.add(`issue:${issueId}`);
      artifacts.push({ type: 'other', identifier: issueId, title: 'Issue' });
    }
  }

  return artifacts;
}

export function extractSection(output: string, pattern: RegExp): string | undefined {
  const match = output.match(pattern);
  return match && match[1] ? match[1].trim().slice(0, 1000) : undefined;
}

export function generateWhatChanged(files: FileChange[], artifacts: ArtifactReference[]): string {
  const parts: string[] = [];
  const created = files.filter(f => f.action === 'created');
  const modified = files.filter(f => f.action === 'modified');
  const deleted = files.filter(f => f.action === 'deleted');

  if (created.length > 0) parts.push(`Created ${created.length} file(s)`);
  if (modified.length > 0) parts.push(`Modified ${modified.length} file(s)`);
  if (deleted.length > 0) parts.push(`Deleted ${deleted.length} file(s)`);

  const prs = artifacts.filter(a => a.type === 'pull_request');
  if (prs.length > 0) parts.push(`Created ${prs.length} PR(s)`);

  return parts.join('. ') || 'No changes detected';
}

export function isValidFilePath(path: string): boolean {
  const hasExtension = /\.[a-zA-Z0-9]+$/.test(path);
  const isConfig = /^\.?[a-zA-Z]+rc|config|package\.json|tsconfig|\.gitignore/i.test(path);
  const isValidChars = /^[a-zA-Z0-9_./-]+$/.test(path);
  return isValidChars && (hasExtension || isConfig) && path.length < 200;
}

export function inferTaskType(output: string, files: FileChange[], title?: string): string {
  const text = `${title || ''} ${output}`.toLowerCase();
  const scores: Record<string, number> = {};
  for (const [taskType, keywords] of Object.entries(TASK_TYPE_KEYWORDS)) {
    scores[taskType] = 0;
    for (const keyword of keywords) {
      const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
      const matches = text.match(regex);
      if (matches) scores[taskType] += matches.length;
    }
  }
  for (const file of files) {
    if (/\.test\.|\.spec\.|__tests__/i.test(file.path)) scores.test = (scores.test || 0) + 2;
    if (/\.md$|readme|docs?\//i.test(file.path)) scores.documentation = (scores.documentation || 0) + 2;
    if (/\.gitignore|config|package\.json/i.test(file.path)) scores.chore = (scores.chore || 0) + 2;
  }
  let max = 0, type = 'feature';
  for (const [t, s] of Object.entries(scores)) {
    if (s > max) { max = s; type = t; }
  }
  return max > 0 ? type : 'feature';
}

export function inferComponent(files: FileChange[]): string | undefined {
  if (files.length === 0) return undefined;
  const counts: Record<string, number> = {};
  for (const file of files) {
    for (const { pattern, component } of COMPONENT_PATTERNS) {
      if (pattern.test(file.path)) {
        counts[component] = (counts[component] || 0) + 1;
        break;
      }
    }
  }
  let max = 0, primary;
  for (const [c, count] of Object.entries(counts)) {
    if (count > max) { max = count; primary = c; }
  }
  return primary;
}

export function generateSmartTitle(whatChanged: string, files: FileChange[], artifacts: ArtifactReference[], taskType: string): string {
  const typePrefix: Record<string, string> = {
    bug_fix: 'Fix',
    feature: 'Add',
    refactor: 'Refactor',
    documentation: 'Document',
    test: 'Test',
    performance: 'Optimize',
    security: 'Secure',
    chore: 'Update',
  };
  const prefix = typePrefix[taskType] || 'Update';

  if (files.length === 0 && artifacts.length > 0) {
    const pr = artifacts.find(a => a.type === 'pull_request');
    if (pr) return `Create PR #${pr.identifier}`;
  }

  if (files.length > 0) {
    const paths = files.map(f => f.path);
    const commonDir = findCommonDir(paths);
    if (commonDir && files.length > 1) {
       const dirName = commonDir.split('/').pop() || commonDir;
       return `${prefix} ${dirName} (${files.length} files)`;
    }
    const fileName = files[0].path.split('/').pop() || files[0].path;
    const cleanName = fileName.replace(/\.[^/.]+$/, '');
    return `${prefix} ${cleanName || fileName}`;
  }
  return prefix;
}

function findCommonDir(paths: string[]): string | undefined {
  if (paths.length <= 1) return undefined;
  const parts = paths[0].split('/');
  if (parts.length <= 1) return undefined;
  let common = parts.slice(0, -1);
  for (let i = 1; i < paths.length; i++) {
    const current = paths[i].split('/').slice(0, -1);
    let j = 0;
    while (j < common.length && j < current.length && common[j] === current[j]) j++;
    common = common.slice(0, j);
  }
  return common.length > 0 ? common.join('/') : undefined;
}
