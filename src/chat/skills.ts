/**
 * Chat Skills System
 *
 * Skills are packaged capabilities that handle specific types of requests.
 * Each skill declares what it can do, patterns to match, and how to execute.
 *
 * Inspired by OpenClaw's adapter pattern and HuggingFace skills.
 */

import type { ConversationMessage } from './conversations.js';

// === Skill Types ===

export interface ChatSkill {
  id: string;
  name: string;
  description: string;
  icon: string; // Lucide icon name

  // Capabilities this skill provides
  capabilities: SkillCapability[];

  // Patterns to match user intent (checked in order)
  patterns: IntentPattern[];

  // Model preference for this skill
  preferredModel?: 'fast' | 'balanced' | 'powerful';

  // Whether this skill requires specific context
  requiresContext?: ('task' | 'ticket' | 'project')[];

  // System prompt additions for this skill
  systemPromptAddition: string;

  // Examples of what this skill handles
  examples: string[];
}

export type SkillCapability =
  | 'task_management'
  | 'code_generation'
  | 'code_review'
  | 'documentation'
  | 'analysis'
  | 'summarization'
  | 'search'
  | 'explanation'
  | 'planning'
  | 'writing'
  | 'debugging'
  | 'general_chat';

export interface IntentPattern {
  // Regex pattern to match (case insensitive)
  pattern: RegExp;
  // Confidence boost when matched (0-100)
  confidence: number;
  // Optional: Extract variables from the match
  extract?: string[];
}

export interface SkillMatch {
  skill: ChatSkill;
  confidence: number;
  matchedPattern?: string;
  extractedVars?: Record<string, string>;
}

// === Pre-compiled Patterns ===
// Defined at module scope to avoid recompilation

const TASK_PATTERNS = {
  create: /(?:create|add|new|make)\s+(?:a\s+)?(?:task|ticket|issue)/i,
  list: /(?:list|show|get|what are)\s+(?:my\s+)?(?:tasks|tickets|issues)/i,
  status: /(?:status|progress|state)\s+(?:of\s+)?(?:task|ticket|issue)/i,
  prioritize: /(?:prioritize|order|sort|rank)\s+(?:tasks|tickets|work)/i,
  assign: /(?:assign|delegate|give)\s+(?:task|ticket|work)/i,
  complete: /(?:complete|finish|done|close)\s+(?:task|ticket|issue)/i,
};

const CODE_PATTERNS = {
  generate: /(?:write|create|generate|build|implement)\s+(?:code|function|class|component)/i,
  review: /(?:review|check|analyze)\s+(?:this\s+)?(?:code|implementation|function)/i,
  explain: /(?:explain|what does|how does)\s+(?:this\s+)?(?:code|function|work)/i,
  debug: /(?:debug|fix|why\s+(?:is|does)|error|bug|issue\s+with)/i,
  refactor: /(?:refactor|improve|optimize|clean\s+up)\s+(?:this\s+)?(?:code|function)/i,
  test: /(?:write|create|generate)\s+(?:tests?|unit\s+tests?|test\s+cases?)/i,
};

const ANALYSIS_PATTERNS = {
  costs: /(?:analyze|show|what are)\s+(?:my\s+)?(?:costs?|spending|usage|tokens?)/i,
  performance: /(?:analyze|show|how is)\s+(?:performance|velocity|throughput)/i,
  patterns: /(?:find|show|what are)\s+(?:patterns?|trends?|insights?)/i,
  summary: /(?:summarize|summary|overview|recap)\s+(?:of\s+)?(?:today|week|month|progress)/i,
};

const DOC_PATTERNS = {
  write: /(?:write|create|generate|draft)\s+(?:documentation|docs|readme|pr\s+description)/i,
  ticket: /(?:write|create|draft)\s+(?:a\s+)?(?:ticket|issue|bug\s+report)/i,
  commit: /(?:write|create|generate)\s+(?:commit\s+message|changelog)/i,
};

const GENERAL_PATTERNS = {
  greeting: /^(?:hi|hello|hey|good\s+(?:morning|afternoon|evening))/i,
  help: /(?:help|how\s+do\s+i|what\s+can\s+you|capabilities)/i,
  thanks: /(?:thanks|thank\s+you|thx|ty)/i,
};

