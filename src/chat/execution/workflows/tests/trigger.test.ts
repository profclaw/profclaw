/**
 * Workflow Trigger Tests
 *
 * Tests for src/chat/execution/workflows/trigger.ts
 * Covers: detectWorkflow, matchWorkflow, confidence scoring, variable extraction.
 */

import { describe, it, expect } from 'vitest';
import { detectWorkflow, matchWorkflow } from '../trigger.js';
import type { WorkflowDefinition } from '../types.js';

// ---------------------------------------------------------------------------
// Fixtures - sample workflow definitions
// ---------------------------------------------------------------------------

const DEPLOY_WORKFLOW: WorkflowDefinition = {
  id: 'deploy',
  name: 'Deploy Application',
  description: 'Deploys the application to the target environment',
  triggers: ['deploy', 'ship it', 'push to production', 'release'],
  steps: [],
};

const CODE_REVIEW_WORKFLOW: WorkflowDefinition = {
  id: 'code-review',
  name: 'Code Review',
  description: 'Reviews code changes for quality and correctness',
  triggers: ['review code', 'code review', 'check my changes', 'review PR'],
  steps: [],
};

const DEBUG_WORKFLOW: WorkflowDefinition = {
  id: 'debug',
  name: 'Debug Issue',
  description: 'Debugs errors and exceptions in the codebase',
  triggers: ['debug', 'fix the bug', 'investigate error', 'trace the issue'],
  steps: [],
};

const RESEARCH_WORKFLOW: WorkflowDefinition = {
  id: 'research',
  name: 'Research Topic',
  description: 'Searches for information on a topic',
  triggers: ['search for', 'research', 'look up', 'find information about'],
  steps: [],
};

const ALL_WORKFLOWS = [
  DEPLOY_WORKFLOW,
  CODE_REVIEW_WORKFLOW,
  DEBUG_WORKFLOW,
  RESEARCH_WORKFLOW,
];

// ---------------------------------------------------------------------------
// detectWorkflow - basic keyword matching
// ---------------------------------------------------------------------------

