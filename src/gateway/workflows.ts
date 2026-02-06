import type { WorkflowTemplate, WorkflowType, WorkflowStep } from './types.js';

/**
 * Autonomous Workflow - Full development cycle
 *
 * Similar to OpenClaw's autonomous mode:
 * 1. Setup - Understand codebase and requirements
 * 2. Implement - Write the code
 * 3. Verify - Run tests and lint
 * 4. Commit - Create a git commit
 * 5. Push - Push changes and create PR
 */
const autonomousWorkflow: WorkflowTemplate = {
  type: 'autonomous',
  name: 'Autonomous Development',
  description: 'Full autonomous workflow: setup → implement → verify → commit → push',
  requiredCapabilities: ['code_generation', 'git_operations', 'file_operations'],
  defaultTimeoutMs: 10 * 60 * 1000, // 10 minutes
  continueOnFailure: false,
  steps: [
    {
      id: 'setup',
      name: 'Setup & Analysis',
      description: 'Analyze the codebase and understand requirements',
      order: 1,
      promptTemplate: `## Setup Phase

Analyze the following task and prepare for implementation:

**Task:** {{task.title}}
**Description:** {{task.description}}
**Prompt:** {{task.prompt}}

### Instructions:
1. Explore the relevant parts of the codebase
2. Identify files that need to be modified
3. Understand existing patterns and conventions
4. Create a mental model of the changes needed

### Expected Output:
- List of files to modify
- High-level implementation plan
- Any questions or clarifications needed`,
      expectedOutputs: ['files_to_modify', 'implementation_plan'],
      optional: false,
      maxRetries: 2,
      timeoutMs: 2 * 60 * 1000,
    },
    {
      id: 'implement',
      name: 'Implementation',
      description: 'Write the code changes',
      order: 2,
      promptTemplate: `## Implementation Phase

Now implement the following task:

**Task:** {{task.title}}
**Description:** {{task.description}}
**Prompt:** {{task.prompt}}

### Context from Setup:
{{previousStep.output}}

### Instructions:
1. Implement the changes following existing code patterns
2. Add appropriate comments where needed
3. Ensure code is clean and follows project conventions
4. Do not over-engineer - keep it simple

### Expected Output:
- Modified files with changes
- Brief explanation of what was changed`,
      expectedOutputs: ['files_changed', 'changes_summary'],
      optional: false,
      maxRetries: 3,
      timeoutMs: 5 * 60 * 1000,
    },
    {
      id: 'verify',
      name: 'Verification',
      description: 'Run tests and linting',
      order: 3,
      promptTemplate: `## Verification Phase

Verify the implementation is correct:

### Instructions:
1. Run the project's test suite
2. Run the linter (if available)
3. Fix any failing tests or lint errors
4. Ensure the build passes

### Commands to run:
- pnpm test (or npm test)
- pnpm lint (or npm run lint)
- pnpm build (or npm run build)

### Expected Output:
- Test results (pass/fail)
- Lint results
- Build status`,
      expectedOutputs: ['test_results', 'lint_results', 'build_status'],
      optional: false,
      maxRetries: 2,
      timeoutMs: 3 * 60 * 1000,
      validation: 'verifyTestsPass',
    },
    {
      id: 'commit',
      name: 'Git Commit',
      description: 'Create a git commit with the changes',
      order: 4,
      promptTemplate: `## Commit Phase

Create a git commit for the changes:

### Task Context:
**Task:** {{task.title}}
**Description:** {{task.description}}

### Instructions:
1. Stage the relevant files (not unrelated changes)
2. Write a clear, conventional commit message
3. Follow the format: type(scope): description
4. Include a body if the change is complex

### Expected Output:
- Commit hash
- Commit message`,
      expectedOutputs: ['commit_hash', 'commit_message'],
      optional: false,
      maxRetries: 1,
      timeoutMs: 30 * 1000,
    },
    {
      id: 'push',
      name: 'Push & PR',
      description: 'Push changes and optionally create a PR',
      order: 5,
      promptTemplate: `## Push Phase

Push the changes and optionally create a pull request:

### Task Context:
**Task:** {{task.title}}
**Task ID:** {{task.id}}

### Instructions:
1. Push the commit to the remote repository
2. If on a feature branch, create a pull request
3. Include a clear PR title and description
4. Link to any related issues

### Expected Output:
- Push status
- PR URL (if created)`,
      expectedOutputs: ['push_status', 'pr_url'],
      optional: true,
      maxRetries: 2,
      timeoutMs: 60 * 1000,
    },
  ],
};

