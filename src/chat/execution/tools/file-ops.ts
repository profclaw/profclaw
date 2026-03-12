/**
 * File Operations Tool
 *
 * Read, write, and search files with safety controls.
 */

import { z } from 'zod';
import fs from 'fs/promises';
import path from 'path';
import { glob } from 'glob';
import type { ToolDefinition, ToolResult, ToolExecutionContext } from '../types.js';
import { logger } from '../../../utils/logger.js';

// =============================================================================
// Schemas
// =============================================================================

const ReadFileParamsSchema = z.object({
  path: z.string().min(1).describe('File path to read'),
  encoding: z.enum(['utf-8', 'base64']).optional().default('utf-8'),
  lines: z.number().optional().describe('Max lines to read (from start)'),
  offset: z.number().optional().describe('Start from this line number'),
});

const WriteFileParamsSchema = z.object({
  path: z.string().min(1).describe('File path to write'),
  content: z.string().describe('Content to write'),
  append: z.boolean().optional().describe('Append instead of overwrite'),
  createDirs: z.boolean().optional().describe('Create parent directories'),
});

const SearchFilesParamsSchema = z.object({
  pattern: z.string().describe('Glob pattern (e.g., "**/*.ts")'),
  directory: z.string().optional().describe('Base directory'),
  maxResults: z.number().optional().default(100),
});

const GrepParamsSchema = z.object({
  pattern: z.string().describe('Search pattern (regex)'),
  path: z.string().optional().describe('File or directory to search'),
  glob: z.string().optional().describe('Glob pattern for files'),
  maxResults: z.number().optional().default(50),
  context: z.number().optional().describe('Lines of context'),
});

const EditFileParamsSchema = z.object({
  path: z.string().min(1).describe('File path to edit'),
  old_string: z.string().min(1).describe('Exact string to find (must be unique in file)'),
  new_string: z.string().describe('Replacement string'),
  replace_all: z.boolean().optional().default(false).describe('Replace all occurrences'),
});

const DirectoryTreeParamsSchema = z.object({
  path: z.string().optional().default('.').describe('Root directory'),
  depth: z.number().optional().default(3).describe('Max depth (1-10)'),
  include_files: z.boolean().optional().default(true).describe('Include files (not just directories)'),
  pattern: z.string().optional().describe('Filter by glob pattern (e.g., "*.ts")'),
});

const PatchApplyParamsSchema = z.object({
  path: z.string().describe('File to patch'),
  patch: z.string().describe('Unified diff content'),
  reverse: z.boolean().optional().default(false).describe('Apply patch in reverse'),
});

export type ReadFileParams = z.infer<typeof ReadFileParamsSchema>;
export type WriteFileParams = z.infer<typeof WriteFileParamsSchema>;
export type SearchFilesParams = z.infer<typeof SearchFilesParamsSchema>;
export type GrepParams = z.infer<typeof GrepParamsSchema>;
export type EditFileParams = z.infer<typeof EditFileParamsSchema>;
export type DirectoryTreeParams = z.infer<typeof DirectoryTreeParamsSchema>;
export type PatchApplyParams = z.infer<typeof PatchApplyParamsSchema>;

// =============================================================================
// Constants
// =============================================================================

const MAX_FILE_SIZE = 10_000_000; // 10MB
const MAX_OUTPUT_LINES = 2000;
const BLOCKED_PATHS = [
  '/etc/passwd',
  '/etc/shadow',
  '~/.ssh',
  '~/.gnupg',
  '.env',
  '.env.local',
  '.env.production',
];

// =============================================================================
// Read File Tool
// =============================================================================

