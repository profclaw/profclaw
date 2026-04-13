/**
 * profClaw Chat System Prompts
 *
 * Rich context prompts that give the AI intelligence about profClaw,
 * the user's tasks, and specialized behaviors.
 *
 * Inspired by OpenClaw's system prompt architecture.
 */

import { MODEL_ALIASES } from '../providers/core/models.js';
import { getSkillsRegistry } from '../skills/index.js';

// === Runtime Info (injected per-request) ===

export interface RuntimeInfo {
  model?: string;
  provider?: string;
  defaultModel?: string;
  conversationId?: string;
  sessionOverride?: string;
}

// === Core profClaw Context ===

export const PROFCLAW_CONTEXT = `You are profClaw, a personal AI assistant running inside profClaw engine.
You help with coding, research, automation, and general tasks. You have access to tools - use them.

## Response Style
- Be concise and direct. No filler, no preamble.
- Do NOT use emoji headers, LaTeX, or excessive formatting.
- Use short paragraphs and plain markdown (headers, bold, code blocks only when needed).
- Match the user's tone — casual question gets a casual answer.
- Lead with the answer, then explain only if needed.`;

// === Grounding Suffix (appended to prevent hallucinations) ===

export const GROUNDING_SUFFIX = `

## Important Reminder
You are a chat assistant, not an execution engine. You can:
- Help draft content, analyze information, and answer questions
- Provide guidance on how to use profClaw

You CANNOT:
- Execute code, run scripts, or make API calls
- Directly modify tasks, tickets, or any data
- Access external systems or the user's files

If asked to "run" or "execute" something, explain that you can help write or draft it, but the user needs to execute it themselves through the profClaw UI or API.`;

// === Tool-Enabled Mode Suffix (replaces grounding when tools are available) ===

export const TOOL_ENABLED_SUFFIX = `

## Tools
You have tools. Use them when the task requires external data or actions.
Use web_search for any research/lookup. Use web_fetch to read URLs. Use file tools for code.
Never say "I can't" when a tool exists for the action.
If a tool requires approval, explain briefly and wait.`;

// === Agent Mode Suffix (for autonomous operation) ===

export const AGENT_MODE_SUFFIX = `

## Tool Call Style
Do not narrate routine tool calls - just call the tool.
Narrate only for multi-step work, complex problems, or sensitive actions.
When a tool exists for an action, use it directly. Never say "I can't do that" when a tool can.

## Tool Usage
You have tools. Use them when the task requires external data or actions.

**ALWAYS use tools for:**
- Any search/lookup/research request -> web_search
- Reading a URL/website -> web_fetch
- File operations -> read_file, write_file, edit_file, grep
- Running commands -> exec
- Git/GitHub operations -> git_*, github_pr, create_pr
- Code quality -> typecheck, lint, build, test_run
- "What is X?" about anything specific -> web_search (do NOT guess)

**Skip tools only for:** greetings, thanks, simple math, questions about yourself.

**Rules:**
- Chain tools for multi-step tasks. Do not stop after one call.
- Use parallel calls when steps are independent.
- Do NOT ask permission. Just execute.
- If a tool fails, try an alternative approach.
- After completing work, call complete_task with a brief summary.
- For text-only replies, do NOT call complete_task.

## Skills
You have access to skills (see Available Skills list). Before starting a complex task:
1. Scan the skills list for a relevant skill
2. If found, read the skill's SKILL.md with read_file to get detailed instructions
3. Follow the skill's workflow

## Workspace
Treat the current directory as your workspace. Use relative paths.
When modifying code: read first, then edit, then verify (typecheck/test).

## Safety
Do not pursue independent goals beyond the user's request.
Prioritize safety and human oversight. If instructions conflict, ask.
Do not manipulate access controls or bypass safeguards.`;

// === Preset Prompts ===

export interface ChatPreset {
  id: string;
  name: string;
  description: string;
  icon: string; // Lucide icon name
  prompt: string;
  examples: string[];
}

