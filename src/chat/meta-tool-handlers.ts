/**
 * Meta-tool handlers: load_tools and fetch_result.
 *
 * Kept separate from tool-handler.ts so the handler stays small. These are pure
 * functions over injected dependencies, which also makes them easy to test.
 */

import type { ResultStore } from '../agents/result-store.js';
import { readStoredRange, getTruncationConfig } from '../agents/output-truncator.js';
import {
  type SelectableTool,
  type ToolSelectorSession,
  TOOL_GROUPS,
  describeTool,
  parseFetchResultArgs,
  parseLoadToolsArgs,
  toolsInGroup,
} from '../agents/tool-selector.js';

export interface LoadToolsDeps {
  session: ToolSelectorSession;
  /** Every available tool (not just the selected ones) */
  allTools: readonly SelectableTool[];
  /** Runs a tool through the normal security pipeline */
  invoke: (tool: string, args: Record<string, unknown>) => Promise<unknown>;
}

export async function runLoadTools(args: unknown, deps: LoadToolsDeps): Promise<unknown> {
  const parsed = parseLoadToolsArgs(args);
  if (!parsed) {
    return { success: false, error: 'load_tools expects { groups: string[] }' };
  }

  const loaded = deps.session.loadGroups(parsed.groups);
  const unknown = parsed.groups.filter((g) => !loaded.includes(g.trim().toLowerCase()));

  const tools = loaded.flatMap((group) => toolsInGroup(deps.allTools, group).map(describeTool));

  const response: Record<string, unknown> = {
    success: loaded.length > 0,
    loaded,
    tools,
    note: 'These tools are callable from the next turn. Use invoke to call one now.',
  };
  if (unknown.length > 0) {
    response.unknownGroups = unknown;
    response.validGroups = TOOL_GROUPS.map((g) => g.name);
  }

  if (parsed.invoke) {
    const target = parsed.invoke.tool;
    const inLoaded = tools.some((t) => t.name === target);
    if (!inLoaded) {
      response.invokeError = `Tool "${target}" is not in the loaded groups`;
    } else {
      response.invokeResult = await deps.invoke(target, parsed.invoke.args ?? {});
    }
  }
  return response;
}

export async function runFetchResult(args: unknown, store: ResultStore): Promise<unknown> {
  const parsed = parseFetchResultArgs(args);
  if (!parsed) {
    return { success: false, error: 'fetch_result expects { result_id, offset?, length? }' };
  }
  const config = getTruncationConfig();
  const range = await readStoredRange(
    store,
    parsed.result_id,
    parsed.offset ?? 0,
    parsed.length ?? config.fetchMaxChars,
    config,
  );
  if (!range) {
    return { success: false, error: `No stored result with id "${parsed.result_id}"` };
  }
  return range;
}