export const readFileTool: ToolDefinition<ReadFileParams, ReadFileResult> = {
  name: 'read_file',
  description: `Read content from a file. Supports text and binary (base64) files.
Can read specific line ranges for large files.`,
  category: 'filesystem',
  securityLevel: 'safe',
  allowedHosts: ['sandbox', 'gateway', 'local'],
  parameters: ReadFileParamsSchema,
  examples: [
    { description: 'Read a file', params: { path: 'src/index.ts' } },
    { description: 'Read first 100 lines', params: { path: 'large.log', lines: 100 } },
  ],

  async execute(context: ToolExecutionContext, params: ReadFileParams): Promise<ToolResult<ReadFileResult>> {
    const filePath = resolvePath(params.path, context.workdir);

    // Security check
    if (isBlockedPath(filePath)) {
      return {
        success: false,
        error: {
          code: 'BLOCKED_PATH',
          message: 'Access to this file is not allowed',
        },
      };
    }

    try {
      // Check file exists and size
      const stats = await fs.stat(filePath);
      if (!stats.isFile()) {
        return {
          success: false,
          error: {
            code: 'NOT_A_FILE',
            message: `${params.path} is not a file`,
          },
        };
      }

      if (stats.size > MAX_FILE_SIZE) {
        return {
          success: false,
          error: {
            code: 'FILE_TOO_LARGE',
            message: `File is too large: ${(stats.size / 1_000_000).toFixed(1)}MB (max: ${MAX_FILE_SIZE / 1_000_000}MB)`,
          },
        };
      }

      // Read file
      const content = await fs.readFile(filePath, params.encoding === 'base64' ? 'base64' : 'utf-8');

      // Handle line limits
      let outputContent = content;
      let truncated = false;

      if (typeof content === 'string' && (params.lines || params.offset)) {
        const lines = content.split('\n');
        const start = params.offset ?? 0;
        const end = params.lines ? start + params.lines : lines.length;
        const sliced = lines.slice(start, end);
        outputContent = sliced.join('\n');
        truncated = sliced.length < lines.length;
      }

      return {
        success: true,
        data: {
          path: params.path,
          content: outputContent,
          size: stats.size,
          encoding: params.encoding ?? 'utf-8',
          truncated,
        },
        output: outputContent,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        error: {
          code: 'READ_ERROR',
          message: `Failed to read file: ${message}`,
        },
      };
    }
  },
};

// =============================================================================
// Write File Tool
// =============================================================================

export const writeFileTool: ToolDefinition<WriteFileParams, WriteFileResult> = {
  name: 'write_file',
  description: `Write content to a file. Can create new files or overwrite existing ones.
Use append=true to add to the end of a file.`,
  category: 'filesystem',
  securityLevel: 'moderate',
  requiresApproval: true,
  allowedHosts: ['sandbox', 'gateway', 'local'],
  parameters: WriteFileParamsSchema,
  examples: [
    { description: 'Write a file', params: { path: 'output.txt', content: 'Hello, World!' } },
    { description: 'Append to log', params: { path: 'app.log', content: 'New entry\n', append: true } },
  ],

  async execute(context: ToolExecutionContext, params: WriteFileParams): Promise<ToolResult<WriteFileResult>> {
    const filePath = resolvePath(params.path, context.workdir);

    // Security check
    if (isBlockedPath(filePath)) {
      return {
        success: false,
        error: {
          code: 'BLOCKED_PATH',
          message: 'Writing to this location is not allowed',
        },
      };
    }

    try {
      // Create parent directories if needed
      if (params.createDirs) {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
      }

      // Write file
      if (params.append) {
        await fs.appendFile(filePath, params.content, 'utf-8');
      } else {
        await fs.writeFile(filePath, params.content, 'utf-8');
      }

      const stats = await fs.stat(filePath);

      logger.debug(`[FileOps] Wrote ${stats.size} bytes to ${params.path}`, { component: 'FileOps' });

      return {
        success: true,
        data: {
          path: params.path,
          size: stats.size,
          appended: params.append ?? false,
        },
        output: `Successfully wrote ${stats.size} bytes to ${params.path}`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        error: {
          code: 'WRITE_ERROR',
          message: `Failed to write file: ${message}`,
        },
      };
    }
  },
};

// =============================================================================
// Search Files Tool
// =============================================================================

