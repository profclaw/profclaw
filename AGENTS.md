# profClaw - AI Agent Guidelines

Instructions for AI agents (Claude Code, Codex, Copilot, Jules) working on this codebase.

---

## Before You Start

1. Read the README for project overview
2. Search existing code before creating new patterns
3. Check `src/types/` for existing type definitions

## Workflow

### 1. Branch

```bash
git fetch origin
git checkout main && git pull origin main
git checkout -b <type>/<description>
```

### 2. Implement

- Make focused, atomic changes
- Follow existing code patterns
- Add tests for new functionality

### 3. Verify (batch, not per-change)

```bash
pnpm build      # Only before committing or when debugging type errors
pnpm test       # Only when tests were added/modified, or before committing
pnpm lint       # Only before committing
```

**Do NOT run build/test/lint after every small edit.** Batch verification saves time.

### 4. Commit

```bash
git add <specific-files>    # Never git add -A blindly
git commit -m "<type>: <description>

Co-Authored-By: profClaw <bot@profclaw.ai>"
```

Types: `feat`, `fix`, `perf`, `refactor`, `docs`, `test`

### 5. Push and PR

```bash
git push -u origin HEAD
gh pr create --title "<type>: <description>" --body "## Summary
<bullet points>

## Test plan
<how to verify>"
```

## Code Style

```typescript
// Imports: external -> internal -> types (always .js extension)
import { Hono } from 'hono';
import { processTask } from './queue/task-queue.js';
import type { Task, TaskResult } from './types/task.js';

// Explicit return types on exports
export function process(task: Task): Promise<TaskResult> { }

// type for shapes, interface for extendable contracts
// Record<string, T> not { [key: string]: T }
// Use `unknown` + type guards, never `any`
```

## Code Patterns

### Adding a Chat Provider (Channel)

```typescript
// src/chat/providers/<name>/index.ts
import type { ChatProvider, ChatProviderMeta, ChatProviderCapabilities } from '../types.js';

export class MyProvider implements ChatProvider<MyConfig> {
  meta: ChatProviderMeta = {
    id: 'my-channel',
    name: 'My Channel',
    description: 'Description',
  };

  capabilities: ChatProviderCapabilities = {
    text: true,
    images: false,
  };

  async initialize(config: MyConfig): Promise<void> { }
  async shutdown(): Promise<void> { }
  async handleIncoming(raw: unknown): Promise<IncomingMessage> { }
  async sendMessage(msg: OutgoingMessage): Promise<MessageResult> { }
}
```

### Adding an Agent Adapter

```typescript
// src/adapters/<name>.ts
import type { AgentAdapter, AgentConfig, AgentHealth } from '../types/agent.js';
import type { Task, TaskResult } from '../types/task.js';

export class MyAdapter implements AgentAdapter {
  readonly type = 'my-agent';
  readonly name = 'My Agent';
  readonly capabilities: AgentCapability[] = ['code_generation'];

  async healthCheck(): Promise<AgentHealth> { }
  async executeTask(task: Task): Promise<TaskResult> { }
}
```

### Adding a Webhook Integration

```typescript
// src/integrations/<name>.ts
import type { Context } from 'hono';

export async function handleMyWebhook(c: Context): Promise<CreateTaskInput | null> {
  // 1. Verify signature
  // 2. Parse payload
  // 3. Map to CreateTaskInput
  // 4. Return null if not actionable
}
```

### Adding a Skill

```markdown
<!-- skills/<name>/SKILL.md -->
# Skill Name

## Triggers
- "keyword phrase"

## Tools Used
- tool_name

## Prompt
Your skill prompt here...
```

## Common Mistakes to Avoid

### Missing `.js` extension
```typescript
// BAD
import { foo } from './foo';
// GOOD
import { foo } from './foo.js';
```

### Not using type imports
```typescript
// BAD
import { Task } from '../types/task.js';
// GOOD
import type { Task } from '../types/task.js';
```

### Blocking operations
```typescript
// BAD: blocks task processing
await notifySlack(result);
await sendEmail(result);
// GOOD: queue async
notificationQueue.add('notify', { taskId, result });
```

## Error Handling

```typescript
try {
  const result = await operation();
} catch (error) {
  console.error(`[Context] Failed:`, error);
  return {
    success: false,
    error: {
      code: 'ERROR_CODE',
      message: error instanceof Error ? error.message : 'Unknown',
    },
  };
}
```

## Testing

```typescript
import { describe, it, expect } from 'vitest';
import { myFunction } from './my-module.js';

describe('myFunction', () => {
  it('should handle normal input', () => {
    expect(myFunction('input')).toBe('expected');
  });
});
```

- New features: always add tests
- Bug fixes: add regression test
- Refactors: ensure existing tests pass

## Deployment Modes

- **pico**: Agent + tools + 1 chat channel + cron. No UI. Target: Raspberry Pi, $5 VPS.
- **mini**: + Dashboard, integrations, 3 channels. Target: home PC, small VPS.
- **pro**: Everything. All integrations, Redis BullMQ, browser tools. Target: VPS, teams.

## Mandatory Rules

- No `any` types - use `unknown` + type guards
- No `.env` commits
- No blocking event loop
- No hardcoded thresholds - use env vars
- No inline styles in UI - Tailwind only
- Lucide icons only
- `.js` extension on all relative imports
- `import type` for type-only imports

## File Boundaries

### CAN Modify
- `src/**/*.ts`, `ui/src/**/*.{ts,tsx}`, `skills/**`, tests, README, AGENTS.md

### CANNOT Modify (without approval)
- `package.json`, `tsconfig.json`, `.env*`, `*.lock`, `.github/`, `Dockerfile*`

## Dependencies

```
hono, bullmq, ioredis, zod, vitest, ai (Vercel AI SDK),
drizzle-orm, @libsql/client, playwright-core, tsx, concurrently
```

**UI**: React 19, Vite, Tailwind v4, shadcn/ui, TanStack Query, Lucide

Do NOT add new dependencies without explicit approval.

## PR Checklist

- [ ] Build passes (`pnpm build`)
- [ ] Tests pass (`pnpm test`)
- [ ] Lint passes (`pnpm lint`)
- [ ] No `any` types added
- [ ] Error handling is explicit
- [ ] Commit message follows convention
