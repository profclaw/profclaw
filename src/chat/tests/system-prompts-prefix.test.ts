import { describe, it, expect, vi, beforeEach } from 'vitest';

interface FakeEntry {
  name: string;
  description: string;
  enabled: boolean;
  metadata: { priority: number };
}

const mockEntries: { list: FakeEntry[] } = { list: [] };

vi.mock('../../skills/index.js', () => ({
  getSkillsRegistry: () => ({ getAllEntries: () => [...mockEntries.list] }),
}));

import { buildSystemPrompt } from '../system-prompts.js';

function makeEntries(): FakeEntry[] {
  return ['delta', 'alpha', 'charlie', 'bravo', 'echo'].map((name) => ({
    name,
    description: `${name} skill`,
    enabled: true,
    metadata: { priority: 5 },
  }));
}

describe('system prompt prefix stability', () => {
  beforeEach(() => {
    mockEntries.list = makeEntries();
  });

  it('produces identical bytes across two builds with the same inputs', async () => {
    const a = await buildSystemPrompt('general', undefined, { enableTools: true });
    const b = await buildSystemPrompt('general', undefined, { enableTools: true });
    expect(a).toBe(b);
  });

  it('orders equal-priority skills by name regardless of registry order', async () => {
    const a = await buildSystemPrompt('general', undefined, { enableTools: true });
    mockEntries.list = makeEntries().reverse();
    const b = await buildSystemPrompt('general', undefined, { enableTools: true });
    expect(b).toBe(a);
    const names = [...a.matchAll(/^- (\w+): \w+ skill$/gm)].map((m) => m[1]);
    expect(names).toEqual(['alpha', 'bravo', 'charlie', 'delta', 'echo']);
  });
});