// === Skill Definitions ===

export const CHAT_SKILLS: ChatSkill[] = [
  {
    id: 'task-manager',
    name: 'Task Manager',
    description: 'Create, manage, and organize tasks and tickets',
    icon: 'clipboard-list',
    capabilities: ['task_management', 'planning'],
    patterns: [
      { pattern: TASK_PATTERNS.create, confidence: 90, extract: ['taskType'] },
      { pattern: TASK_PATTERNS.list, confidence: 85 },
      { pattern: TASK_PATTERNS.status, confidence: 80 },
      { pattern: TASK_PATTERNS.prioritize, confidence: 85 },
      { pattern: TASK_PATTERNS.assign, confidence: 80 },
      { pattern: TASK_PATTERNS.complete, confidence: 80 },
    ],
    preferredModel: 'fast',
    systemPromptAddition: `
You are helping with task management in GLINR.

## Available Actions
- Create tasks/tickets with: title, description, priority, labels
- List and filter tasks by status, priority, agent
- Update task status and assignments
- Prioritize and organize work

## Important
- Always confirm before creating or modifying tasks
- Ask for missing required fields (title, description)
- Suggest appropriate priority based on context
- You can reference the GLINR API but cannot execute actions directly`,
    examples: [
      'Create a task to fix the login bug',
      'What tasks are pending?',
      'Prioritize my work for today',
    ],
  },

  {
    id: 'code-assistant',
    name: 'Code Assistant',
    description: 'Write, review, debug, and explain code',
    icon: 'code',
    capabilities: ['code_generation', 'code_review', 'debugging', 'explanation'],
    patterns: [
      { pattern: CODE_PATTERNS.generate, confidence: 90 },
      { pattern: CODE_PATTERNS.review, confidence: 90 },
      { pattern: CODE_PATTERNS.explain, confidence: 85 },
      { pattern: CODE_PATTERNS.debug, confidence: 90 },
      { pattern: CODE_PATTERNS.refactor, confidence: 85 },
      { pattern: CODE_PATTERNS.test, confidence: 85 },
    ],
    preferredModel: 'powerful',
    systemPromptAddition: `
You are helping with code in GLINR.

## Capabilities
- Write code in TypeScript, JavaScript, Python, and more
- Review code for bugs, security issues, and improvements
- Explain code and technical concepts
- Help debug issues
- Suggest refactoring and optimizations

## Guidelines
- Use proper syntax highlighting with language tags
- Prefer TypeScript with strict types
- Follow existing code patterns when modifying
- Explain your reasoning for suggestions`,
    examples: [
      'Write a function to validate email addresses',
      'Review this code for security issues',
      'Why is this throwing an error?',
    ],
  },

  {
    id: 'analyst',
    name: 'Analyst',
    description: 'Analyze costs, performance, and patterns',
    icon: 'bar-chart-2',
    capabilities: ['analysis', 'summarization'],
    patterns: [
      { pattern: ANALYSIS_PATTERNS.costs, confidence: 90 },
      { pattern: ANALYSIS_PATTERNS.performance, confidence: 85 },
      { pattern: ANALYSIS_PATTERNS.patterns, confidence: 80 },
      { pattern: ANALYSIS_PATTERNS.summary, confidence: 85 },
    ],
    preferredModel: 'balanced',
    systemPromptAddition: `
You are analyzing data in GLINR.

## Available Analysis
- Token costs and spending by model/provider
- Task completion rates and velocity
- Agent performance comparisons
- Trends and patterns over time

## Data Sources
You have access to:
- Task history (status, duration, agent)
- Token usage and costs
- Agent performance metrics

## Guidelines
- Present data clearly with numbers
- Highlight actionable insights
- Compare against benchmarks when relevant`,
    examples: [
      'Analyze my token costs this week',
      'Which agent is most efficient?',
      'Summarize progress this sprint',
    ],
  },

  {
    id: 'writer',
    name: 'Writer',
    description: 'Write documentation, tickets, and content',
    icon: 'pen-tool',
    capabilities: ['documentation', 'writing'],
    patterns: [
      { pattern: DOC_PATTERNS.write, confidence: 90 },
      { pattern: DOC_PATTERNS.ticket, confidence: 90 },
      { pattern: DOC_PATTERNS.commit, confidence: 85 },
    ],
    preferredModel: 'balanced',
    systemPromptAddition: `
You are helping write content in GLINR.

## Capabilities
- Write clear documentation
- Draft well-structured tickets and issues
- Create PR descriptions and commit messages
- Generate release notes and changelogs

## Guidelines
- Be concise but complete
- Use proper formatting (markdown)
- Follow conventional commit style
- Include relevant context and acceptance criteria`,
    examples: [
      'Write a ticket for adding dark mode',
      'Generate a commit message for these changes',
      'Draft documentation for the API',
    ],
  },

  {
    id: 'general',
    name: 'General Assistant',
    description: 'General help and conversation',
    icon: 'bot',
    capabilities: ['general_chat', 'explanation'],
    patterns: [
      { pattern: GENERAL_PATTERNS.greeting, confidence: 70 },
      { pattern: GENERAL_PATTERNS.help, confidence: 80 },
      { pattern: GENERAL_PATTERNS.thanks, confidence: 60 },
    ],
    preferredModel: 'fast',
    systemPromptAddition: `
You are the GLINR assistant helping users with their questions.

## What You Can Help With
- Task management and organization
- Code assistance and reviews
- Analysis and insights
- Documentation and writing

## What You Cannot Do
- Execute code or run scripts
- Directly modify files or databases
- Access external services
- Remember information between sessions (use conversation history)

If asked to do something outside your capabilities, explain what you CAN do instead.`,
    examples: [
      'Hello!',
      'What can you help me with?',
      'Thanks for your help',
    ],
  },
];

