/**
 * System Tools
 *
 * System information and environment tools.
 */

import { z } from 'zod';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import type { ToolDefinition, ToolResult, ToolExecutionContext } from '../types.js';

// =============================================================================
// Schemas
// =============================================================================

const EnvParamsSchema = z.object({
  name: z.string().optional().describe('Specific environment variable name'),
  filter: z.string().optional().describe('Filter pattern for variable names'),
});

const SystemInfoParamsSchema = z.object({
  type: z.enum(['all', 'cpu', 'memory', 'network', 'disk', 'os']).default('all'),
});

const ProcessListParamsSchema = z.object({
  filter: z.string().optional().describe('Filter by process name'),
  limit: z.number().optional().default(20).describe('Max processes to list'),
  sortBy: z.enum(['cpu', 'memory', 'pid', 'name']).optional().default('cpu'),
});

const PathInfoParamsSchema = z.object({
  path: z.string().describe('Path to inspect'),
});

const WhichParamsSchema = z.object({
  command: z.string().describe('Command to find'),
});

export type EnvParams = z.infer<typeof EnvParamsSchema>;
export type SystemInfoParams = z.infer<typeof SystemInfoParamsSchema>;
export type ProcessListParams = z.infer<typeof ProcessListParamsSchema>;
export type PathInfoParams = z.infer<typeof PathInfoParamsSchema>;
export type WhichParams = z.infer<typeof WhichParamsSchema>;

// =============================================================================
// Env Tool
// =============================================================================

export const envTool: ToolDefinition<EnvParams, EnvResult> = {
  name: 'env',
  description: 'Get environment variables. Use to check PATH, HOME, or custom variables.',
  category: 'system',
  securityLevel: 'safe',
  allowedHosts: ['sandbox', 'gateway', 'local'],
  parameters: EnvParamsSchema,
  examples: [
    { description: 'Get all env vars', params: {} },
    { description: 'Get PATH', params: { name: 'PATH' } },
    { description: 'Filter by pattern', params: { filter: 'NODE' } },
  ],

  async execute(context: ToolExecutionContext, params: EnvParams): Promise<ToolResult<EnvResult>> {
    const env = { ...process.env, ...context.env };

    if (params.name) {
      const value = env[params.name];
      return {
        success: true,
        data: {
          variables: value ? { [params.name]: value } : {},
          count: value ? 1 : 0,
        },
        output: value ?? `Environment variable ${params.name} not found`,
      };
    }

    let filtered = Object.entries(env);
    if (params.filter) {
      const pattern = new RegExp(params.filter, 'i');
      filtered = filtered.filter(([key]) => pattern.test(key));
    }

    // Sort alphabetically
    filtered.sort((a, b) => a[0].localeCompare(b[0]));

    const variables = Object.fromEntries(filtered);
    const output = filtered.map(([k, v]) => `${k}=${v}`).join('\n');

    return {
      success: true,
      data: {
        variables,
        count: filtered.length,
      },
      output: output || '(no variables)',
    };
  },
};

// =============================================================================
// System Info Tool
// =============================================================================

