import type { WorkflowDefinition, WorkflowMatch } from './types.js';

/** Minimum confidence threshold to return a workflow match */
const MIN_CONFIDENCE = 0.5;

/** Patterns for extracting common variables from user messages */
const VARIABLE_PATTERNS: Array<{
  name: string;
  pattern: RegExp;
}> = [
  // File paths
  { name: 'filePath', pattern: /(?:in|at|file|path)\s+([\w./\\-]+\.\w+)/i },
  // Error messages in quotes
  { name: 'errorPattern', pattern: /(?:error|pattern|search for)\s+["']([^"']+)["']/i },
  // Search query
  { name: 'query', pattern: /(?:search|look up|find|research)\s+(?:for\s+)?["']?([^"'\n]{3,80})["']?/i },
  // Branch name
  { name: 'branch', pattern: /(?:branch|from)\s+([\w/-]+)/i },
  // Directory
  { name: 'searchDir', pattern: /(?:in|directory|dir|folder)\s+([\w./\\-]+)/i },
  // Target pattern for refactoring
  { name: 'targetPattern', pattern: /(?:rename|replace|refactor)\s+["']?(\w+)["']?/i },
  // Test command override
  { name: 'testCommand', pattern: /(?:using|with|run)\s+(pnpm|npm|yarn|bun)\s+test/i },
];

/**
 * Score how well a user message matches a workflow's triggers.
 * Returns a value 0-1 where 1 is a perfect match.
 */
function scoreTriggers(message: string, triggers: string[]): number {
  const normalised = message.toLowerCase().trim();

  let best = 0;

  for (const trigger of triggers) {
    const triggerLower = trigger.toLowerCase();

    // Exact phrase match
    if (normalised.includes(triggerLower)) {
      const lengthRatio = triggerLower.length / normalised.length;
      // Longer trigger relative to message = higher confidence
      const score = 0.6 + Math.min(0.4, lengthRatio * 2);
      if (score > best) best = score;
      continue;
    }

    // Word-level overlap
    const triggerWords = triggerLower.split(/\s+/);
    const messageWords = new Set(normalised.split(/\W+/).filter((w) => w.length > 2));
    const matchedWords = triggerWords.filter((w) => messageWords.has(w));

    if (matchedWords.length > 0) {
      const ratio = matchedWords.length / triggerWords.length;
      const score = ratio * 0.55;
      if (score > best) best = score;
    }
  }

  return best;
}

/**
 * Extract variable values from the user message using known patterns.
 */
function extractVariables(message: string): Record<string, string> {
  const extracted: Record<string, string> = {};

  for (const { name, pattern } of VARIABLE_PATTERNS) {
    const match = message.match(pattern);
    if (match?.[1]) {
      extracted[name] = match[1].trim();
    }
  }

  return extracted;
}

/**
 * Detect which workflow (if any) best matches the user's intent.
 * Returns null if no workflow reaches the minimum confidence threshold.
 */
export function detectWorkflow(
  userMessage: string,
  availableWorkflows: WorkflowDefinition[],
): WorkflowMatch | null {
  if (!userMessage || availableWorkflows.length === 0) {
    return null;
  }

  let bestMatch: WorkflowMatch | null = null;

  for (const workflow of availableWorkflows) {
    const confidence = scoreTriggers(userMessage, workflow.triggers);

    if (confidence >= MIN_CONFIDENCE && (bestMatch === null || confidence > bestMatch.confidence)) {
      bestMatch = {
        workflow,
        confidence,
        extractedVariables: extractVariables(userMessage),
      };
    }
  }

  return bestMatch;
}

/**
 * Detect workflow from user message against all available workflows,
 * returning the best match above the confidence threshold.
 *
 * Convenience wrapper that also injects extracted variables as
 * workflow-level variable overrides.
 */
export function matchWorkflow(
  userMessage: string,
  availableWorkflows: WorkflowDefinition[],
): WorkflowMatch | null {
  const match = detectWorkflow(userMessage, availableWorkflows);
  if (!match) return null;

  // Merge extracted variables into a copy of the workflow's defaults
  if (Object.keys(match.extractedVariables).length > 0) {
    return {
      ...match,
      workflow: {
        ...match.workflow,
        variables: {
          ...(match.workflow.variables ?? {}),
          ...match.extractedVariables,
        },
      },
    };
  }

  return match;
}
