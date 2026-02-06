import type { WorkflowDefinition } from './types.js';

/**
 * Built-in workflow templates for common development tasks.
 * These provide pre-built tool chains for small/local models that
 * cannot reason about multi-step workflows on their own.
 */
export const BUILT_IN_WORKFLOWS: WorkflowDefinition[] = [
  {
    id: 'deploy',
    name: 'Deploy',
    description: 'Full deployment pipeline: check status, pull latest, build, test, and deploy.',
    triggers: ['deploy', 'deployment', 'ship it', 'push to production', 'release', 'go live'],
    variables: {
      buildCommand: 'pnpm build',
      testCommand: 'pnpm test',
      deployCommand: 'docker compose up -d',
      branch: 'main',
    },
    steps: [
      {
        id: 'git-status',
        name: 'Check working tree is clean',
        tool: 'exec',
        params: { command: 'git status --porcelain' },
        captureOutput: 'gitStatus',
      },
      {
        id: 'git-pull',
        name: 'Pull latest changes',
        tool: 'exec',
        params: { command: 'git pull origin {{branch}}' },
        captureOutput: 'pullOutput',
      },
      {
        id: 'build',
        name: 'Build project',
        tool: 'exec',
        params: { command: '{{buildCommand}}' },
        captureOutput: 'buildOutput',
      },
      {
        id: 'test',
        name: 'Run tests',
        tool: 'exec',
        params: { command: '{{testCommand}}' },
        captureOutput: 'testOutput',
        continueOnError: true,
      },
      {
        id: 'deploy',
        name: 'Deploy application',
        tool: 'exec',
        params: { command: '{{deployCommand}}' },
        captureOutput: 'deployOutput',
      },
    ],
  },

  {
    id: 'code-review',
    name: 'Code Review',
    description: 'Review staged changes - diff analysis and file inspection for structured review.',
    triggers: [
      'code review',
      'review my changes',
      'review staged',
      'review diff',
      'check my code',
      'review pr',
    ],
    steps: [
      {
        id: 'staged-diff',
        name: 'Get staged diff',
        tool: 'exec',
        params: { command: 'git diff --staged' },
        captureOutput: 'stagedDiff',
      },
      {
        id: 'changed-files',
        name: 'List changed files',
        tool: 'exec',
        params: { command: 'git diff --staged --name-only' },
        captureOutput: 'changedFiles',
      },
      {
        id: 'recent-log',
        name: 'Check recent commit history',
        tool: 'exec',
        params: { command: 'git log -5 --oneline' },
        captureOutput: 'recentLog',
      },
    ],
  },

  {
    id: 'debug',
    name: 'Debug',
    description: 'Systematic debugging: check recent changes, find error patterns, locate TODOs.',
    triggers: [
      'debug',
      'investigate error',
      'find the bug',
      'why is it failing',
      'troubleshoot',
      'diagnose',
    ],
    variables: {
      errorPattern: 'error',
      searchDir: '.',
    },
    steps: [
      {
        id: 'recent-changes',
        name: 'Check recent commits',
        tool: 'exec',
        params: { command: 'git log -5 --oneline' },
        captureOutput: 'recentChanges',
      },
      {
        id: 'find-errors',
        name: 'Search for error pattern',
        tool: 'search_files',
        params: { pattern: '{{errorPattern}}', directory: '{{searchDir}}' },
        captureOutput: 'errorMatches',
        continueOnError: true,
      },
      {
        id: 'find-todos',
        name: 'Find TODOs and FIXMEs',
        tool: 'exec',
        params: { command: 'grep -rn "TODO\\|FIXME\\|HACK" {{searchDir}} --include="*.ts" --include="*.js" -l 2>/dev/null | head -20' },
        captureOutput: 'todoFiles',
        continueOnError: true,
      },
    ],
  },

  {
    id: 'research',
    name: 'Research',
    description: 'Web research workflow: search and fetch top result for summarized findings.',
    triggers: [
      'research',
      'look up',
      'find information about',
      'search the web for',
      'investigate',
      'what is',
    ],
    variables: {
      query: '',
    },
    steps: [
      {
        id: 'web-search',
        name: 'Search the web',
        tool: 'web_search',
        params: { query: '{{query}}' },
        captureOutput: 'searchResults',
      },
      {
        id: 'fetch-top',
        name: 'Fetch top result',
        tool: 'web_fetch',
        params: { url: '{{topResultUrl}}' },
        captureOutput: 'pageContent',
        continueOnError: true,
      },
    ],
  },

  {
    id: 'refactor',
    name: 'Refactor',
    description: 'Identify files needing refactoring based on a target pattern.',
    triggers: [
      'refactor',
      'clean up',
      'improve code',
      'find usages of',
      'replace all',
      'rename',
    ],
    variables: {
      targetPattern: '',
      searchDir: 'src',
    },
    steps: [
      {
        id: 'find-pattern',
        name: 'Find pattern occurrences',
        tool: 'search_files',
        params: { pattern: '{{targetPattern}}', directory: '{{searchDir}}' },
        captureOutput: 'patternMatches',
      },
      {
        id: 'list-affected',
        name: 'List affected files',
        tool: 'exec',
        params: { command: 'grep -rn "{{targetPattern}}" {{searchDir}} --include="*.ts" --include="*.tsx" -l 2>/dev/null' },
        captureOutput: 'affectedFiles',
        continueOnError: true,
      },
    ],
  },

  {
    id: 'test-and-fix',
    name: 'Test and Fix',
    description: 'Run tests, identify failures, and gather source context for fixing.',
    triggers: [
      'test and fix',
      'fix failing tests',
      'run tests and fix',
      'tests are failing',
      'fix tests',
    ],
    variables: {
      testCommand: 'pnpm test',
    },
    steps: [
      {
        id: 'run-tests',
        name: 'Run test suite',
        tool: 'exec',
        params: { command: '{{testCommand}} 2>&1' },
        captureOutput: 'testOutput',
        continueOnError: true,
      },
      {
        id: 'find-failing',
        name: 'Find failing test files',
        tool: 'search_files',
        params: { pattern: '{{failingTestPattern}}', directory: 'src' },
        captureOutput: 'failingFiles',
        continueOnError: true,
        condition: '{{testOutput}} !== ""',
      },
      {
        id: 'check-coverage',
        name: 'Check test coverage summary',
        tool: 'exec',
        params: { command: '{{testCommand}} --coverage --reporter=text 2>&1 | tail -30' },
        captureOutput: 'coverageOutput',
        continueOnError: true,
      },
    ],
  },
];

/** Look up a built-in workflow by ID */
export function getBuiltInWorkflow(id: string): WorkflowDefinition | undefined {
  return BUILT_IN_WORKFLOWS.find((w) => w.id === id);
}
