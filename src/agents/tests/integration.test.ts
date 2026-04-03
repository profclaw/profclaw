import { describe, it, expect } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { writeFile, unlink, readFile } from 'fs/promises'
import { existsSync } from 'fs'
import type { ModelMessage } from 'ai'

import { ToolCircuitBreaker } from '../circuit-breaker.js'
import { ResultStore } from '../result-store.js'
import { ContextCompactor } from '../context-compactor.js'
import { HookRegistry } from '../../hooks/registry.js'
import type { HookContext } from '../../hooks/registry.js'
import { ToolLoader } from '../tool-loader.js'
import type { ToolDefinition } from '../../chat/execution/types.js'
import { PermissionManager } from '../permissions.js'
import { PlanManager } from '../plan-mode.js'
import { TranscriptStore } from '../transcript.js'
import { FileSnapshotManager } from '../file-snapshots.js'
import { SessionDiffTracker } from '../session-diff.js'
import { AutoMemoryExtractor } from '../auto-memory.js'
import { PromptSuggestionEngine } from '../prompt-suggestions.js'
import { RateLimitMonitor } from '../rate-limit-monitor.js'
import { ErrorRecoveryAdvisor } from '../error-recovery.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  return join(tmpdir(), `profclaw-int-test-${randomUUID()}`)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Agent module integration', () => {
  it('circuit breaker integrates with executor config', () => {
    const breaker = new ToolCircuitBreaker(3, 120_000)

    // Fresh breaker allows execution
    expect(breaker.canExecute('my_tool').allowed).toBe(true)

    // Three failures within the window open the circuit
    breaker.recordFailure('my_tool')
    breaker.recordFailure('my_tool')
    breaker.recordFailure('my_tool')

    const result = breaker.canExecute('my_tool')
    expect(result.allowed).toBe(false)
    expect(result.reason).toMatch(/circuit breaker open/i)

    // Status snapshot reflects the open state
    const status = breaker.getStatus()
    expect(status.get('my_tool')?.state).toBe('open')
  })

  it('result store cleans up temp files', async () => {
    const sessionId = randomUUID()
    const store = new ResultStore(sessionId)

    // Build a payload large enough to exceed the 50 KB inline threshold
    const largePayload = { data: 'x'.repeat(60_000) }
    const stored = await store.store('call-1', largePayload)

    expect(stored.fullPath).toBeDefined()
    expect(existsSync(stored.fullPath!)).toBe(true)
    expect(stored.inline).toContain('[Result stored:')

    // Cleanup removes the temp file
    await store.cleanup()
    expect(existsSync(stored.fullPath!)).toBe(false)
  })

  it('context compactor produces valid ModelMessage[]', async () => {
    // Build a conversation that exceeds the default 70 k-token threshold
    // by using a small threshold for the test
    const compactor = new ContextCompactor({
      maxContextTokens: 200,
      compactionThreshold: 100,
      preserveRecentTurns: 1,
    })

    const messages: ModelMessage[] = Array.from({ length: 30 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: 'word '.repeat(20), // ~100 chars / ~25 tokens per message
    } as ModelMessage))

    const result = await compactor.compact(messages)

    // Should have compacted
    expect(result.compacted).toBe(true)
    expect(result.turnsCompacted).toBeGreaterThan(0)

    // Output must be a valid ModelMessage[]
    expect(Array.isArray(result.messages)).toBe(true)
    for (const msg of result.messages) {
      expect(['user', 'assistant', 'system']).toContain(msg.role)
    }
  })

  it('hook registry runs hooks in priority order', async () => {
    const registry = new HookRegistry()
    const executionOrder: number[] = []

    registry.register({
      name: 'hook-low',
      point: 'beforeToolCall',
      priority: 300,
      handler: async () => { executionOrder.push(300); return { proceed: true } },
    })

    registry.register({
      name: 'hook-high',
      point: 'beforeToolCall',
      priority: 10,
      handler: async () => { executionOrder.push(10); return { proceed: true } },
    })

    registry.register({
      name: 'hook-mid',
      point: 'beforeToolCall',
      priority: 150,
      handler: async () => { executionOrder.push(150); return { proceed: true } },
    })

    const ctx: HookContext = {
      hookPoint: 'beforeToolCall',
      toolName: 'test_tool',
      metadata: {},
    }

    await registry.run('beforeToolCall', ctx)

    expect(executionOrder).toEqual([10, 150, 300])
  })

  it('tool loader returns valid tool definitions', () => {
    // Build minimal stubs. The full ToolDefinition interface requires zod schemas
    // and security levels that aren't relevant for testing ToolLoader's category
    // logic, so we cast through unknown.
    function stub(name: string, description: string): ToolDefinition {
      return { name, description, execute: async () => ({}) } as unknown as ToolDefinition
    }

    const mockTools = new Map<string, ToolDefinition>([
      ['read_file', stub('read_file', 'Read a file')],
      ['write_file', stub('write_file', 'Write a file')],
      ['search_files', stub('search_files', 'Search files')],
      ['exec', stub('exec', 'Execute command')],
      ['git_status', stub('git_status', 'Git status')],
      ['git_commit', stub('git_commit', 'Git commit')],
      ['complete_task', stub('complete_task', 'Complete task')],
      ['search_available_tools', stub('search_available_tools', 'Search tools')],
    ])

    const loader = new ToolLoader(mockTools)
    const coreTools = loader.getCoreTools()

    expect(coreTools.length).toBeGreaterThan(0)

    for (const tool of coreTools) {
      expect(typeof tool.name).toBe('string')
      expect(tool.name.length).toBeGreaterThan(0)
      expect(typeof tool.description).toBe('string')
      expect(typeof tool.execute).toBe('function')
    }
  })

  it('permission manager integrates with hook system', async () => {
    const registry = new HookRegistry()
    const manager = new PermissionManager()

    // Wire permission manager into beforeToolCall hook
    registry.register({
      name: 'permission-check',
      point: 'beforeToolCall',
      priority: 1,
      handler: async (ctx: HookContext) => {
        const result = await manager.check(ctx.toolName ?? '', ctx.toolArgs)
        return { proceed: result.allowed, modified: result.reason }
      },
    })

    // A safe tool should proceed without prompting
    const safeCtx: HookContext = {
      hookPoint: 'beforeToolCall',
      toolName: 'read_file',
      metadata: {},
    }
    const safeResult = await registry.run('beforeToolCall', safeCtx)
    expect(safeResult.proceed).toBe(true)

    // A dangerous tool with no prompt callback → non-interactive allow
    const dangerCtx: HookContext = {
      hookPoint: 'beforeToolCall',
      toolName: 'exec',
      metadata: {},
    }
    const dangerResult = await registry.run('beforeToolCall', dangerCtx)
    // No callback registered → non-interactive mode allows
    expect(dangerResult.proceed).toBe(true)

    // Permanently deny a tool via direct state access and verify the hook blocks it
    const { autoDeny } = (manager as unknown as { state: { autoAllow: Set<string>; autoDeny: Set<string> } }).state
    autoDeny.add('exec')

    const deniedResult = await registry.run('beforeToolCall', dangerCtx)
    expect(deniedResult.proceed).toBe(false)
  })

  it('plan manager saves and loads from disk', async () => {
    const dir = makeTempDir()

    const manager1 = new PlanManager(dir)
    const plan = manager1.create('Integration test plan', [
      { index: 0, description: 'Step one' },
      { index: 1, description: 'Step two' },
    ])

    expect(plan.id).toBeDefined()
    expect(plan.status).toBe('draft')

    // Create a fresh manager pointing at the same directory — it should load from disk
    const manager2 = new PlanManager(dir)
    const loaded = manager2.get(plan.id)

    expect(loaded).toBeDefined()
    expect(loaded!.title).toBe('Integration test plan')
    expect(loaded!.steps).toHaveLength(2)
  })

  it('transcript store round-trips entries', async () => {
    const dir = makeTempDir()
    const store = new TranscriptStore(dir)
    const sessionId = randomUUID()

    const entry = {
      timestamp: Date.now(),
      sessionId,
      type: 'user' as const,
      content: 'Hello, agent!',
    }

    store.append(entry)

    const entries = store.getSession(sessionId)
    expect(entries).toHaveLength(1)
    expect(entries[0].content).toBe('Hello, agent!')

    // Search should find the entry by content keyword
    const results = store.search('Hello', { sessionId })
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].entry.content).toBe('Hello, agent!')
  })

  it('file snapshot manager captures and restores', async () => {
    const tmpFile = join(tmpdir(), `snap-test-${randomUUID()}.txt`)
    const originalContent = 'original content'
    const modifiedContent = 'modified content'

    await writeFile(tmpFile, originalContent, 'utf-8')

    const manager = new FileSnapshotManager(randomUUID())
    await manager.captureBeforeEdit(tmpFile, 1)

    // Simulate an edit
    await writeFile(tmpFile, modifiedContent, 'utf-8')
    expect(await readFile(tmpFile, 'utf-8')).toBe(modifiedContent)

    // Rewind to the captured snapshot
    const result = await manager.rewind(tmpFile)
    expect(result.restored).toBe(true)
    expect(await readFile(tmpFile, 'utf-8')).toBe(originalContent)

    // Cleanup
    await unlink(tmpFile)
  })

  it('session diff tracker detects changes', async () => {
    const tmpFile = join(tmpdir(), `diff-test-${randomUUID()}.txt`)
    const original = 'line one\nline two\n'
    const modified = 'line one\nline two\nline three\n'

    await writeFile(tmpFile, modified, 'utf-8')

    const tracker = new SessionDiffTracker()
    tracker.recordOriginal(tmpFile, original)

    const diff = await tracker.generateDiff()

    expect(diff).toContain('line three')
    expect(diff).toContain('+++')
    expect(diff).toContain('---')

    // Cleanup
    await unlink(tmpFile)
  })

  it('auto-memory extracts from conversation', () => {
    const dir = makeTempDir()
    const extractor = new AutoMemoryExtractor(dir)

    const turn = {
      userMessage: 'No, use Vitest instead of Jest.',
      assistantResponse: 'Understood, I will use Vitest for all tests.',
      sessionId: randomUUID(),
      turnIndex: 1,
    }

    const memories = extractor.extractFromTurn(turn)

    // At least one decision memory should be captured
    const decisions = memories.filter((m) => m.type === 'decision')
    expect(decisions.length).toBeGreaterThan(0)
    expect(decisions[0].content).toMatch(/Vitest/i)
  })

  it('prompt suggestions generate for code context', () => {
    const engine = new PromptSuggestionEngine()

    const suggestions = engine.generateSuggestions({
      lastUserMessage: 'Can you write a function to sort the array?',
      lastAssistantResponse: 'Sure! Here is the implementation:\n```typescript\nfunction sortArray(arr: number[]): number[] { return arr.sort(); }\n```',
      toolsUsed: [],
      conversationLength: 2,
    })

    expect(suggestions.length).toBeGreaterThan(0)

    const texts = suggestions.map((s) => s.text)
    // Should include at least one code-related suggestion
    const hasCodeSuggestion = texts.some(
      (t) =>
        t.toLowerCase().includes('test') ||
        t.toLowerCase().includes('explain') ||
        t.toLowerCase().includes('optimize'),
    )
    expect(hasCodeSuggestion).toBe(true)
  })

  it('rate limit monitor parses headers correctly', () => {
    const monitor = new RateLimitMonitor()

    monitor.updateFromHeaders('anthropic', {
      'x-ratelimit-limit-requests': '1000',
      'x-ratelimit-remaining-requests': '100',
      'x-ratelimit-limit-tokens': '100000',
      'x-ratelimit-remaining-tokens': '5000',
      'x-ratelimit-reset-requests': '60s',
    })

    const state = monitor.getState('anthropic')
    expect(state).toBeDefined()
    expect(state!.requestsLimit).toBe(1000)
    expect(state!.requestsUsed).toBe(900)
    expect(state!.tokensLimit).toBe(100000)
    expect(state!.tokensUsed).toBe(95000)
    // 95% token usage → critical
    expect(state!.warningLevel).toBe('critical')
  })

  it('error recovery advises on 429', () => {
    const advisor = new ErrorRecoveryAdvisor()

    const actions = advisor.advise(
      {
        statusCode: 429,
        message: 'Too many requests',
        provider: 'openai',
        model: 'gpt-4',
      },
      {
        availableProviders: ['openai', 'anthropic', 'ollama'],
        retryCount: 0,
        maxRetries: 3,
      },
    )

    const types = actions.map((a) => a.type)
    expect(types).toContain('retry')
    expect(types).toContain('switch_provider')
  })
})