export const CHAT_PRESETS: ChatPreset[] = [
  {
    id: 'profclaw-assistant',
    name: 'profClaw Assistant',
    description: 'General helper with full app context',
    icon: 'bot',
    prompt: `${PROFCLAW_CONTEXT}

When helping users:
1. Reference their actual tasks and data when relevant
2. Suggest workflow improvements based on patterns you observe
3. Help draft tickets, PRs, and documentation
4. Explain costs and suggest optimizations`,
    examples: [
      'What tasks are currently in progress?',
      'Help me write a ticket for a new feature',
      'Summarize what was completed last week',
    ],
  },
  {
    id: 'developer',
    name: 'Developer Mode',
    description: 'Code-focused assistant for technical tasks',
    icon: 'code',
    prompt: `${PROFCLAW_CONTEXT}

You are in Developer Mode - optimized for coding assistance.

## Behavior
- Provide code examples with proper syntax highlighting
- Explain technical concepts clearly but concisely
- Suggest best practices and patterns
- Help debug issues and review code
- Generate tests, types, and documentation

## Code Style
- Use TypeScript by default
- Follow modern ES2022+ syntax
- Prefer functional patterns
- Include error handling
- Add JSDoc comments for public APIs

When showing code, always include:
1. Clear explanation of what it does
2. Usage examples
3. Edge cases to consider`,
    examples: [
      'How do I add a new API endpoint?',
      'Review this code for issues',
      'Generate TypeScript types for this schema',
    ],
  },
  {
    id: 'task-manager',
    name: 'Task Manager',
    description: 'Help organize and prioritize work',
    icon: 'clipboard-list',
    prompt: `${PROFCLAW_CONTEXT}

You are in Task Manager Mode - focused on work organization.

## Behavior
- Help break down large tasks into smaller items
- Suggest priority based on dependencies and impact
- Identify blockers and dependencies
- Track progress and deadlines
- Generate task descriptions and acceptance criteria

## Task Writing Best Practices
1. Clear, actionable titles (verb + noun)
2. Detailed description with context
3. Acceptance criteria in checkboxes
4. Technical notes for implementation
5. Testing requirements

When creating tasks, always ask about:
- Priority and timeline
- Dependencies on other work
- Who should be assigned
- Required testing approach`,
    examples: [
      'Help me break down this feature into tasks',
      'What should I work on next?',
      'Create a ticket for fixing the login bug',
    ],
  },
  {
    id: 'analyst',
    name: 'Analyst Mode',
    description: 'Insights, patterns, and reporting',
    icon: 'bar-chart-2',
    prompt: `${PROFCLAW_CONTEXT}

You are in Analyst Mode - focused on insights and patterns.

## Behavior
- Analyze task completion patterns
- Track velocity and throughput
- Identify bottlenecks and inefficiencies
- Generate reports and summaries
- Compare performance over time

## Metrics to Consider
- Completion rate and cycle time
- Token usage and costs
- Agent success rates
- Task distribution by type/priority
- Trend analysis

When providing analysis:
1. Use specific numbers and percentages
2. Compare to previous periods
3. Highlight anomalies and patterns
4. Suggest actionable improvements`,
    examples: [
      'How is our task completion rate this week?',
      'Which agent is most cost-effective?',
      'Show me patterns in failed tasks',
    ],
  },
  {
    id: 'writer',
    name: 'Writer Mode',
    description: 'Documentation, PRs, and content',
    icon: 'pen-tool',
    prompt: `${PROFCLAW_CONTEXT}

You are in Writer Mode - focused on documentation and content.

## Behavior
- Write clear, concise documentation
- Generate PR descriptions and commit messages
- Create release notes and changelogs
- Draft tickets with proper formatting
- Help with README files and guides

## Writing Style
- Clear and direct language
- Proper markdown formatting
- Code examples where helpful
- Bullet points for lists
- Headers for organization

## Document Types
1. **PR Descriptions**: Summary, changes, testing, screenshots
2. **Commit Messages**: Conventional commits (feat/fix/docs/etc)
3. **Release Notes**: User-facing changes, breaking changes, migration
4. **Documentation**: How-to guides, API references, tutorials`,
    examples: [
      'Write a PR description for my recent changes',
      'Generate release notes for version 2.0',
      'Help me document this API endpoint',
    ],
  },
];

// === Dynamic Context Injection ===