export const systemInfoTool: ToolDefinition<SystemInfoParams, SystemInfoResult> = {
  name: 'system_info',
  description: 'Get system information including CPU, memory, OS, and network.',
  category: 'system',
  securityLevel: 'safe',
  allowedHosts: ['sandbox', 'gateway', 'local'],
  parameters: SystemInfoParamsSchema,
  examples: [
    { description: 'Get all info', params: { type: 'all' } },
    { description: 'Get memory info', params: { type: 'memory' } },
    { description: 'Get CPU info', params: { type: 'cpu' } },
  ],

  async execute(_context: ToolExecutionContext, params: SystemInfoParams): Promise<ToolResult<SystemInfoResult>> {
    const info: SystemInfoResult = {};
    const lines: string[] = [];

    const collectCpu = () => {
      const cpus = os.cpus();
      info.cpu = {
        model: cpus[0]?.model ?? 'Unknown',
        cores: cpus.length,
        speed: cpus[0]?.speed ?? 0,
        loadAvg: os.loadavg(),
      };
      lines.push(`CPU: ${info.cpu.model}`);
      lines.push(`Cores: ${info.cpu.cores}`);
      lines.push(`Load Average: ${info.cpu.loadAvg.map(l => l.toFixed(2)).join(', ')}`);
    };

    const collectMemory = () => {
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      info.memory = {
        total: totalMem,
        free: freeMem,
        used: totalMem - freeMem,
        usagePercent: ((totalMem - freeMem) / totalMem) * 100,
      };
      lines.push(`Memory: ${formatBytes(info.memory.used)} / ${formatBytes(info.memory.total)} (${info.memory.usagePercent.toFixed(1)}%)`);
    };

    const collectOs = () => {
      info.os = {
        platform: os.platform(),
        arch: os.arch(),
        version: os.version(),
        release: os.release(),
        hostname: os.hostname(),
        uptime: os.uptime(),
        homeDir: os.homedir(),
        tempDir: os.tmpdir(),
      };
      lines.push(`OS: ${info.os.platform} ${info.os.arch} ${info.os.release}`);
      lines.push(`Hostname: ${info.os.hostname}`);
      lines.push(`Uptime: ${formatUptime(info.os.uptime)}`);
    };

    const collectNetwork = () => {
      const interfaces = os.networkInterfaces();
      info.network = {};
      for (const [name, addrs] of Object.entries(interfaces)) {
        if (addrs) {
          info.network[name] = addrs.map(a => ({
            address: a.address,
            family: a.family,
            internal: a.internal,
          }));
        }
      }
      const extAddrs = Object.values(interfaces)
        .flat()
        .filter(a => a && !a.internal && a.family === 'IPv4')
        .map(a => a?.address);
      lines.push(`Network: ${extAddrs.join(', ') || 'No external interfaces'}`);
    };

    if (params.type === 'all' || params.type === 'os') collectOs();
    if (params.type === 'all' || params.type === 'cpu') collectCpu();
    if (params.type === 'all' || params.type === 'memory') collectMemory();
    if (params.type === 'all' || params.type === 'network') collectNetwork();

    return {
      success: true,
      data: info,
      output: lines.join('\n'),
    };
  },
};

// =============================================================================
// Process List Tool
// =============================================================================

export const processListTool: ToolDefinition<ProcessListParams, ProcessListResult> = {
  name: 'process_list',
  description: 'List running processes with CPU and memory usage.',
  category: 'system',
  securityLevel: 'safe',
  allowedHosts: ['sandbox', 'gateway', 'local'],
  parameters: ProcessListParamsSchema,
  examples: [
    { description: 'List top processes', params: {} },
    { description: 'Filter by name', params: { filter: 'node' } },
  ],

  async execute(_context: ToolExecutionContext, params: ProcessListParams): Promise<ToolResult<ProcessListResult>> {
    const platform = os.platform();

    return new Promise((resolve) => {
      let command: string;
      let args: string[];

      if (platform === 'win32') {
        command = 'tasklist';
        args = ['/FO', 'CSV'];
      } else {
        command = 'ps';
        args = ['aux', '--sort=-pcpu'];
      }

      const proc = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code !== 0) {
          resolve({
            success: false,
            error: {
              code: 'PROCESS_ERROR',
              message: stderr || 'Failed to list processes',
            },
          });
          return;
        }

        // Parse output
        const lines = stdout.trim().split('\n');
        let processes: ProcessInfo[] = [];

        if (platform !== 'win32') {
          // Skip header, parse unix ps output
          processes = lines.slice(1).map(line => {
            const parts = line.trim().split(/\s+/);
            return {
              user: parts[0],
              pid: parseInt(parts[1], 10),
              cpu: parseFloat(parts[2]),
              memory: parseFloat(parts[3]),
              command: parts.slice(10).join(' '),
            };
          });
        }

        // Filter
        if (params.filter) {
          const pattern = new RegExp(params.filter, 'i');
          processes = processes.filter(p => pattern.test(p.command));
        }

        // Limit
        processes = processes.slice(0, params.limit);

        const output = processes
          .map(p => `${p.pid.toString().padStart(6)} ${p.cpu.toFixed(1).padStart(5)}% ${p.memory.toFixed(1).padStart(5)}% ${p.command.slice(0, 60)}`)
          .join('\n');

        resolve({
          success: true,
          data: {
            processes,
            count: processes.length,
          },
          output: `   PID   CPU%  MEM%  COMMAND\n${output}`,
        });
      });

      proc.on('error', (error) => {
        resolve({
          success: false,
          error: {
            code: 'SPAWN_ERROR',
            message: error.message,
          },
        });
      });
    });
  },
};