describe('detectWorkflow()', () => {
  describe('keyword matching', () => {
    it('matches "deploy" keyword to the deploy workflow', () => {
      const match = detectWorkflow('deploy the application', ALL_WORKFLOWS);
      expect(match).not.toBeNull();
      expect(match!.workflow.id).toBe('deploy');
    });

    it('matches "review code" to the code-review workflow', () => {
      const match = detectWorkflow('review code for this PR', ALL_WORKFLOWS);
      expect(match).not.toBeNull();
      expect(match!.workflow.id).toBe('code-review');
    });

    it('matches "debug" to the debug workflow', () => {
      const match = detectWorkflow('debug this error in the service', ALL_WORKFLOWS);
      expect(match).not.toBeNull();
      expect(match!.workflow.id).toBe('debug');
    });

    it('matches "search for" to the research workflow', () => {
      const match = detectWorkflow('search for TypeScript best practices', ALL_WORKFLOWS);
      expect(match).not.toBeNull();
      expect(match!.workflow.id).toBe('research');
    });

    it('returns null for a message that matches no workflow', () => {
      const match = detectWorkflow('make me a sandwich', ALL_WORKFLOWS);
      expect(match).toBeNull();
    });

    it('returns null when availableWorkflows is empty', () => {
      const match = detectWorkflow('deploy the app', []);
      expect(match).toBeNull();
    });

    it('returns null when userMessage is empty string', () => {
      const match = detectWorkflow('', ALL_WORKFLOWS);
      expect(match).toBeNull();
    });

    it('is case-insensitive - DEPLOY matches deploy workflow', () => {
      const match = detectWorkflow('DEPLOY TO STAGING', ALL_WORKFLOWS);
      expect(match).not.toBeNull();
      expect(match!.workflow.id).toBe('deploy');
    });
  });

  // ---------------------------------------------------------------------------
  // Confidence scoring
  // ---------------------------------------------------------------------------

  describe('confidence scoring', () => {
    it('returns confidence between 0 and 1', () => {
      const match = detectWorkflow('deploy the application', ALL_WORKFLOWS);
      expect(match!.confidence).toBeGreaterThan(0);
      expect(match!.confidence).toBeLessThanOrEqual(1);
    });

    it('longer trigger phrase relative to message yields higher confidence', () => {
      // "push to production" is a longer trigger phrase - exact match gives higher score
      const matchShort = detectWorkflow('deploy now', ALL_WORKFLOWS);
      const matchLong = detectWorkflow('push to production', ALL_WORKFLOWS);

      expect(matchLong!.confidence).toBeGreaterThanOrEqual(matchShort!.confidence);
    });

    it('exact trigger phrase match has confidence >= 0.6', () => {
      const match = detectWorkflow('deploy', ALL_WORKFLOWS);
      expect(match!.confidence).toBeGreaterThanOrEqual(0.6);
    });

    it('returns the highest confidence match when multiple workflows could match', () => {
      // Create two workflows where one has a closer match
      const workflows: WorkflowDefinition[] = [
        { id: 'specific', name: 'Specific', description: '', triggers: ['deploy to production'], steps: [] },
        { id: 'generic', name: 'Generic', description: '', triggers: ['deploy'], steps: [] },
      ];
      const match = detectWorkflow('deploy to production', workflows);
      expect(match).not.toBeNull();
      // "deploy to production" is a longer exact match - should win
      expect(match!.workflow.id).toBe('specific');
    });

    it('returns null when best confidence is below 0.5 threshold', () => {
      const workflows: WorkflowDefinition[] = [
        {
          id: 'very-specific',
          name: 'Very specific',
          description: '',
          triggers: ['zzzyyyxxx'],
          steps: [],
        },
      ];
      const match = detectWorkflow('completely unrelated message', workflows);
      expect(match).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Variable extraction
  // ---------------------------------------------------------------------------

  describe('variable extraction', () => {
    it('extracts filePath from message when pattern matches', () => {
      const match = detectWorkflow('debug in file src/server.ts', ALL_WORKFLOWS);
      expect(match).not.toBeNull();
      expect(match!.extractedVariables).toHaveProperty('filePath');
      expect(match!.extractedVariables.filePath).toBe('src/server.ts');
    });

    it('extracts errorPattern from quoted error message', () => {
      const match = detectWorkflow('search for error "Cannot read property"', ALL_WORKFLOWS);
      expect(match).not.toBeNull();
      expect(match!.extractedVariables).toHaveProperty('errorPattern');
      expect(match!.extractedVariables.errorPattern).toBe('Cannot read property');
    });

    it('extracts query from search message', () => {
      const match = detectWorkflow('search for TypeScript generics', ALL_WORKFLOWS);
      expect(match).not.toBeNull();
      expect(match!.extractedVariables).toHaveProperty('query');
      expect(match!.extractedVariables.query).toContain('TypeScript generics');
    });

    it('extracts branch from branch pattern', () => {
      // The pattern matches "branch <name>" or "from <name>"
      // Using "branch feature/auth" directly ensures the capture group gets the branch name
      const match = detectWorkflow('review code branch feature/auth', ALL_WORKFLOWS);
      expect(match).not.toBeNull();
      expect(match!.extractedVariables).toHaveProperty('branch');
      expect(match!.extractedVariables.branch).toBe('feature/auth');
    });

    it('returns empty extractedVariables when no patterns match', () => {
      const match = detectWorkflow('deploy the application', ALL_WORKFLOWS);
      expect(match).not.toBeNull();
      // No variable patterns match a bare deploy message
      expect(Object.keys(match!.extractedVariables).length).toBe(0);
    });

    it('extracts multiple variables in a single message', () => {
      const match = detectWorkflow(
        'debug in file src/server.ts search for error "ENOENT"',
        ALL_WORKFLOWS,
      );
      expect(match).not.toBeNull();
      expect(match!.extractedVariables).toHaveProperty('filePath');
      expect(match!.extractedVariables).toHaveProperty('errorPattern');
    });
  });
});

// ---------------------------------------------------------------------------
// matchWorkflow
// ---------------------------------------------------------------------------

describe('matchWorkflow()', () => {
  it('returns null when no workflow matches', () => {
    expect(matchWorkflow('have lunch', ALL_WORKFLOWS)).toBeNull();
  });

  it('returns a match object when a workflow matches', () => {
    const match = matchWorkflow('deploy to staging', ALL_WORKFLOWS);
    expect(match).not.toBeNull();
    expect(match!.workflow.id).toBe('deploy');
  });

  it('merges extracted variables into workflow.variables', () => {
    const match = matchWorkflow('search for TypeScript generics', ALL_WORKFLOWS);
    expect(match).not.toBeNull();
    // extractedVariables should be merged into workflow.variables
    expect(match!.workflow.variables).toBeDefined();
    expect(match!.workflow.variables!.query).toBeDefined();
  });

  it('does not mutate the original workflow definition', () => {
    const original = RESEARCH_WORKFLOW.variables;
    matchWorkflow('search for BullMQ patterns', ALL_WORKFLOWS);
    expect(RESEARCH_WORKFLOW.variables).toBe(original);
  });

  it('preserves original workflow variables when merging extracted vars', () => {
    const workflowWithVars: WorkflowDefinition = {
      id: 'research-with-vars',
      name: 'Research',
      description: '',
      triggers: ['search for'],
      steps: [],
      variables: { defaultLimit: 10 },
    };

    const match = matchWorkflow('search for TypeScript', [workflowWithVars]);
    expect(match).not.toBeNull();
    expect(match!.workflow.variables!.defaultLimit).toBe(10);
    expect(match!.workflow.variables!.query).toBeDefined();
  });

  it('returns the original workflow unchanged when no variables are extracted', () => {
    const match = matchWorkflow('deploy now', ALL_WORKFLOWS);
    expect(match).not.toBeNull();
    // No extracted variables - workflow should be returned as-is
    expect(match!.workflow.variables).toBeUndefined();
  });

  it('includes confidence score in the returned match', () => {
    const match = matchWorkflow('debug this error', ALL_WORKFLOWS);
    expect(match!.confidence).toBeGreaterThan(0);
    expect(match!.confidence).toBeLessThanOrEqual(1);
  });

  it('includes extractedVariables in the returned match', () => {
    const match = matchWorkflow('search for "rate limiting"', ALL_WORKFLOWS);
    expect(match).not.toBeNull();
    expect(match!.extractedVariables).toBeDefined();
    expect(typeof match!.extractedVariables).toBe('object');
  });

  it('handles workflows array with a single entry', () => {
    const match = matchWorkflow('deploy to production', [DEPLOY_WORKFLOW]);
    expect(match).not.toBeNull();
    expect(match!.workflow.id).toBe('deploy');
  });
});