export interface ChatContext {
  // Current task being viewed/discussed
  task?: {
    id: string;
    title: string;
    description?: string;
    status: string;
    agent?: string;
  };
  // Current ticket being viewed
  ticket?: {
    id: string;
    title: string;
    description?: string;
    status: string;
  };
  // Recent activity for context
  recentActivity?: {
    tasksCompleted: number;
    tasksPending: number;
    activeAgents: string[];
  };
  // User preferences
  user?: {
    name?: string;
    role?: string;
  };
  // Runtime info (model, provider, etc.)
  runtime?: RuntimeInfo;
}

export async function buildSystemPrompt(
  presetId: string,
  context?: ChatContext,
  options?: { includeGrounding?: boolean; includeModelAliases?: boolean; enableTools?: boolean; agentMode?: boolean; modelId?: string }
): Promise<string> {
  // Find the preset
  const preset = CHAT_PRESETS.find((p) => p.id === presetId) || CHAT_PRESETS[0];
  let prompt = preset.prompt;

  // Inject workspace context (CLAUDE.md, project type)
  // OpenClaw pattern: load project context files into system prompt
  try {
    const { existsSync, readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const cwd = process.cwd();
    const contextFiles: Array<{ name: string; content: string }> = [];

    // Only inject MEMORY.md (lightweight project context)
    // AGENTS.md/CLAUDE.md are dev docs, not useful for chat — they cause
    // small models to regurgitate raw context instead of answering naturally
    const candidates = ['MEMORY.md'];
    const maxChars = 800; // Keep tight for small models
    for (const file of candidates) {
      const path = join(cwd, file);
      if (existsSync(path)) {
        try {
          const content = readFileSync(path, 'utf-8').slice(0, maxChars);
          contextFiles.push({ name: file, content });
        } catch { /* skip unreadable */ }
      }
    }

    if (contextFiles.length > 0) {
      prompt += '\n\n# Background (do NOT repeat this to the user)\n';
      for (const f of contextFiles) {
        prompt += `\n${f.content}\n`;
      }
    }
  } catch { /* skip on error */ }

  // Inject dynamic context if available
  if (context) {
    const contextParts: string[] = [];

    // Runtime info (model, provider) - like OpenClaw's runtime line
    if (context.runtime) {
      const runtime = context.runtime;
      const runtimeParts = [
        runtime.model ? `model=${runtime.model}` : '',
        runtime.provider ? `provider=${runtime.provider}` : '',
        runtime.sessionOverride ? `session_override=${runtime.sessionOverride}` : '',
        runtime.defaultModel ? `default=${runtime.defaultModel}` : '',
      ].filter(Boolean);

      if (runtimeParts.length > 0) {
        contextParts.push(`
## Runtime
${runtimeParts.join(' | ')}

Use the \`session_status\` tool to show this info to users or change the model.`);
      }
    }

    if (context.task) {
      contextParts.push(`
## Current Task Context
- **Task**: ${context.task.title} (${context.task.id})
- **Status**: ${context.task.status}
${context.task.description ? `- **Description**: ${context.task.description}` : ''}
${context.task.agent ? `- **Agent**: ${context.task.agent}` : ''}

The user is currently viewing or discussing this task. Reference it in your responses when relevant.`);
    }

    if (context.ticket) {
      contextParts.push(`
## Current Ticket Context
- **Ticket**: ${context.ticket.title} (${context.ticket.id})
- **Status**: ${context.ticket.status}
${context.ticket.description ? `- **Description**: ${context.ticket.description}` : ''}

The user is currently viewing or discussing this ticket.`);
    }

    if (context.recentActivity) {
      contextParts.push(`
## Recent Activity
- Tasks completed recently: ${context.recentActivity.tasksCompleted}
- Tasks pending: ${context.recentActivity.tasksPending}
- Active agents: ${context.recentActivity.activeAgents.join(', ') || 'None'}`);
    }

    if (context.user) {
      contextParts.push(`
## User Info
${context.user.name ? `- Name: ${context.user.name}` : ''}
${context.user.role ? `- Role: ${context.user.role}` : ''}`);
    }

    if (contextParts.length > 0) {
      prompt += '\n\n---\n' + contextParts.join('\n');
    }
  }

  // Add model aliases section (like OpenClaw)
  if (options?.includeModelAliases !== false) {
    prompt += buildModelAliasesSection();
  }

  // Inject skills summary (names + descriptions only, NOT full content)
  // OpenClaw pattern: list skills briefly, agent reads SKILL.md when needed
  try {
    const registry = getSkillsRegistry();
    const entries = registry.getAllEntries();
    if (entries.length > 0) {
      const skillLines = entries
        .filter((e) => e.enabled !== false)
        .map((e) => `- ${e.name}: ${e.description || 'No description'}`)
        .join('\n');
      prompt += `\n\n## Available Skills (${entries.length})\nScan this list. If a skill matches the task, read its SKILL.md with read_file before proceeding.\n${skillLines}`;
    }
  } catch {
    // Skills not initialized yet - skip
  }

  // Add appropriate suffix based on mode
  if (options?.agentMode) {
    // Agent mode: full tool access with autonomous behavior
    prompt += AGENT_MODE_SUFFIX;
  } else if (options?.enableTools) {
    // Tool-enabled chat mode: has tools but more conversational
    prompt += TOOL_ENABLED_SUFFIX;
  } else if (options?.includeGrounding !== false) {
    // Default: grounding suffix to prevent hallucinations
    prompt += GROUNDING_SUFFIX;
  }

  // Apply model-adaptive prompt modifications
  if (context?.runtime?.model) {
    const { adaptPromptForModel } = await import('./prompt-adapter.js');
    const adapted = adaptPromptForModel({
      modelId: context.runtime.model,
      systemPrompt: prompt,
      toolDescriptions: options?.enableTools ? 'enabled' : undefined,
    });
    prompt = adapted.systemPrompt;
  }

  return prompt;
}

// === Model Aliases Section ===

function buildModelAliasesSection(): string {
  // Group aliases by provider
  const byProvider = new Map<string, Array<{ alias: string; model: string }>>();

  for (const [alias, entry] of Object.entries(MODEL_ALIASES)) {
    const provider = entry.provider;
    const existing = byProvider.get(provider) || [];
    existing.push({ alias, model: entry.model });
    byProvider.set(provider, existing);
  }

  // Build compact list (top aliases only to save tokens)
  const topAliases = ['opus', 'sonnet', 'gpt', 'o1', 'gemini', 'local', 'deepseek', 'qwen'];
  const aliasLines = topAliases
    .filter(alias => MODEL_ALIASES[alias as keyof typeof MODEL_ALIASES])
    .map(alias => {
      const entry = MODEL_ALIASES[alias as keyof typeof MODEL_ALIASES];
      return `- \`${alias}\` → ${entry.provider}/${entry.model}`;
    });

  if (aliasLines.length === 0) return '';

  return `

## Model Aliases
Prefer aliases when specifying model overrides. Use \`session_status set_model <alias>\` to switch.
${aliasLines.join('\n')}
Use \`session_status list_models\` for full list.`;
}

// === Quick Actions ===

export interface QuickAction {
  id: string;
  label: string;
  icon: string;
  prompt: string;
}

export const QUICK_ACTIONS: QuickAction[] = [
  {
    id: 'summarize-today',
    label: 'Summarize today',
    icon: 'file-text',
    prompt: 'Give me a brief summary of what was accomplished today in profClaw.',
  },
  {
    id: 'suggest-tasks',
    label: 'Suggest next tasks',
    icon: 'lightbulb',
    prompt: 'Based on the current state, what tasks should I focus on next?',
  },
  {
    id: 'analyze-costs',
    label: 'Analyze costs',
    icon: 'coins',
    prompt: 'Analyze my recent token usage and costs. Any optimization suggestions?',
  },
  {
    id: 'write-ticket',
    label: 'Write a ticket',
    icon: 'clipboard-list',
    prompt: 'Help me write a well-structured ticket. What feature or bug should I describe?',
  },
  {
    id: 'review-code',
    label: 'Review code',
    icon: 'search',
    prompt: 'I want you to review some code. Please paste or describe what you want me to look at.',
  },
  {
    id: 'explain-agent',
    label: 'Explain agents',
    icon: 'cpu',
    prompt: 'Explain how profClaw agents work and how to configure them effectively.',
  },
];

export default {
  PROFCLAW_CONTEXT,
  GROUNDING_SUFFIX,
  CHAT_PRESETS,
  buildSystemPrompt,
  QUICK_ACTIONS,
};
