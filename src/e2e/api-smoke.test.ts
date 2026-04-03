/**
 * API Smoke Tests
 *
 * These tests require a running profClaw server. They are skipped automatically
 * when the server is not available (e.g. in CI without a server process).
 *
 * To run against a local server:
 *   pnpm profclaw serve &
 *   pnpm vitest run src/e2e/api-smoke.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest'

const BASE_URL = process.env.PROFCLAW_API_URL ?? 'http://localhost:3000'
const HEALTH_URL = `${BASE_URL}/health`

// ---------------------------------------------------------------------------
// Server availability probe
// ---------------------------------------------------------------------------

let serverAvailable = false

beforeAll(async () => {
  try {
    const res = await fetch(HEALTH_URL, {
      signal: AbortSignal.timeout(2000),
    })
    serverAvailable = res.ok
  } catch {
    serverAvailable = false
  }
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function apiUrl(path: string): string {
  return `${BASE_URL}${path}`
}

async function getJson(path: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(apiUrl(path), {
    signal: AbortSignal.timeout(5000),
  })
  const body = await res.json()
  return { status: res.status, body }
}

async function postJson(
  path: string,
  payload: Record<string, unknown>,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(apiUrl(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10000),
  })
  const body = await res.json()
  return { status: res.status, body }
}

// ---------------------------------------------------------------------------
// Smoke tests
// ---------------------------------------------------------------------------

describe.skipIf(!serverAvailable)('API smoke tests', () => {
  it('GET /health returns ok', async () => {
    const { status, body } = await getJson('/health')
    expect(status).toBe(200)
    expect((body as Record<string, unknown>).status).toBe('ok')
  })

  it('GET /api/chat/providers returns providers array', async () => {
    const { status, body } = await getJson('/api/chat/providers')
    expect(status).toBe(200)
    const b = body as Record<string, unknown>
    // The response may be { providers: [...] } or an array directly
    const providers = Array.isArray(b) ? b : (b.providers as unknown[])
    expect(Array.isArray(providers)).toBe(true)
  })

  it('GET /api/chat/models returns models array', async () => {
    const { status, body } = await getJson('/api/chat/models')
    expect(status).toBe(200)
    const b = body as Record<string, unknown>
    const models = Array.isArray(b) ? b : (b.models as unknown[])
    expect(Array.isArray(models)).toBe(true)
  })

  it('POST /api/chat/quick with valid prompt returns content', async () => {
    const { status, body } = await postJson('/api/chat/quick', {
      prompt: 'Say hello in one word.',
    })
    expect(status).toBe(200)
    const b = body as Record<string, unknown>
    // Response should contain content or message text
    const hasContent =
      typeof b.content === 'string' ||
      (typeof b.message === 'object' &&
        b.message !== null &&
        typeof (b.message as Record<string, unknown>).content === 'string')
    expect(hasContent).toBe(true)
  })

  it('POST /api/chat/quick with empty prompt returns 400', async () => {
    const { status } = await postJson('/api/chat/quick', { prompt: '' })
    expect(status).toBe(400)
  })

  it('POST /api/chat/conversations creates conversation', async () => {
    const { status, body } = await postJson('/api/chat/conversations', {
      title: 'Smoke test conversation',
    })
    expect(status).toBe(201)
    const b = body as Record<string, unknown>
    const conversation = b.conversation as Record<string, unknown>
    expect(conversation).toBeDefined()
    expect(typeof conversation.id).toBe('string')
    expect(conversation.title).toBe('Smoke test conversation')
  })

  it('GET /api/tasks returns tasks array', async () => {
    const { status, body } = await getJson('/api/tasks')
    expect(status).toBe(200)
    const b = body as Record<string, unknown>
    const tasks = Array.isArray(b) ? b : (b.tasks as unknown[])
    expect(Array.isArray(tasks)).toBe(true)
  })

  it('GET /api/channels returns channels array', async () => {
    const { status, body } = await getJson('/api/channels')
    expect(status).toBe(200)
    const b = body as Record<string, unknown>
    const channels = Array.isArray(b) ? b : (b.channels as unknown[])
    expect(Array.isArray(channels)).toBe(true)
  })
})
