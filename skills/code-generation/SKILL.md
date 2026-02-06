---
name: code-generation
description: Write production-ready code from natural language specifications, following project conventions
version: 1.0.0
metadata: {"profclaw": {"emoji": "⚡", "category": "development", "priority": 90, "triggerPatterns": ["write a", "create a function", "implement", "generate code", "build a", "code that", "write me", "can you write"]}}
---

# Code Generation

You are an expert software engineer. When asked to write code, produce clean, typed, tested, and production-ready implementations that follow the project's conventions and style.

## What This Skill Does

- Writes new functions, classes, modules, and services from specs
- Implements features based on natural language descriptions
- Generates boilerplate following existing project patterns
- Produces companion tests for new code
- Adapts generated code to match the detected language and framework

## How to Execute Code Generation

### Step 1: Understand the Request

Before writing, clarify:
- **What** does the code need to do? (behavior)
- **Where** does it live? (file path, module)
- **What** types/interfaces does it interact with? (check `src/types/`)
- **How** should errors be handled?

If the request is clear, proceed. If ambiguous, ask one focused clarifying question.

### Step 2: Research Existing Patterns

Read relevant existing files to match conventions:
```
read_file(path: "src/queue/task-queue.ts")   # understand queue patterns
read_file(path: "src/types/task.ts")          # understand data shapes
```

Use `glob` or `grep` to find similar code rather than guessing:
```
grep pattern: "export function" path: "src/adapters"
```

### Step 3: Generate the Code

Apply these rules for this TypeScript/Node project:

**TypeScript**
- No `any` types — define interfaces or use generics
- Explicit return types on all exported functions
- Use `type` for data shapes, `interface` for extendable contracts
- Use `Record<string, T>` not `{ [key: string]: T }`

**Imports**
- External packages first, then internal modules, then types
- Always use `.js` extension on relative imports
- Use `import type` for type-only imports

**Error Handling**
```typescript
try {
  const result = await operation();
  return { success: true, data: result };
} catch (error) {
  console.error(`[Context] Failed:`, error);
  return {
    success: false,
    error: {
      code: 'ERROR_CODE',
      message: error instanceof Error ? error.message : 'Unknown error'
    }
  };
}
```

**Async**
- Never block the event loop — use async/await throughout
- No `setTimeout`/`setInterval` in production logic — use BullMQ delayed jobs

### Step 4: Write Tests

For every new exported function, provide a matching test:
```typescript
import { describe, it, expect } from 'vitest';
import { myFunction } from './my-module.js';

describe('myFunction', () => {
  it('should handle the happy path', async () => {
    const result = await myFunction({ input: 'value' });
    expect(result.success).toBe(true);
  });

  it('should return error on invalid input', async () => {
    const result = await myFunction({ input: '' });
    expect(result.success).toBe(false);
    expect(result.error.code).toBe('INVALID_INPUT');
  });
});
```

### Step 5: Explain the Code

After generating, briefly describe:
- What the code does
- Key design decisions
- How to integrate it (import path, usage example)
- Any environment variables or dependencies required

## Example Interactions

**User**: Write a function that retries a failed task up to 3 times with exponential backoff
**You**: *(reads existing queue patterns, writes typed retry utility with tests)*

**User**: Create a Hono route handler for GET /api/tasks/:id
**You**: *(reads server.ts structure, generates handler with proper types, error handling, and zod validation)*

**User**: Implement the `calculateTaskPriority` function based on urgency and age
**You**: *(checks TaskPriority type, writes pure function with full type coverage and unit tests)*

## Language/Framework Reference

This project uses:
- **Runtime**: Node 22+, TypeScript 5.x strict mode
- **HTTP**: Hono (not Express)
- **Queue**: BullMQ + Redis (not raw Redis pub/sub)
- **Validation**: Zod schemas
- **Testing**: Vitest (not Jest)
- **AI SDK**: Vercel AI SDK (`ai` package)

## Best Practices

1. **Match existing patterns** — read similar files before inventing new conventions
2. **Strict types** — no `any`, no implicit `any` via missing types
3. **Small functions** — under 50 lines per function, split if larger
4. **One responsibility** — each function/class does one thing well
5. **Tests first** — describe behavior before writing implementation when possible
6. **Document intent** — add a JSDoc comment on exported functions
7. **No magic numbers** — use named constants or env vars for configurable values
