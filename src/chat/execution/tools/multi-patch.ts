/**
 * Multi-File Patch Tool
 *
 * Applies OpenAI-style multi-file patches that can add, update, and delete
 * multiple files in a single operation.
 *
 * Format:
 *   *** Begin Patch
 *   *** Add File: path/to/new.ts
 *   [file content]
 *   *** Update File: path/to/existing.ts
 *   @@ context @@
 *   -old line
 *   +new line
 *   *** Delete File: path/to/remove.ts
 *   *** End Patch
 */

import { z } from 'zod';
import fs from 'fs/promises';
import path from 'path';
import type { ToolDefinition, ToolResult, ToolExecutionContext } from '../types.js';
import { getFsGuard } from '../../../security/fs-guard.js';
import { logger } from '../../../utils/logger.js';

// ---- Schema ----------------------------------------------------------------

const MultiPatchParamsSchema = z.object({
  patch: z.string().min(1).describe(
    'Multi-file patch in OpenAI patch format. Must start with "*** Begin Patch" and end with "*** End Patch".',
  ),
  workdir: z.string().optional().describe(
    'Override workspace root for path resolution. Defaults to the session workdir.',
  ),
});

export type MultiPatchParams = z.infer<typeof MultiPatchParamsSchema>;

// ---- Result types ----------------------------------------------------------

export interface MultiPatchFileResult {
  /** The file path that was targeted. */
  path: string;
  /** Operation performed on this file. */
  operation: 'add' | 'update' | 'delete';
  /** Whether the operation succeeded. */
  success: boolean;
  /** Number of hunks applied (update only). */
  hunks?: number;
  /** Error message if the operation failed. */
  error?: string;
}

export interface MultiPatchResult {
  /** Per-file results. */
  files: MultiPatchFileResult[];
  /** Total files successfully changed. */
  applied: number;
  /** Total files that failed. */
  failed: number;
}

// ---- Internal patch segment types -----------------------------------------

type PatchOperation = 'add' | 'update' | 'delete';

interface PatchSegment {
  operation: PatchOperation;
  filePath: string;
  /** Raw lines belonging to this segment (content for add, diff lines for update). */
  lines: string[];
}

// ---- Parsing ---------------------------------------------------------------

const BEGIN_MARKER = '*** Begin Patch';
const END_MARKER = '*** End Patch';
const ADD_PREFIX = '*** Add File: ';
const UPDATE_PREFIX = '*** Update File: ';
const DELETE_PREFIX = '*** Delete File: ';

/**
 * Parse the multi-file patch string into ordered segments.
 * Throws with a descriptive message on format errors.
 */
function parsePatch(patch: string): PatchSegment[] {
  const lines = patch.split('\n');

  // Find begin/end markers
  const beginIdx = lines.findIndex((l) => l.trim() === BEGIN_MARKER);
  const endIdx = lines.findIndex((l) => l.trim() === END_MARKER);

  if (beginIdx === -1) {
    throw new Error(`Patch must start with "${BEGIN_MARKER}"`);
  }
  if (endIdx === -1) {
    throw new Error(`Patch must end with "${END_MARKER}"`);
  }
  if (endIdx <= beginIdx) {
    throw new Error(`"${END_MARKER}" must appear after "${BEGIN_MARKER}"`);
  }

  const body = lines.slice(beginIdx + 1, endIdx);
  const segments: PatchSegment[] = [];
  let current: PatchSegment | null = null;

  for (const line of body) {
    if (line.startsWith(ADD_PREFIX)) {
      if (current) segments.push(current);
      current = { operation: 'add', filePath: line.slice(ADD_PREFIX.length).trim(), lines: [] };
    } else if (line.startsWith(UPDATE_PREFIX)) {
      if (current) segments.push(current);
      current = { operation: 'update', filePath: line.slice(UPDATE_PREFIX.length).trim(), lines: [] };
    } else if (line.startsWith(DELETE_PREFIX)) {
      if (current) segments.push(current);
      // Delete segments have no body lines - push immediately.
      segments.push({ operation: 'delete', filePath: line.slice(DELETE_PREFIX.length).trim(), lines: [] });
      current = null;
    } else if (current) {
      current.lines.push(line);
    }
    // Lines before the first directive are ignored (e.g. blank lines after Begin Patch).
  }

  if (current) segments.push(current);

  if (segments.length === 0) {
    throw new Error('Patch contains no file operations');
  }

  return segments;
}

// ---- Unified diff application ----------------------------------------------

