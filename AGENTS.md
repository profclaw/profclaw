# profClaw - AI Agent Guidelines

Instructions for AI agents (Claude Code, Codex, Antigravity, Jules) working on this codebase.

---

## Before You Start

1. Read `CLAUDE.md` for project conventions and rules
2. Check `docs-local/profclaw-v2/STATUS.md` for current progress
3. Read the relevant `PHASE-N.md` for your assigned work
4. Search existing code before creating new patterns

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
- Update phase checklist as you go

### 3. Verify (batch, not per-change)

```bash
pnpm build      # Only before committing or when debugging type errors
pnpm test       # Only when tests were added/modified, or before committing
pnpm lint       # Only before committing
```

**Do NOT run build/test/lint after every small edit.** Batch verification saves time. Pre-commit hooks catch issues at commit time.

### 4. Commit

```bash
git add <specific-files>    # Never git add -A blindly
git commit -m "<type>: <description>

Co-Authored-By: profClaw <bot@profclaw.ai>"
```

### 5. Push and PR

```bash
git push -u origin HEAD
gh pr create --title "<type>: <description>" --body "## Summary
<bullet points>

## Test plan
<how to verify>"
```

## Validation Approach

```
RESEARCH -> VALIDATE -> IMPLEMENT -> VERIFY (once, batched)
```

- **New APIs** -> Context7 or docs first
- **New files** -> Follow existing directory structure
- **New deps** -> Justify and propose in PR (do not add without approval)
- **New types** -> Check `src/types/` first

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
    // ...
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
- "another trigger"

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

### Running checks too often
```typescript
// BAD: run build after every file edit
// edit file A -> pnpm build -> edit file B -> pnpm build -> edit file C -> pnpm build

// GOOD: batch edits, verify once
// edit file A -> edit file B -> edit file C -> pnpm build
```

## Testing Patterns

### Unit Test
```typescript
import { describe, it, expect } from 'vitest';
import { myFunction } from './my-module.js';

describe('myFunction', () => {
  it('should handle normal input', () => {
    expect(myFunction('input')).toBe('expected');
  });

  it('should handle edge cases', () => {
    expect(() => myFunction(null)).toThrow();
  });
});
```

### When to write tests
- New features: always
- Bug fixes: add regression test
- Refactors: ensure existing tests still pass
- Performance: add benchmark when claims are made

## Deployment Model

profClaw runs local-first (like OpenClaw):
- Users install via `npx profclaw`, Docker, or binary
- Runs on their own machine (PC, Mac, VPS, RPi)
- Web UI served locally at `localhost:3000` (mini/pro modes)
- No hosted SaaS - users own their instance
- Cloud version planned for later

### Deployment Modes
- **pico**: Agent + tools + chat only. No UI, no Redis. Target: $10 boards, RPi.
- **mini**: + Dashboard, channels, basic cron. Target: home PC, small VPS.
- **pro**: Everything. All integrations, Redis BullMQ. Target: VPS, team deploy.

## PR Checklist

Before marking PR ready:
- [ ] Build passes (`pnpm build`)
- [ ] Tests pass (`pnpm test`)
- [ ] Lint passes (`pnpm lint`)
- [ ] No `any` types added
- [ ] Error handling is explicit
- [ ] Commit message follows convention
- [ ] Phase checklist updated in `docs-local/profclaw-v2/`
- [ ] CLAUDE.md updated if architecture changed

## CI/CD Notes

- **No Docker image builds on every commit** - Docker builds are manual/release-only for now
- CI runs: `pnpm build && pnpm test && pnpm lint` on PRs
- Docker images published manually during release preparation (Phase 10)
- Keep CI fast - no unnecessary steps

## File Boundaries

### CAN Modify
- `src/**/*.ts` - source code
- `ui/src/**/*.{ts,tsx}` - UI code
- `skills/**` - skill definitions
- `src/**/*.test.ts` - tests
- `README.md`, `CLAUDE.md`, `AGENTS.md`
- `docs-local/**` - internal docs

### CANNOT Modify (without approval)
- `package.json` - dependencies
- `tsconfig.json` - TypeScript config
- `.env*` - environment files
- `*.lock` - lock files
- `.github/**` - CI/CD workflows
- `Dockerfile*` - container configs

## Dependencies (already installed)

```
hono, bullmq, ioredis, zod, vitest, ai (Vercel AI SDK),
drizzle-orm, @libsql/client, playwright-core, tsx, concurrently
```

**UI**: React 19, Vite, Tailwind v4, shadcn/ui, TanStack Query, Lucide

Do NOT add new dependencies without explicit approval.

## When Uncertain

1. Search existing code for similar patterns
2. Use Context7 for library APIs
3. State assumptions clearly in PR description
4. Proceed with confidence - validated code > hesitant code