// === Intent Detection ===

/**
 * Detect user intent and match to the best skill
 */
export function detectIntent(
  message: string,
  context?: { hasTask?: boolean; hasTicket?: boolean; hasCode?: boolean }
): SkillMatch[] {
  const matches: SkillMatch[] = [];

  for (const skill of CHAT_SKILLS) {
    let bestMatch: { confidence: number; pattern?: string; vars?: Record<string, string> } = {
      confidence: 0,
    };

    // Check each pattern
    for (const intentPattern of skill.patterns) {
      const match = message.match(intentPattern.pattern);
      if (match) {
        let confidence = intentPattern.confidence;

        // Boost confidence if context matches requirements
        if (skill.requiresContext) {
          if (skill.requiresContext.includes('task') && context?.hasTask) {
            confidence += 10;
          }
          if (skill.requiresContext.includes('ticket') && context?.hasTicket) {
            confidence += 10;
          }
        }

        // Boost for code-related when code is present
        if (skill.id === 'code-assistant' && context?.hasCode) {
          confidence += 15;
        }

        if (confidence > bestMatch.confidence) {
          bestMatch = {
            confidence,
            pattern: intentPattern.pattern.source,
            vars: intentPattern.extract
              ? extractVariables(match, intentPattern.extract)
              : undefined,
          };
        }
      }
    }

    if (bestMatch.confidence > 0) {
      matches.push({
        skill,
        confidence: Math.min(bestMatch.confidence, 100),
        matchedPattern: bestMatch.pattern,
        extractedVars: bestMatch.vars,
      });
    }
  }

  // Sort by confidence (highest first)
  matches.sort((a, b) => b.confidence - a.confidence);

  // If no matches, fall back to general
  if (matches.length === 0) {
    const generalSkill = CHAT_SKILLS.find(s => s.id === 'general');
    if (generalSkill) {
      matches.push({
        skill: generalSkill,
        confidence: 50,
      });
    }
  }

  return matches;
}

/**
 * Extract named variables from regex match
 */
function extractVariables(
  match: RegExpMatchArray,
  names: string[]
): Record<string, string> {
  const vars: Record<string, string> = {};
  names.forEach((name, i) => {
    if (match[i + 1]) {
      vars[name] = match[i + 1];
    }
  });
  return vars;
}

// === Model Selection ===

export interface ModelTier {
  tier: 'fast' | 'balanced' | 'powerful';
  models: string[];
  description: string;
  maxTokens: number;
  costMultiplier: number;
}