export const searchFilesTool: ToolDefinition<SearchFilesParams, SearchFilesResult> = {
  name: 'search_files',
  description: `Search for files using glob patterns.
Examples: "**/*.ts" for all TypeScript files, "src/**/*.test.ts" for tests.`,
  category: 'filesystem',
  securityLevel: 'safe',
  allowedHosts: ['sandbox', 'gateway', 'local'],
  parameters: SearchFilesParamsSchema,
  examples: [
    { description: 'Find TypeScript files', params: { pattern: '**/*.ts' } },
    { description: 'Find tests in src', params: { pattern: '*.test.ts', directory: 'src' } },
  ],

  async execute(context: ToolExecutionContext, params: SearchFilesParams): Promise<ToolResult<SearchFilesResult>> {
    const baseDir = params.directory
      ? resolvePath(params.directory, context.workdir)
      : context.workdir;

    try {
      const files = await glob(params.pattern, {
        cwd: baseDir,
        nodir: true,
        ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**'],
      });

      const limited = files.slice(0, params.maxResults);
      const truncated = files.length > params.maxResults;

      return {
        success: true,
        data: {
          files: limited,
          total: files.length,
          truncated,
        },
        output: limited.length > 0
          ? `Found ${files.length} files:\n${limited.join('\n')}${truncated ? '\n...(truncated)' : ''}`
          : 'No files found',
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        error: {
          code: 'SEARCH_ERROR',
          message: `Failed to search files: ${message}`,
        },
      };
    }
  },
};

// =============================================================================
// Grep Tool
// =============================================================================

export const grepTool: ToolDefinition<GrepParams, GrepResult> = {
  name: 'grep',
  description: `Search for patterns in file contents using regex.
Returns matching lines with file paths and line numbers.`,
  category: 'filesystem',
  securityLevel: 'safe',
  allowedHosts: ['sandbox', 'gateway', 'local'],
  parameters: GrepParamsSchema,
  examples: [
    { description: 'Find TODO comments', params: { pattern: 'TODO:', glob: '**/*.ts' } },
    { description: 'Find function', params: { pattern: 'function handleSubmit', path: 'src' } },
  ],

  async execute(context: ToolExecutionContext, params: GrepParams): Promise<ToolResult<GrepResult>> {
    const searchPath = params.path
      ? resolvePath(params.path, context.workdir)
      : context.workdir;

    try {
      const regex = new RegExp(params.pattern, 'gi');
      const matches: GrepMatch[] = [];

      // Find files to search
      let files: string[];
      const stats = await fs.stat(searchPath);

      if (stats.isFile()) {
        files = [searchPath];
      } else {
        const globPattern = params.glob ?? '**/*';
        files = await glob(globPattern, {
          cwd: searchPath,
          nodir: true,
          ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**'],
          absolute: true,
        });
      }

      // Search files
      for (const file of files) {
        if (matches.length >= params.maxResults) break;

        try {
          const content = await fs.readFile(file, 'utf-8');
          const lines = content.split('\n');

          for (let i = 0; i < lines.length; i++) {
            if (regex.test(lines[i])) {
              matches.push({
                file: path.relative(context.workdir, file),
                line: i + 1,
                content: lines[i].trim(),
                context: params.context
                  ? lines.slice(Math.max(0, i - params.context), i + params.context + 1).join('\n')
                  : undefined,
              });

              if (matches.length >= params.maxResults) break;
            }
            regex.lastIndex = 0; // Reset regex
          }
        } catch {
          // Skip unreadable files
        }
      }

      return {
        success: true,
        data: {
          matches,
          total: matches.length,
          pattern: params.pattern,
        },
        output: matches.length > 0
          ? matches.map((m) => `${m.file}:${m.line}: ${m.content}`).join('\n')
          : 'No matches found',
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        error: {
          code: 'GREP_ERROR',
          message: `Search failed: ${message}`,
        },
      };
    }
  },
};

// =============================================================================
// Edit File Tool (Surgical Find-Replace)
// =============================================================================