/**
 * Bug Fix Workflow
 */
const fixWorkflow: WorkflowTemplate = {
  type: 'fix',
  name: 'Bug Fix',
  description: 'Focused workflow for fixing bugs',
  requiredCapabilities: ['bug_fix', 'code_generation'],
  defaultTimeoutMs: 8 * 60 * 1000,
  continueOnFailure: false,
  steps: [
    {
      id: 'diagnose',
      name: 'Diagnose',
      description: 'Understand and reproduce the bug',
      order: 1,
      promptTemplate: `## Bug Diagnosis

Analyze and understand this bug:

**Bug:** {{task.title}}
**Description:** {{task.description}}
**Details:** {{task.prompt}}

### Instructions:
1. Understand the expected vs actual behavior
2. Locate the source of the bug
3. Identify the root cause
4. Plan the minimal fix

### Expected Output:
- Root cause analysis
- File(s) containing the bug
- Proposed fix approach`,
      expectedOutputs: ['root_cause', 'affected_files', 'fix_approach'],
      optional: false,
      maxRetries: 2,
      timeoutMs: 2 * 60 * 1000,
    },
    {
      id: 'fix',
      name: 'Apply Fix',
      description: 'Implement the bug fix',
      order: 2,
      promptTemplate: `## Apply Bug Fix

Fix the bug based on diagnosis:

### Diagnosis:
{{previousStep.output}}

### Instructions:
1. Make the minimal change to fix the bug
2. Avoid refactoring unrelated code
3. Add a test case if appropriate
4. Ensure the fix doesn't break other functionality

### Expected Output:
- Files modified
- Brief explanation of the fix`,
      expectedOutputs: ['files_changed', 'fix_explanation'],
      optional: false,
      maxRetries: 3,
      timeoutMs: 4 * 60 * 1000,
    },
    {
      id: 'verify',
      name: 'Verify Fix',
      description: 'Ensure the bug is fixed',
      order: 3,
      promptTemplate: `## Verify Bug Fix

Confirm the bug is fixed:

### Instructions:
1. Run existing tests
2. Manually verify the fix if possible
3. Check for regression issues
4. Run lint/type checks

### Expected Output:
- Test results
- Verification status`,
      expectedOutputs: ['test_results', 'verification_status'],
      optional: false,
      maxRetries: 2,
      timeoutMs: 2 * 60 * 1000,
      validation: 'verifyTestsPass',
    },
  ],
};

/**
 * Feature Development Workflow
 */