// =============================================================================
// Path Info Tool
// =============================================================================

export const pathInfoTool: ToolDefinition<PathInfoParams, PathInfoResult> = {
  name: 'path_info',
  description: 'Get information about a file path (parsed components, resolved path).',
  category: 'system',
  securityLevel: 'safe',
  allowedHosts: ['sandbox', 'gateway', 'local'],
  parameters: PathInfoParamsSchema,
  examples: [
    { description: 'Parse path', params: { path: '/usr/local/bin/node' } },
    { description: 'Parse relative path', params: { path: '../src/index.ts' } },
  ],

  async execute(context: ToolExecutionContext, params: PathInfoParams): Promise<ToolResult<PathInfoResult>> {
    const inputPath = params.path;
    const resolved = path.resolve(context.workdir, inputPath);
    const parsed = path.parse(resolved);

    const info: PathInfoResult = {
      input: inputPath,
      resolved,
      dirname: parsed.dir,
      basename: parsed.base,
      extname: parsed.ext,
      filename: parsed.name,
      isAbsolute: path.isAbsolute(inputPath),
    };

    const output = [
      `Input: ${info.input}`,
      `Resolved: ${info.resolved}`,
      `Directory: ${info.dirname}`,
      `Basename: ${info.basename}`,
      `Extension: ${info.extname || '(none)'}`,
      `Is Absolute: ${info.isAbsolute}`,
    ].join('\n');

    return {
      success: true,
      data: info,
      output,
    };
  },
};

// =============================================================================
// Which Tool
// =============================================================================

export const whichTool: ToolDefinition<WhichParams, WhichResult> = {
  name: 'which',
  description: 'Find the location of a command executable.',
  category: 'system',
  securityLevel: 'safe',
  allowedHosts: ['sandbox', 'gateway', 'local'],
  parameters: WhichParamsSchema,
  examples: [
    { description: 'Find node', params: { command: 'node' } },
    { description: 'Find git', params: { command: 'git' } },
  ],

  async execute(_context: ToolExecutionContext, params: WhichParams): Promise<ToolResult<WhichResult>> {
    const platform = os.platform();
    const command = platform === 'win32' ? 'where' : 'which';

    return new Promise((resolve) => {
      const proc = spawn(command, [params.command], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        const paths = stdout.trim().split('\n').filter(Boolean);
        const found = paths.length > 0;

        resolve({
          success: found,
          data: {
            command: params.command,
            found,
            paths,
          },
          output: found ? paths.join('\n') : `${params.command} not found`,
          error: found ? undefined : {
            code: 'NOT_FOUND',
            message: `Command '${params.command}' not found in PATH`,
          },
        });
      });

      proc.on('error', (error) => {
        resolve({
          success: false,
          data: {
            command: params.command,
            found: false,
            paths: [],
          },
          error: {
            code: 'SPAWN_ERROR',
            message: error.message,
          },
        });
      });
    });
  },
};

// =============================================================================
// Helper Functions
// =============================================================================

function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let unitIndex = 0;
  let size = bytes;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(1)} ${units[unitIndex]}`;
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);

  return parts.join(' ') || '< 1m';
}

// =============================================================================
// Types
// =============================================================================

export interface EnvResult {
  variables: Record<string, string | undefined>;
  count: number;
}

export interface SystemInfoResult {
  os?: {
    platform: string;
    arch: string;
    version: string;
    release: string;
    hostname: string;
    uptime: number;
    homeDir: string;
    tempDir: string;
  };
  cpu?: {
    model: string;
    cores: number;
    speed: number;
    loadAvg: number[];
  };
  memory?: {
    total: number;
    free: number;
    used: number;
    usagePercent: number;
  };
  network?: Record<string, { address: string; family: string; internal: boolean }[]>;
}

export interface ProcessInfo {
  user: string;
  pid: number;
  cpu: number;
  memory: number;
  command: string;
}

export interface ProcessListResult {
  processes: ProcessInfo[];
  count: number;
}

export interface PathInfoResult {
  input: string;
  resolved: string;
  dirname: string;
  basename: string;
  extname: string;
  filename: string;
  isAbsolute: boolean;
}

export interface WhichResult {
  command: string;
  found: boolean;
  paths: string[];
}