export const editFileTool: ToolDefinition<EditFileParams, EditFileResult> = {
  name: 'edit_file',
  description: `Surgical find-and-replace in a file. Finds an exact string and replaces it.
The old_string must be unique in the file (unless replace_all=true).
Much more efficient than rewriting entire files - only changes what's needed.`,
  category: 'filesystem',
  securityLevel: 'moderate',
  requiresApproval: true,
  allowedHosts: ['sandbox', 'gateway', 'local'],
  parameters: EditFileParamsSchema,
  examples: [
    {
      description: 'Fix a typo',
      params: { path: 'src/index.ts', old_string: 'cosnt', new_string: 'const' },
    },
    {
      description: 'Replace all occurrences',
      params: { path: 'src/config.ts', old_string: 'localhost', new_string: '0.0.0.0', replace_all: true },
    },
  ],

  async execute(context: ToolExecutionContext, params: EditFileParams): Promise<ToolResult<EditFileResult>> {
    const filePath = resolvePath(params.path, context.workdir);

    if (isBlockedPath(filePath)) {
      return {
        success: false,
        error: { code: 'BLOCKED_PATH', message: 'Editing this file is not allowed' },
      };
    }

    try {
      const content = await fs.readFile(filePath, 'utf-8');

      // Count occurrences
      const occurrences = content.split(params.old_string).length - 1;

      if (occurrences === 0) {
        return {
          success: false,
          error: {
            code: 'STRING_NOT_FOUND',
            message: `Could not find the specified string in ${params.path}. Make sure the string matches exactly (including whitespace and indentation).`,
          },
        };
      }

      if (!params.replace_all && occurrences > 1) {
        return {
          success: false,
          error: {
            code: 'AMBIGUOUS_MATCH',
            message: `Found ${occurrences} occurrences of the string in ${params.path}. Provide more surrounding context to make the match unique, or set replace_all=true.`,
          },
        };
      }

      // Perform replacement
      let newContent: string;
      let replacements: number;

      if (params.replace_all) {
        newContent = content.split(params.old_string).join(params.new_string);
        replacements = occurrences;
      } else {
        const idx = content.indexOf(params.old_string);
        newContent = content.slice(0, idx) + params.new_string + content.slice(idx + params.old_string.length);
        replacements = 1;
      }

      await fs.writeFile(filePath, newContent, 'utf-8');

      // Build a context diff snippet
      const diff = buildDiffSnippet(content, newContent, params.old_string, params.new_string);

      logger.debug(`[FileOps] Edited ${params.path}: ${replacements} replacement(s)`, { component: 'FileOps' });

      return {
        success: true,
        data: { path: params.path, replacements, diff },
        output: `Edited ${params.path} (${replacements} replacement${replacements > 1 ? 's' : ''}):\n${diff}`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        error: { code: 'EDIT_ERROR', message: `Failed to edit file: ${message}` },
      };
    }
  },
};

// =============================================================================
// Directory Tree Tool
// =============================================================================

const TREE_IGNORE = new Set([
  'node_modules', '.git', 'dist', 'build', 'coverage',
  '.next', '.nuxt', '__pycache__', '.venv', 'venv',
  '.cache', '.turbo', '.parcel-cache',
]);

export const directoryTreeTool: ToolDefinition<DirectoryTreeParams, DirectoryTreeResult> = {
  name: 'directory_tree',
  description: `Show the directory structure as a tree. Useful for understanding project layout.
Automatically skips node_modules, .git, dist, build, coverage, and other common ignore dirs.`,
  category: 'filesystem',
  securityLevel: 'safe',
  allowedHosts: ['sandbox', 'gateway', 'local'],
  parameters: DirectoryTreeParamsSchema,
  examples: [
    { description: 'Show project root', params: { path: '.', depth: 3 } },
    { description: 'Show only directories', params: { path: 'src', include_files: false } },
    { description: 'Show only TypeScript files', params: { path: 'src', pattern: '*.ts' } },
  ],

  async execute(context: ToolExecutionContext, params: DirectoryTreeParams): Promise<ToolResult<DirectoryTreeResult>> {
    const rootPath = resolvePath(params.path, context.workdir);
    const maxDepth = Math.max(1, Math.min(params.depth, 10));
    const minimatch = params.pattern ? createMinimatch(params.pattern) : null;

    let dirCount = 0;
    let fileCount = 0;
    const lines: string[] = [];

    async function walk(dir: string, prefix: string, currentDepth: number): Promise<void> {
      if (currentDepth > maxDepth) return;

      let rawEntries: { name: string; isDir: boolean }[];
      try {
        const dirEntries = await fs.readdir(dir, { withFileTypes: true });
        rawEntries = dirEntries.map((e) => ({ name: String(e.name), isDir: e.isDirectory() }));
      } catch {
        return;
      }

      // Sort: directories first, then files, alphabetically
      rawEntries.sort((a, b) => {
        if (a.isDir && !b.isDir) return -1;
        if (!a.isDir && b.isDir) return 1;
        return a.name.localeCompare(b.name);
      });

      // Filter ignored directories and apply pattern
      const filtered = rawEntries.filter((e) => {
        if (e.isDir && TREE_IGNORE.has(e.name)) return false;
        if (!params.include_files && !e.isDir) return false;
        if (minimatch && !e.isDir && !minimatch(e.name)) return false;
        return true;
      });

      for (let i = 0; i < filtered.length; i++) {
        const entry = filtered[i];
        const isLast = i === filtered.length - 1;
        const connector = isLast ? '\u2514\u2500\u2500 ' : '\u251C\u2500\u2500 ';
        const extension = isLast ? '    ' : '\u2502   ';

        if (entry.isDir) {
          dirCount++;
          lines.push(`${prefix}${connector}${entry.name}/`);
          await walk(path.join(dir, entry.name), prefix + extension, currentDepth + 1);
        } else {
          fileCount++;
          lines.push(`${prefix}${connector}${entry.name}`);
        }
      }
    }

    try {
      const rootName = path.basename(rootPath) || rootPath;
      lines.push(`${rootName}/`);
      await walk(rootPath, '', 1);

      const summary = `\n${dirCount} directories, ${fileCount} files`;
      const tree = lines.join('\n') + summary;

      return {
        success: true,
        data: { tree, directories: dirCount, files: fileCount },
        output: tree,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        error: { code: 'TREE_ERROR', message: `Failed to build directory tree: ${message}` },
      };
    }
  },
};