const featureWorkflow: WorkflowTemplate = {
  type: 'feature',
  name: 'Feature Development',
  description: 'Workflow for implementing new features',
  requiredCapabilities: ['code_generation', 'file_operations'],
  defaultTimeoutMs: 15 * 60 * 1000,
  continueOnFailure: false,
  steps: [
    {
      id: 'plan',
      name: 'Feature Planning',
      description: 'Plan the feature implementation',
      order: 1,
      promptTemplate: `## Feature Planning

Plan the implementation of this feature:

**Feature:** {{task.title}}
**Description:** {{task.description}}
**Requirements:** {{task.prompt}}

### Instructions:
1. Break down the feature into components
2. Identify integration points with existing code
3. Consider edge cases and error handling
4. Plan the testing approach

### Expected Output:
- Component breakdown
- Files to create/modify
- Integration points
- Test plan`,
      expectedOutputs: ['components', 'file_plan', 'integration_points', 'test_plan'],
      optional: false,
      maxRetries: 2,
      timeoutMs: 3 * 60 * 1000,
    },
    {
      id: 'implement',
      name: 'Implement Feature',
      description: 'Build the feature',
      order: 2,
      promptTemplate: `## Feature Implementation

Implement the feature based on the plan:

### Plan:
{{previousStep.output}}

### Instructions:
1. Create new files as needed
2. Modify existing files following patterns
3. Add proper types and documentation
4. Handle errors gracefully

### Expected Output:
- Created/modified files
- Implementation summary`,
      expectedOutputs: ['files_created', 'files_modified', 'summary'],
      optional: false,
      maxRetries: 3,
      timeoutMs: 8 * 60 * 1000,
    },
    {
      id: 'test',
      name: 'Test Feature',
      description: 'Write and run tests',
      order: 3,
      promptTemplate: `## Feature Testing

Add tests for the new feature:

### Instructions:
1. Write unit tests for new functions
2. Write integration tests if needed
3. Run all tests to ensure no regression
4. Check coverage

### Expected Output:
- Test files created
- Test results
- Coverage report`,
      expectedOutputs: ['test_files', 'test_results', 'coverage'],
      optional: false,
      maxRetries: 2,
      timeoutMs: 4 * 60 * 1000,
    },
  ],
};

/**
 * Code Review Workflow
 */
const reviewWorkflow: WorkflowTemplate = {
  type: 'review',
  name: 'Code Review',
  description: 'Review code for quality and best practices',
  requiredCapabilities: ['code_review'],
  defaultTimeoutMs: 5 * 60 * 1000,
  continueOnFailure: true,
  steps: [
    {
      id: 'analyze',
      name: 'Code Analysis',
      description: 'Analyze the code for issues',
      order: 1,
      promptTemplate: `## Code Review Analysis

Review the following code/changes:

**Context:** {{task.title}}
**Scope:** {{task.prompt}}

### Review Checklist:
- [ ] Code correctness
- [ ] Performance considerations
- [ ] Security vulnerabilities
- [ ] Error handling
- [ ] Code style and conventions
- [ ] Test coverage
- [ ] Documentation

### Expected Output:
- List of issues found
- Severity ratings
- Suggested improvements`,
      expectedOutputs: ['issues', 'suggestions', 'overall_assessment'],
      optional: false,
      maxRetries: 1,
      timeoutMs: 3 * 60 * 1000,
    },
    {
      id: 'report',
      name: 'Review Report',
      description: 'Generate review report',
      order: 2,
      promptTemplate: `## Review Report

Generate a structured review report:

### Analysis:
{{previousStep.output}}

### Instructions:
1. Summarize key findings
2. Prioritize issues by severity
3. Provide actionable feedback
4. Include positive observations too

### Expected Output:
- Structured review report
- Action items`,
      expectedOutputs: ['review_report', 'action_items'],
      optional: false,
      maxRetries: 1,
      timeoutMs: 2 * 60 * 1000,
    },
  ],
};

/**
 * Refactoring Workflow
 */