export const MODEL_TIERS: ModelTier[] = [
  {
    tier: 'fast',
    models: ['llama3.2', 'gpt-4o-mini', 'claude-3-haiku', 'gemini-flash'],
    description: 'Quick responses for simple tasks',
    maxTokens: 2000,
    costMultiplier: 0.1,
  },
  {
    tier: 'balanced',
    models: ['gpt-4o', 'claude-3-sonnet', 'gemini-pro'],
    description: 'Good balance of speed and quality',
    maxTokens: 4000,
    costMultiplier: 1,
  },
  {
    tier: 'powerful',
    models: ['gpt-4-turbo', 'claude-3-opus', 'gemini-ultra'],
    description: 'Best quality for complex tasks',
    maxTokens: 8000,
    costMultiplier: 5,
  },
];

/**
 * Select the best model based on skill and message complexity
 */
export function selectModel(
  skillMatch: SkillMatch,
  message: string,
  availableModels: string[]
): { model: string; tier: ModelTier; reason: string } {
  // Determine target tier based on skill preference
  let targetTier: 'fast' | 'balanced' | 'powerful' = skillMatch.skill.preferredModel || 'balanced';

  // Adjust based on message complexity
  const complexity = estimateComplexity(message);
  if (complexity > 0.7 && targetTier !== 'powerful') {
    targetTier = 'powerful';
  } else if (complexity < 0.3 && targetTier === 'powerful') {
    targetTier = 'balanced';
  }

  // Find the tier
  const tier = MODEL_TIERS.find(t => t.tier === targetTier) || MODEL_TIERS[1];

  // Find an available model in this tier (or fallback to any available)
  let selectedModel = tier.models.find(m =>
    availableModels.some(am => am.toLowerCase().includes(m.toLowerCase()))
  );

  if (!selectedModel) {
    // Fallback to first available model
    selectedModel = availableModels[0] || 'local';
  }

  return {
    model: selectedModel,
    tier,
    reason: `${skillMatch.skill.name} with ${complexity > 0.5 ? 'complex' : 'simple'} request`,
  };
}

/**
 * Estimate message complexity (0-1 scale)
 */
function estimateComplexity(message: string): number {
  let score = 0;

  // Length factor
  if (message.length > 500) score += 0.2;
  if (message.length > 1000) score += 0.2;

  // Code presence
  if (message.includes('```')) score += 0.3;
  if (/function|class|interface|type\s+\w+/i.test(message)) score += 0.2;

  // Technical terms
  const technicalTerms = /(?:algorithm|architecture|optimize|refactor|debug|security|performance|async|concurrent)/gi;
  const termMatches = message.match(technicalTerms);
  if (termMatches) score += Math.min(termMatches.length * 0.1, 0.3);

  // Multiple questions
  const questionCount = (message.match(/\?/g) || []).length;
  if (questionCount > 1) score += 0.1 * Math.min(questionCount, 3);

  return Math.min(score, 1);
}

// === Skill-Enhanced System Prompt ===

/**
 * Build a system prompt enhanced with matched skill context
 */
export function buildSkillPrompt(
  basePrompt: string,
  skillMatch: SkillMatch,
  context?: { task?: any; ticket?: any }
): string {
  let prompt = basePrompt;

  // Add skill-specific instructions
  prompt += `\n\n## Current Mode: ${skillMatch.skill.name}\n`;
  prompt += skillMatch.skill.systemPromptAddition;

  // Add grounding to prevent hallucinations
  prompt += `\n\n## Important Constraints
- Only claim capabilities listed above
- If you cannot do something, say so clearly and suggest alternatives
- Do not invent features or claim to run scripts you cannot execute
- Stay focused on what the user is asking`;

  // Add context if available
  if (context?.task) {
    prompt += `\n\n## Current Task Context
- Task ID: ${context.task.id}
- Title: ${context.task.title}
- Status: ${context.task.status}
- Agent: ${context.task.agent || 'unassigned'}`;
  }

  if (context?.ticket) {
    prompt += `\n\n## Current Ticket Context
- Ticket ID: ${context.ticket.id}
- Title: ${context.ticket.title}
- Status: ${context.ticket.status}`;
  }

  return prompt;
}

export default {
  CHAT_SKILLS,
  MODEL_TIERS,
  detectIntent,
  selectModel,
  buildSkillPrompt,
};