// =============================================================================
// Patch Apply Tool
// =============================================================================

export const patchApplyTool: ToolDefinition<PatchApplyParams, PatchApplyResult> = {
  name: 'patch_apply',
  description: `Apply a unified diff patch to a file. Useful for applying multi-line changes.
Accepts standard unified diff format (output of git diff or diff -u).`,
  category: 'filesystem',
  securityLevel: 'moderate',
  requiresApproval: true,
  allowedHosts: ['sandbox', 'gateway', 'local'],
  parameters: PatchApplyParamsSchema,
  examples: [
    {
      description: 'Apply a patch',
      params: {
        path: 'src/index.ts',
        patch: '@@ -1,3 +1,3 @@\n line1\n-old line\n+new line\n line3',
      },
    },
  ],

  async execute(context: ToolExecutionContext, params: PatchApplyParams): Promise<ToolResult<PatchApplyResult>> {
    const filePath = resolvePath(params.path, context.workdir);

    if (isBlockedPath(filePath)) {
      return {
        success: false,
        error: { code: 'BLOCKED_PATH', message: 'Patching this file is not allowed' },
      };
    }

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const { result, hunks } = applyUnifiedDiff(content, params.patch, params.reverse);

      await fs.writeFile(filePath, result, 'utf-8');

      logger.debug(`[FileOps] Applied patch to ${params.path}: ${hunks} hunk(s)`, { component: 'FileOps' });

      return {
        success: true,
        data: { path: params.path, applied: true, hunks },
        output: `Successfully applied ${hunks} hunk${hunks > 1 ? 's' : ''} to ${params.path}`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        error: { code: 'PATCH_ERROR', message: `Failed to apply patch: ${message}` },
      };
    }
  },
};

// =============================================================================
// Helpers
// =============================================================================

function resolvePath(inputPath: string, workdir: string): string {
  if (path.isAbsolute(inputPath)) {
    return inputPath;
  }
  return path.resolve(workdir, inputPath);
}

function isBlockedPath(filePath: string): boolean {
  const normalized = filePath.toLowerCase();
  return BLOCKED_PATHS.some((blocked) => {
    const normalizedBlocked = blocked.replace('~', process.env.HOME ?? '');
    return normalized.includes(normalizedBlocked.toLowerCase());
  });
}

