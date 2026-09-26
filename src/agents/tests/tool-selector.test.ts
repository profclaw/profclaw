import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import {
  ToolSelectorSession,
  selectToolsForRequest,
  resetToolSelectorSessions,
  getToolSelectorSession,
  groupOfTool,
  LOAD_TOOLS_NAME,
  FETCH_RESULT_NAME,
  CORE_TOOL_NAMES,
  type SelectableTool,
} from '../tool-selector.js';
import { runLoadTools } from '../../chat/meta-tool-handlers.js';

const NAMES = [
  ...CORE_TOOL_NAMES,
  'git_status', 'git_diff', 'git_commit', 'create_pr',
  'test_run', 'lint', 'build',
  'web_fetch', 'web_search',
  'browser_navigate', 'browser_click',
  'memory_search', 'memory_get',
  'cron_create', 'cron_list',
  'slack_actions', 'notify',
  'directory_tree', 'system_info',
  'mcp_custom_thing',
];

function makeTools(list: string[] = NAMES): SelectableTool[] {
  return list.map((name) => ({
    name,
    description: `${name} description`,
    parameters: z.object({ x: z.string().optional() }),
  }));
}

const names = (tools: SelectableTool[]): string[] => tools.map((t) => t.name);

describe('tool selector', () => {
  beforeEach(() => {
    resetToolSelectorSessions();
    delete process.env.PROFCLAW_TOOL_SELECTION;
    delete process.env.PROFCLAW_TOOL_SELECTION_MIN_TOOLS;
    delete process.env.PROFCLAW_TOOL_SELECTION_KEEP_UNGROUPED;
  });
  afterEach(() => {
    delete process.env.PROFCLAW_TOOL_SELECTION;
    delete process.env.PROFCLAW_TOOL_SELECTION_KEEP_UNGROUPED;
  });

  it('sends only core tools (plus ungrouped) for a neutral message', () => {
    const picked = names(new ToolSelectorSession().select(makeTools(), 'hello there'));
    for (const core of CORE_TOOL_NAMES) expect(picked).toContain(core);
    expect(picked).toContain('mcp_custom_thing');
    expect(picked).not.toContain('git_status');
    expect(picked).not.toContain('browser_click');
    expect(picked.length).toBeLessThan(NAMES.length);
  });

  it('can drop ungrouped tools via env', () => {
    process.env.PROFCLAW_TOOL_SELECTION_KEEP_UNGROUPED = 'false';
    const picked = names(new ToolSelectorSession().select(makeTools(), 'hello'));
    expect(picked).not.toContain('mcp_custom_thing');
  });

  it('picks groups by keyword in the user message', () => {
    const s = new ToolSelectorSession();
    const picked = names(s.select(makeTools(), 'please commit this and run the tests'));
    expect(picked).toContain('git_commit');
    expect(picked).toContain('test_run');
    expect(picked).not.toContain('cron_create');
    expect(picked).not.toContain('slack_actions');
  });

  it('matches URLs to the web group', () => {
    const picked = names(new ToolSelectorSession().select(makeTools(), 'summarize https://example.com'));
    expect(picked).toContain('web_fetch');
  });

  it('keeps groups of recently used tools', () => {
    const s = new ToolSelectorSession();
    s.noteToolUse('cron_create');
    expect(names(s.select(makeTools(), 'ok'))).toContain('cron_list');
  });

  it('output is sorted and stable across turns', () => {
    const s = new ToolSelectorSession();
    const shuffled = [...NAMES].reverse();
    const first = names(s.select(makeTools(shuffled), 'check git diff'));
    expect(first).toEqual([...first].sort());
    // A later neutral message does not shrink or reorder the set
    const second = names(s.select(makeTools(), 'thanks'));
    expect(second).toEqual(first);
    // A new need only adds tools
    const third = names(s.select(makeTools(), 'and schedule a cron job'));
    expect(third).toEqual([...third].sort());
    for (const n of first) expect(third).toContain(n);
    expect(third).toContain('cron_create');
  });

  it('selectToolsForRequest appends stable meta-tools, sorted', () => {
    const a = selectToolsForRequest(makeTools(), 'conv-1', 'hi');
    const b = selectToolsForRequest(makeTools([...NAMES].reverse()), 'conv-1', 'hi');
    expect(a.map((t) => t.name)).toEqual(b.map((t) => t.name));
    expect(a.map((t) => t.name)).toContain(LOAD_TOOLS_NAME);
    expect(a.map((t) => t.name)).toContain(FETCH_RESULT_NAME);
    expect(JSON.stringify(a.map((t) => t.description))).toEqual(JSON.stringify(b.map((t) => t.description)));
  });

  it('is disabled by env flag', () => {
    process.env.PROFCLAW_TOOL_SELECTION = 'off';
    const out = selectToolsForRequest(makeTools(), 'conv-2', 'hi');
    expect(out.map((t) => t.name)).toEqual(NAMES);
  });

  it('skips selection for small tool sets', () => {
    const small = makeTools(['read_file', 'git_status']);
    expect(selectToolsForRequest(small, 'conv-3', 'hi').map((t) => t.name)).toEqual(['read_file', 'git_status']);
  });

  it('groupOfTool resolves prefixes', () => {
    expect(groupOfTool('browser_anything')).toBe('browser');
    expect(groupOfTool('read_file')).toBeUndefined();
  });
});

describe('load_tools on-demand path', () => {
  beforeEach(() => resetToolSelectorSessions());

  it('loads a group, returns schemas, and adds it to later selections', async () => {
    const all = makeTools();
    const session = getToolSelectorSession('conv-x');
    expect(names(session.select(all, 'hi'))).not.toContain('browser_click');

    const res = (await runLoadTools({ groups: ['browser'] }, {
      session,
      allTools: all,
      invoke: async () => ({}),
    })) as { success: boolean; loaded: string[]; tools: Array<{ name: string }> };

    expect(res.success).toBe(true);
    expect(res.loaded).toEqual(['browser']);
    expect(res.tools.map((t) => t.name)).toEqual(['browser_click', 'browser_navigate']);
    expect(names(session.select(all, 'hi'))).toContain('browser_click');
  });

  it('reports unknown groups and supports invoke', async () => {
    const all = makeTools();
    const session = getToolSelectorSession('conv-y');
    const calls: string[] = [];
    const res = (await runLoadTools(
      { groups: ['nope', 'cron'], invoke: { tool: 'cron_list', args: {} } },
      { session, allTools: all, invoke: async (t) => { calls.push(t); return { ok: true }; } },
    )) as { unknownGroups: string[]; invokeResult: unknown };
    expect(res.unknownGroups).toEqual(['nope']);
    expect(calls).toEqual(['cron_list']);
    expect(res.invokeResult).toEqual({ ok: true });
  });

  it('rejects invoke of a tool outside the loaded groups', async () => {
    const res = (await runLoadTools(
      { groups: ['cron'], invoke: { tool: 'git_commit' } },
      { session: new ToolSelectorSession(), allTools: makeTools(), invoke: async () => ({}) },
    )) as { invokeError?: string };
    expect(res.invokeError).toContain('git_commit');
  });
});
