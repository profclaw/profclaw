import { describe, it, expect } from 'vitest'
import { execFile } from 'child_process'
import { promisify } from 'util'

const exec = promisify(execFile)
const CLI = 'node'
const ENTRY = './profclaw.mjs'

describe('CLI smoke tests', () => {
  it('profclaw --help exits 0', async () => {
    const { stdout } = await exec(CLI, [ENTRY, '--help'])
    expect(stdout).toContain('profclaw')
  })

  it('profclaw --version exits 0', async () => {
    const { stdout } = await exec(CLI, [ENTRY, '--version'])
    expect(stdout).toMatch(/\d+\.\d+\.\d+/)
  })

  it('profclaw chat --help shows options', async () => {
    const { stdout } = await exec(CLI, [ENTRY, 'chat', '--help'])
    expect(stdout).toContain('--tui')
    expect(stdout).toContain('--print')
    expect(stdout).toContain('--model')
  })

  it('profclaw plan --help shows subcommands', async () => {
    const { stdout } = await exec(CLI, [ENTRY, 'plan', '--help'])
    expect(stdout).toContain('list')
    expect(stdout).toContain('approve')
  })

  it('profclaw history --help shows subcommands', async () => {
    const { stdout } = await exec(CLI, [ENTRY, 'history', '--help'])
    expect(stdout).toContain('search')
  })

  it('profclaw init --help shows options', async () => {
    const { stdout } = await exec(CLI, [ENTRY, 'init', '--help'])
    expect(stdout).toContain('--force')
  })

  it('profclaw tui --help shows --ink flag', async () => {
    const { stdout } = await exec(CLI, [ENTRY, 'tui', '--help'])
    expect(stdout).toContain('--ink')
  })

  // Negative tests
  it('profclaw nonexistent-command exits non-zero', async () => {
    try {
      await exec(CLI, [ENTRY, 'nonexistent-command-xyz'])
      expect.fail('should have thrown')
    } catch (err: unknown) {
      const e = err as { code: number }
      expect(e.code).not.toBe(0)
    }
  })
})
