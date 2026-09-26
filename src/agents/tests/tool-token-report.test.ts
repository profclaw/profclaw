import { describe, it, expect, beforeAll } from 'vitest';
import { initializeToolExecution, getToolRegistry } from '../../chat/execution/index.js';
import {
  estimateToolsTokens,
  selectToolsForRequest,
  resetToolSelectorSessions,
  type SelectableTool,
} from '../tool-selector.js';

/** Prints estimated tool-schema tokens per turn, before vs after selection. */
describe('tool schema tokens per turn (estimate, ~4 chars/token)', () => {
  let all: SelectableTool[] = [];

  beforeAll(async () => {
    await initializeToolExecution({ registerBuiltins: true });
    all = getToolRegistry().list().map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));
  });

  it('reports and asserts a saving', () => {
    resetToolSelectorSessions();
    const before = estimateToolsTokens(all);
    const scenarios: Array<[string, string]> = [
      ['neutral chat', 'explain how this repo is laid out'],
      ['git + tests', 'commit my changes and run the tests'],
      ['web research', 'look up https://example.com and summarize'],
    ];
    const lines = [`all tools: ${all.length} tools, ~${before} tokens/turn`];
    for (const [label, msg] of scenarios) {
      const picked = selectToolsForRequest(all, `report-${label}`, msg);
      const after = estimateToolsTokens(picked);
      lines.push(`${label}: ${picked.length} tools, ~${after} tokens/turn (saved ${Math.round((1 - after / before) * 100)}%)`);
      expect(after).toBeLessThan(before);
    }
    process.stdout.write(`\n[tool-token-report]\n${lines.join('\n')}\n`);
  });
});