function buildDiffSnippet(oldContent: string, _newContent: string, oldStr: string, newStr: string): string {
  const oldLines = oldContent.split('\n');
  const firstIdx = oldContent.indexOf(oldStr);
  let lineNum = oldContent.slice(0, firstIdx).split('\n').length;

  // Show 3 lines of context before and after
  const contextLines = 3;
  const start = Math.max(0, lineNum - contextLines - 1);
  const oldStrLines = oldStr.split('\n');
  const end = Math.min(oldLines.length, lineNum + oldStrLines.length + contextLines - 1);

  const result: string[] = [`@@ -${start + 1},${end - start} @@`];

  for (let i = start; i < end; i++) {
    const line = oldLines[i];
    if (i >= lineNum - 1 && i < lineNum - 1 + oldStrLines.length) {
      result.push(`- ${line}`);
    } else {
      result.push(`  ${line}`);
    }
  }

  // Insert new lines
  const insertIdx = result.findIndex((l) => l.startsWith('- '));
  if (insertIdx !== -1) {
    const newLines = newStr.split('\n').map((l) => `+ ${l}`);
    // Find last removal line
    let lastRemoval = insertIdx;
    for (let i = insertIdx; i < result.length; i++) {
      if (result[i].startsWith('- ')) lastRemoval = i;
    }
    result.splice(lastRemoval + 1, 0, ...newLines);
  }

  return result.join('\n');
}

function createMinimatch(pattern: string): (name: string) => boolean {
  // Simple glob matching: convert glob to regex
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  const regex = new RegExp(`^${escaped}$`, 'i');
  return (name: string) => regex.test(name);
}

function applyUnifiedDiff(content: string, patch: string, reverse: boolean): { result: string; hunks: number } {
  const lines = content.split('\n');
  const patchLines = patch.split('\n');
  let hunks = 0;
  let offset = 0;

  for (let i = 0; i < patchLines.length; i++) {
    const line = patchLines[i];
    const hunkMatch = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (!hunkMatch) continue;

    hunks++;
    const startLine = parseInt(hunkMatch[reverse ? 3 : 1], 10) - 1 + offset;
    const removals: number[] = [];
    const additions: string[] = [];

    // Parse hunk lines
    for (let j = i + 1; j < patchLines.length; j++) {
      const pl = patchLines[j];
      if (pl.startsWith('@@') || pl === '') {
        if (pl.startsWith('@@')) i = j - 1;
        break;
      }

      const prefix = pl[0];
      const text = pl.slice(1);

      if ((!reverse && prefix === '-') || (reverse && prefix === '+')) {
        // Line to remove: find it near the expected position
        const searchStart = startLine + removals.length + additions.length;
        let found = -1;
        for (let s = Math.max(0, searchStart - 3); s < Math.min(lines.length, searchStart + 4); s++) {
          if (lines[s] === text && !removals.includes(s)) {
            found = s;
            break;
          }
        }
        if (found === -1) {
          throw new Error(`Patch hunk failed: could not find line "${text}" near line ${searchStart + 1}`);
        }
        removals.push(found);
      } else if ((!reverse && prefix === '+') || (reverse && prefix === '-')) {
        additions.push(text);
      }
      // Context lines (space prefix) are skipped
    }

    // Apply: remove old lines (in reverse order to preserve indices), then insert new
    removals.sort((a, b) => b - a);
    for (const idx of removals) {
      lines.splice(idx, 1);
    }

    // Insert additions at the position of the first removal (or startLine)
    const insertAt = removals.length > 0 ? Math.min(...removals) : startLine;
    lines.splice(insertAt, 0, ...additions);

    offset += additions.length - removals.length;
  }

  if (hunks === 0) {
    throw new Error('No valid hunks found in patch');
  }

  return { result: lines.join('\n'), hunks };
}

// =============================================================================
// Types (exported for use in index.ts)
// =============================================================================

export interface ReadFileResult {
  path: string;
  content: string;
  size: number;
  encoding: string;
  truncated: boolean;
}

export interface WriteFileResult {
  path: string;
  size: number;
  appended: boolean;
}

export interface SearchFilesResult {
  files: string[];
  total: number;
  truncated: boolean;
}

export interface GrepMatch {
  file: string;
  line: number;
  content: string;
  context?: string;
}

export interface GrepResult {
  matches: GrepMatch[];
  total: number;
  pattern: string;
}

export interface EditFileResult {
  path: string;
  replacements: number;
  diff: string;
}

export interface DirectoryTreeResult {
  tree: string;
  directories: number;
  files: number;
}

export interface PatchApplyResult {
  path: string;
  applied: boolean;
  hunks: number;
}