/**
 * Apply unified-diff hunks to file content.
 * Supports the @@ -L,N +L,N @@ header format used in standard and OpenAI patches.
 */
function applyHunks(content: string, diffLines: string[]): { result: string; hunks: number } {
  const fileLines = content.split('\n');
  let hunks = 0;
  let offset = 0;

  for (let i = 0; i < diffLines.length; i++) {
    const line = diffLines[i];
    const hunkMatch = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (!hunkMatch) continue;

    hunks++;
    const startLine = parseInt(hunkMatch[1], 10) - 1 + offset;
    const removals: number[] = [];
    const additions: string[] = [];

    for (let j = i + 1; j < diffLines.length; j++) {
      const dl = diffLines[j];

      // Next hunk header - stop consuming, back up so outer loop sees it
      if (dl.match(/^@@ -\d/)) {
        i = j - 1;
        break;
      }

      const prefix = dl[0];
      const text = dl.slice(1);

      if (prefix === '-') {
        // Find this line near the expected position
        const searchStart = startLine + removals.length + additions.length;
        let found = -1;
        for (let s = Math.max(0, searchStart - 3); s < Math.min(fileLines.length, searchStart + 4); s++) {
          if (fileLines[s] === text && !removals.includes(s)) {
            found = s;
            break;
          }
        }
        if (found === -1) {
          throw new Error(`Hunk failed: could not find line "${text}" near line ${searchStart + 1}`);
        }
        removals.push(found);
      } else if (prefix === '+') {
        additions.push(text);
      }
      // Context lines (space or no prefix) are skipped
    }

    // Remove in reverse order to preserve indices, then insert
    removals.sort((a, b) => b - a);
    for (const idx of removals) {
      fileLines.splice(idx, 1);
    }

    const insertAt = removals.length > 0 ? Math.min(...removals) : startLine;
    fileLines.splice(insertAt, 0, ...additions);

    offset += additions.length - removals.length;
  }

  if (hunks === 0) {
    throw new Error('No valid hunks found in update segment');
  }

  return { result: fileLines.join('\n'), hunks };
}

// ---- Security helpers ------------------------------------------------------

const BLOCKED_PATH_FRAGMENTS = [
  '/etc/passwd',
  '/etc/shadow',
  '.ssh',
  '.gnupg',
  '.env',
];

function isBlockedPath(filePath: string): boolean {
  const normalized = filePath.toLowerCase();
  return BLOCKED_PATH_FRAGMENTS.some((fragment) => normalized.includes(fragment.toLowerCase()));
}

function resolveSafePath(inputPath: string, workdir: string): string {
  const resolved = path.isAbsolute(inputPath)
    ? inputPath
    : path.resolve(workdir, inputPath);

  // Ensure the resolved path stays within the workspace root
  const relative = path.relative(workdir, resolved);
  if (relative.startsWith('..')) {
    throw new Error(`Path "${inputPath}" resolves outside the workspace root`);
  }

  return resolved;
}

// ---- Segment execution -----------------------------------------------------

