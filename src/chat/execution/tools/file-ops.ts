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

export type ReadFileParams = z.infer<typeof ReadFileParamsSchema>;
export type WriteFileParams = z.infer<typeof WriteFileParamsSchema>;
export type SearchFilesParams = z.infer<typeof SearchFilesParamsSchema>;
export type GrepParams = z.infer<typeof GrepParamsSchema>;

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