const refactorWorkflow: WorkflowTemplate = {
  type: 'refactor',
  name: 'Code Refactoring',
  description: 'Safely refactor code without changing behavior',
  requiredCapabilities: ['refactoring', 'code_generation'],
  defaultTimeoutMs: 10 * 60 * 1000,
  continueOnFailure: false,
  steps: [
    {
      id: 'assess',
      name: 'Assessment',
      description: 'Assess current code and plan refactoring',
      order: 1,
      promptTemplate: `## Refactoring Assessment

Assess the code to be refactored:

**Target:** {{task.title}}
**Goals:** {{task.prompt}}

### Instructions:
1. Understand current implementation
2. Identify code smells and issues
3. Plan refactoring steps (small, safe changes)
4. Ensure test coverage exists

### Expected Output:
- Current state analysis
- Refactoring plan
- Risk assessment`,
      expectedOutputs: ['analysis', 'refactoring_plan', 'risks'],
      optional: false,
      maxRetries: 2,
      timeoutMs: 2 * 60 * 1000,
    },
    {
      id: 'refactor',
      name: 'Apply Refactoring',
      description: 'Apply refactoring changes incrementally',
      order: 2,
      promptTemplate: `## Apply Refactoring

Refactor the code based on the plan:

### Plan:
{{previousStep.output}}

### Instructions:
1. Make small, incremental changes
2. Run tests after each significant change
3. Preserve existing behavior
4. Improve readability and maintainability

### Expected Output:
- Files modified
- Changes description`,
      expectedOutputs: ['files_modified', 'changes'],
      optional: false,
      maxRetries: 3,
      timeoutMs: 5 * 60 * 1000,
    },
    {
      id: 'verify',
      name: 'Verify Behavior',
      description: 'Ensure behavior is unchanged',
      order: 3,
      promptTemplate: `## Verify Refactoring

Ensure the refactoring preserved behavior:

### Instructions:
1. Run all existing tests
2. Compare behavior before/after
3. Check for any regressions
4. Verify performance hasn't degraded

### Expected Output:
- Test results
- Behavior verification`,
      expectedOutputs: ['test_results', 'behavior_verified'],
      optional: false,
      maxRetries: 2,
      timeoutMs: 3 * 60 * 1000,
      validation: 'verifyTestsPass',
    },
  ],
};

/**
 * Testing Workflow
 */
const testWorkflow: WorkflowTemplate = {
  type: 'test',
  name: 'Testing',
  description: 'Add or improve test coverage',
  requiredCapabilities: ['testing', 'code_generation'],
  defaultTimeoutMs: 8 * 60 * 1000,
  continueOnFailure: false,
  steps: [
    {
      id: 'analyze',
      name: 'Coverage Analysis',
      description: 'Analyze current test coverage',
      order: 1,
      promptTemplate: `## Test Coverage Analysis

Analyze testing needs:

**Target:** {{task.title}}
**Scope:** {{task.prompt}}

### Instructions:
1. Identify untested code paths
2. Find edge cases to test
3. Review existing test patterns
4. Plan new tests needed

### Expected Output:
- Coverage gaps
- Test plan`,
      expectedOutputs: ['coverage_gaps', 'test_plan'],
      optional: false,
      maxRetries: 2,
      timeoutMs: 2 * 60 * 1000,
    },
    {
      id: 'write',
      name: 'Write Tests',
      description: 'Implement new tests',
      order: 2,
      promptTemplate: `## Write Tests

Implement the planned tests:

### Test Plan:
{{previousStep.output}}

### Instructions:
1. Follow existing test patterns
2. Test happy paths and edge cases
3. Use descriptive test names
4. Include necessary fixtures/mocks

### Expected Output:
- Test files created/modified
- Tests written`,
      expectedOutputs: ['test_files', 'tests_written'],
      optional: false,
      maxRetries: 3,
      timeoutMs: 5 * 60 * 1000,
    },
    {
      id: 'run',
      name: 'Run Tests',
      description: 'Execute all tests',
      order: 3,
      promptTemplate: `## Run Tests

Execute all tests to verify:

### Instructions:
1. Run the full test suite
2. Ensure new tests pass
3. Check coverage improvement
4. Fix any issues found

### Expected Output:
- Test results
- Coverage report`,
      expectedOutputs: ['test_results', 'coverage'],
      optional: false,
      maxRetries: 2,
      timeoutMs: 3 * 60 * 1000,
    },
  ],
};

/**
 * Documentation Workflow
 */
