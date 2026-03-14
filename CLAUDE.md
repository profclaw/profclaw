# profClaw - Agent Instructions

## Project Overview

profClaw (Professional Claw / Professor Claw) - smart, lightweight AI agent engine.
Local-first: runs on Docker, VPS, home PC, Mac. Cloud version later.
Monorepo: backend (Hono) + UI (React 19 + Vite).

**Stack**: Node 22+ | TypeScript 5.x strict | Hono | BullMQ + Redis (optional) | pnpm

## Structure

```
src/
  adapters/        # AI agent adapters (OpenClaw, Claude, etc.)
  chat/            # Chat execution engine + providers
    providers/     # Slack, Discord, Telegram, WhatsApp, WebChat, etc.
    execution/     # Agentic executor, tools, sandbox
  cli/             # CLI commands (setup, onboard, doctor)
  core/            # Deployment modes, feature flags
  cron/            # Scheduled jobs
  integrations/    # GitHub, Jira, Linear webhooks
  queue/           # BullMQ + in-memory task queue
  providers/       # AI SDK providers (15+)
  skills/          # Skill loader and registry
  types/           # TypeScript types/interfaces
  server.ts        # Hono HTTP server

ui/src/
  features/        # Feature-based: tasks/, chat/, settings/
  components/      # Shared: ui/ (shadcn), shared/
  core/            # Providers, hooks, utils

skills/            # Built-in skill definitions (SKILL.md files)
config/            # Settings, templates
docs-local/        # Internal docs (gitignored)
```

## Commands

```bash
pnpm dev          # Dev server (API + UI)
pnpm build        # Compile (tsc + vite)
pnpm test         # Tests (vitest)
pnpm lint         # Lint check
```

## Phase Tracking

Active plan lives in `docs-local/profclaw-v2/`. When picking up a task:
1. Read the relevant `PHASE-N.md` file
2. Mark checklist items `[x]` as you complete them
3. Update `STATUS.md` progress percentage
4. If you create new files or change architecture, update this CLAUDE.md

## Performance Rules (Critical)

### Do NOT run build/test after every small change
- Pre-commit hooks and CI handle verification
- Only run `pnpm build` when: finishing a phase, debugging a type error, or before committing
- Only run `pnpm test` when: you wrote/modified tests, or before committing
- Batch your verification: implement multiple related changes, then verify once

### Token-efficient tool usage

| Task | Use | Avoid |
|------|-----|-------|
| Find files | `Glob` | `find`, `ls -R` |
| Search content | `Grep` | `grep`, `rg` via bash |
| Read 1 file | `Read` with offset/limit | `cat`, full file reads |
| Read 3+ files | `mcp__filesystem__read_multiple_files` | Multiple `Read` |
| Explore codebase | `Task` with Explore agent | Manual Glob+Grep chains |
| Live docs | Context7 | Guessing APIs |

**Before reading files:**
1. `Grep` for the specific pattern first (get file:line)
2. `Read` with `offset` and `limit` (not the whole file)
3. Only read full file if you need broad context

**Exclude from searches**: `node_modules/`, `build/`, `dist/`, `.git/`, `coverage/`

### Batch operations
- Make all related changes, then one build check
- Don't context-switch between files unnecessarily
- Group related edits into atomic commits

## Code Style

```typescript
// Imports: external -> internal -> types (always .js extension)
import { Queue } from 'bullmq';
import { processTask } from './queue/task-queue.js';
import type { Task, TaskResult } from './types/task.js';

// Explicit return types on exports
export function process(task: Task): Promise<TaskResult> { }

// type for shapes, interface for extendable contracts
// Record<string, T> not { [key: string]: T }
// Use `unknown` + type guards, never `any`
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

## Key Types (src/types/)

```typescript
TaskStatus: 'pending' | 'queued' | 'in_progress' | 'completed' | 'failed' | 'cancelled'
TaskPriority: 'critical' | 'high' | 'medium' | 'low'
TaskSource: 'github' | 'jira' | 'linear' | 'slack' | 'api' | 'cron'
ChatProviderId: 'slack' | 'discord' | 'telegram' | 'whatsapp' | 'webchat' | 'matrix' | ...
DeploymentMode: 'pico' | 'mini' | 'pro'
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PROFCLAW_MODE` | mini | Deployment mode (pico/mini/pro) |
| `REDIS_URL` | optional | Redis connection (required for pro mode) |
| `PORT` | 3000 | HTTP server port |
| `POOL_MAX_CONCURRENT` | 50 | Max concurrent executions |
| `POOL_TIMEOUT_MS` | 300000 | Tool timeout (5 min) |

## Git Workflow

```bash
# Branch from main
git checkout -b <type>/<description>
# e.g. feat/add-matrix-channel, fix/queue-retry-backoff
```

### Commits
```
<type>: <description>

Co-Authored-By: profClaw <bot@profclaw.ai>
```

Types: `feat`, `fix`, `perf`, `refactor`, `docs`, `test`

Rules:
- No AI tool mentions in commit messages
- No em dashes or en dashes in any written content (commits, docs, comments). Use hyphens (-) or rewrite.
- Concise descriptions of what changed and why

## File Boundaries

**CAN modify**: `src/**/*.ts`, `ui/src/**/*.{ts,tsx}`, `skills/**`, tests, README, CLAUDE.md, AGENTS.md
**CANNOT modify** (without approval): `package.json`, `tsconfig.json`, `.env*`, `*.lock`, `.github/`

## Mandatory Rules

- **NO `any` types** - use `unknown` + type guards
- **Strict TypeScript** - `"strict": true`
- **Zod validation** at system boundaries
- **No `.env` commits**
- **No blocking event loop** - queue notifications async
- **No hardcoded thresholds** - use env vars
- **No inline styles in UI** - Tailwind v4 only
- **Lucide icons only** - no new icon sets
- **No console.log in prod** - use structured logging
- **No dead code** - delete unused imports/functions
- **No skipping tests** for new features
- **`.js` extension** on all relative imports
- **`import type`** for type-only imports

## Context7 Validation

When using external libraries, validate with Context7:
```
"BullMQ job progress tracking use context7"
"Hono middleware error handling use context7"
"Zod schema validation patterns use context7"
"Vercel AI SDK streaming use context7"
```

## Model Routing (March 2026)

```
Haiku 4.5    ($0.80/$4)       -> trivial lookups, typos
Sonnet 4.6   ($3/$15)         -> ALL code tasks (DEFAULT)
Opus 4.6     ($5/$25)         -> multi-agent orchestration only
```

Sonnet 4.6 is near-Opus quality at 1/5 cost. Use Plan Mode for uncertain/complex changes.

Commands: `/claude-router:route <model>`, `/claude-router:router-stats`, `/claude-router:retry`

## Multi-Agent Safety

When multiple agents work in this repo:
- Do NOT create/apply/drop `git stash` entries unless explicitly requested
- Do NOT switch branches unless explicitly requested
- Scope commits to your changes only
- If you see unrecognized files, keep going - focus on your task
- Auto-resolve formatting-only diffs without asking

## Extended References (read on demand)

- `AGENTS.md` - Detailed patterns, PR checklist, testing guide
- `docs-local/profclaw-v2/PLAN.md` - v2 master plan
- `docs-local/profclaw-v2/STATUS.md` - Progress tracker
- `docs-local/COMPETITIVE_ANALYSIS.md` - Feature comparison vs OpenClaw/PicoClaw/MimiClaw