async function applySegment(
  segment: PatchSegment,
  workdir: string,
): Promise<MultiPatchFileResult> {
  let filePath: string;

  try {
    filePath = resolveSafePath(segment.filePath, workdir);
  } catch (err) {
    return {
      path: segment.filePath,
      operation: segment.operation,
      success: false,
      error: err instanceof Error ? err.message : 'Path resolution failed',
    };
  }

  // Blocked path check (FsGuard with fallback)
  const fsGuard = getFsGuard();
  if (fsGuard) {
    const mode = segment.operation === 'delete' ? 'delete' : 'write';
    const guardResult = await fsGuard.validatePath(filePath, mode);
    if (!guardResult.allowed) {
      return {
        path: segment.filePath,
        operation: segment.operation,
        success: false,
        error: guardResult.reason ?? 'Path access denied',
      };
    }
  } else if (isBlockedPath(filePath)) {
    return {
      path: segment.filePath,
      operation: segment.operation,
      success: false,
      error: 'Access to this path is not allowed',
    };
  }

  try {
    switch (segment.operation) {
      case 'add': {
        // Fail if file already exists to prevent accidental overwrites
        try {
          await fs.stat(filePath);
          return {
            path: segment.filePath,
            operation: 'add',
            success: false,
            error: 'File already exists - use Update File to modify existing files',
          };
        } catch {
          // Expected: file does not exist
        }

        await fs.mkdir(path.dirname(filePath), { recursive: true });
        // Strip trailing blank line added by patch format if present
        const content = segment.lines.join('\n').replace(/\n$/, '');
        await fs.writeFile(filePath, content, 'utf-8');
        logger.debug(`[MultiPatch] Added ${segment.filePath}`, { component: 'MultiPatch' });

        return { path: segment.filePath, operation: 'add', success: true };
      }

      case 'update': {
        let existing: string;
        try {
          existing = await fs.readFile(filePath, 'utf-8');
        } catch {
          return {
            path: segment.filePath,
            operation: 'update',
            success: false,
            error: 'File does not exist - use Add File to create new files',
          };
        }

        const { result, hunks } = applyHunks(existing, segment.lines);
        await fs.writeFile(filePath, result, 'utf-8');
        logger.debug(`[MultiPatch] Updated ${segment.filePath} (${hunks} hunk(s))`, { component: 'MultiPatch' });

        return { path: segment.filePath, operation: 'update', success: true, hunks };
      }

      case 'delete': {
        try {
          await fs.unlink(filePath);
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Unknown error';
          return {
            path: segment.filePath,
            operation: 'delete',
            success: false,
            error: `Could not delete file: ${msg}`,
          };
        }
        logger.debug(`[MultiPatch] Deleted ${segment.filePath}`, { component: 'MultiPatch' });

        return { path: segment.filePath, operation: 'delete', success: true };
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      path: segment.filePath,
      operation: segment.operation,
      success: false,
      error: message,
    };
  }
}

// ---- Tool definition -------------------------------------------------------

export const multiPatchTool: ToolDefinition<MultiPatchParams, MultiPatchResult> = {
  name: 'multi_patch',
  description: `Apply a multi-file patch in OpenAI patch format. Supports adding new files,
updating existing files (unified diff hunks), and deleting files in a single operation.

Format:
  *** Begin Patch
  *** Add File: path/to/new.ts
  [full file content]
  *** Update File: path/to/existing.ts
  @@ -10,7 +10,7 @@
   context line
  -removed line
  +added line
   context line
  *** Delete File: path/to/obsolete.ts
  *** End Patch

All paths are resolved relative to the workspace root. Paths that escape the workspace
root or match blocked patterns (e.g. .env, .ssh) are rejected.`,
  category: 'filesystem',
  securityLevel: 'moderate',
  requiresApproval: true,
  allowedHosts: ['sandbox', 'gateway', 'local'],
  parameters: MultiPatchParamsSchema,
  examples: [
    {
      description: 'Add a new file and update an existing one',
      params: {
        patch: [
          '*** Begin Patch',
          '*** Add File: src/utils/helper.ts',
          'export function add(a: number, b: number): number {',
          '  return a + b;',
          '}',
          '*** Update File: src/index.ts',
          '@@ -1,3 +1,4 @@',
          ' import { something } from "./other.js";',
          "+import { add } from './utils/helper.js';",
          ' ',
          ' export default {};',
          '*** End Patch',
        ].join('\n'),
      },
    },
  ],

  async execute(context: ToolExecutionContext, params: MultiPatchParams): Promise<ToolResult<MultiPatchResult>> {
    const workdir = params.workdir ?? context.workdir;

    // Parse the patch
    let segments: PatchSegment[];
    try {
      segments = parsePatch(params.patch);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        error: { code: 'PARSE_ERROR', message: `Failed to parse patch: ${message}` },
      };
    }

    // Apply each segment (sequentially - order matters for dependencies)
    const results: MultiPatchFileResult[] = [];
    for (const segment of segments) {
      const result = await applySegment(segment, workdir);
      results.push(result);
    }

    const applied = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    // Build a human-readable summary
    const summaryLines: string[] = [
      `Multi-patch applied: ${applied} succeeded, ${failed} failed`,
      '',
    ];

    for (const r of results) {
      const icon = r.success ? '+' : 'x';
      const opLabel = r.operation.toUpperCase().padEnd(6);
      const detail = r.hunks !== undefined ? ` (${r.hunks} hunk${r.hunks !== 1 ? 's' : ''})` : '';
      const errorNote = r.error ? ` - ${r.error}` : '';
      summaryLines.push(`  [${icon}] ${opLabel} ${r.path}${detail}${errorNote}`);
    }

    const output = summaryLines.join('\n');

    if (failed > 0 && applied === 0) {
      return {
        success: false,
        data: { files: results, applied, failed },
        error: {
          code: 'PATCH_FAILED',
          message: `All ${failed} operation(s) failed. See data.files for details.`,
        },
      };
    }

    return {
      success: true,
      data: { files: results, applied, failed },
      output,
    };
  },
};