const docsWorkflow: WorkflowTemplate = {
  type: 'docs',
  name: 'Documentation',
  description: 'Create or update documentation',
  requiredCapabilities: ['documentation'],
  defaultTimeoutMs: 5 * 60 * 1000,
  continueOnFailure: true,
  steps: [
    {
      id: 'analyze',
      name: 'Documentation Audit',
      description: 'Audit existing documentation',
      order: 1,
      promptTemplate: `## Documentation Audit

Review documentation needs:

**Subject:** {{task.title}}
**Scope:** {{task.prompt}}

### Instructions:
1. Review existing documentation
2. Identify gaps and outdated content
3. Understand the target audience
4. Plan documentation updates

### Expected Output:
- Documentation audit
- Update plan`,
      expectedOutputs: ['audit_results', 'update_plan'],
      optional: false,
      maxRetries: 1,
      timeoutMs: 2 * 60 * 1000,
    },
    {
      id: 'write',
      name: 'Write Documentation',
      description: 'Create or update documentation',
      order: 2,
      promptTemplate: `## Write Documentation

Create/update documentation based on audit:

### Plan:
{{previousStep.output}}

### Instructions:
1. Write clear, concise documentation
2. Include code examples where helpful
3. Follow existing documentation style
4. Keep it up-to-date with code

### Expected Output:
- Documentation files created/modified
- Summary of changes`,
      expectedOutputs: ['docs_files', 'changes_summary'],
      optional: false,
      maxRetries: 2,
      timeoutMs: 3 * 60 * 1000,
    },
  ],
};

/**
 * All workflow templates
 */
export const workflows: Record<WorkflowType, WorkflowTemplate> = {
  autonomous: autonomousWorkflow,
  fix: fixWorkflow,
  feature: featureWorkflow,
  review: reviewWorkflow,
  refactor: refactorWorkflow,
  test: testWorkflow,
  docs: docsWorkflow,
  custom: {
    type: 'custom',
    name: 'Custom Workflow',
    description: 'User-defined custom workflow',
    requiredCapabilities: [],
    defaultTimeoutMs: 10 * 60 * 1000,
    continueOnFailure: false,
    steps: [],
  },
};

/**
 * Get workflow by type
 */
export function getWorkflow(type: WorkflowType): WorkflowTemplate | undefined {
  return workflows[type];
}

/**
 * Get all workflows
 */
export function getAllWorkflows(): WorkflowTemplate[] {
  return Object.values(workflows);
}

/**
 * Infer best workflow for a task based on labels and content
 */
export function inferWorkflow(task: { title: string; labels: string[]; prompt: string }): WorkflowType {
  const labels = task.labels.map(l => l.toLowerCase());
  const content = `${task.title} ${task.prompt}`.toLowerCase();

  // Check labels first
  if (labels.includes('bug') || labels.includes('fix')) return 'fix';
  if (labels.includes('feature')) return 'feature';
  if (labels.includes('review') || labels.includes('code-review')) return 'review';
  if (labels.includes('refactor')) return 'refactor';
  if (labels.includes('test') || labels.includes('testing')) return 'test';
  if (labels.includes('docs') || labels.includes('documentation')) return 'docs';

  // Check content keywords
  if (content.includes('bug') || content.includes('fix error') || content.includes('fix issue')) return 'fix';
  if (content.includes('implement') || content.includes('add feature') || content.includes('create')) return 'feature';
  if (content.includes('review') || content.includes('check code')) return 'review';
  if (content.includes('refactor') || content.includes('clean up') || content.includes('improve structure')) return 'refactor';
  if (content.includes('test') || content.includes('coverage') || content.includes('add tests')) return 'test';
  if (content.includes('document') || content.includes('readme') || content.includes('docs')) return 'docs';

  // Default to autonomous for complex tasks
  return 'autonomous';
}

/**
 * Interpolate template variables
 */
export function interpolateTemplate(
  template: string,
  context: {
    task: { id: string; title: string; description?: string; prompt: string };
    previousStep?: { output: string };
    variables?: Record<string, string>;
  }
): string {
  let result = template;

  // Replace task variables
  result = result.replace(/\{\{task\.id\}\}/g, context.task.id);
  result = result.replace(/\{\{task\.title\}\}/g, context.task.title);
  result = result.replace(/\{\{task\.description\}\}/g, context.task.description || '');
  result = result.replace(/\{\{task\.prompt\}\}/g, context.task.prompt);

  // Replace previous step output
  if (context.previousStep) {
    result = result.replace(/\{\{previousStep\.output\}\}/g, context.previousStep.output);
  }

  // Replace custom variables
  if (context.variables) {
    for (const [key, value] of Object.entries(context.variables)) {
      result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
    }
  }

  return result;
}
