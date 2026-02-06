/**
 * Integration Tools - screen capture, clipboard, desktop notifications.
 */

import { z } from 'zod';
import { execFile as execFileCb, spawn } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import type { ToolDefinition, ToolResult, ToolExecutionContext } from '../types.js';
import { logger } from '../../../utils/logger.js';

const execFile = promisify(execFileCb);

// -- Schemas ------------------------------------------------------------------

const ScreenCaptureParamsSchema = z.object({
  display: z.number().optional().default(0).describe('Display index (0 = primary)'),
  region: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
  }).optional().describe('Capture specific region'),
  format: z.enum(['png', 'jpg']).optional().default('png'),
  output: z.string().optional().describe('Output file path (auto-generated if omitted)'),
});

const ClipboardReadParamsSchema = z.object({
  format: z.enum(['text', 'html']).optional().default('text'),
});

const ClipboardWriteParamsSchema = z.object({
  content: z.string().min(1).describe('Content to write to clipboard'),
  format: z.enum(['text', 'html']).optional().default('text'),
});

const NotifyParamsSchema = z.object({
  title: z.string().min(1).describe('Notification title'),
  message: z.string().min(1).describe('Notification body'),
  sound: z.boolean().optional().default(true),
  urgency: z.enum(['low', 'normal', 'critical']).optional().default('normal'),
});

export type ScreenCaptureParams = z.infer<typeof ScreenCaptureParamsSchema>;
export type ClipboardReadParams = z.infer<typeof ClipboardReadParamsSchema>;
export type ClipboardWriteParams = z.infer<typeof ClipboardWriteParamsSchema>;
export type NotifyParams = z.infer<typeof NotifyParamsSchema>;

// -- screen_capture -----------------------------------------------------------

export const screenCaptureTool: ToolDefinition<ScreenCaptureParams, ScreenCaptureResult> = {
  name: 'screen_capture',
  description: `Take a screenshot of the screen or a specific region.
Supports macOS (screencapture) and Linux (scrot/import).
Returns the output path, file size, and format.`,
  category: 'system',
  securityLevel: 'moderate',
  requiresApproval: true,
  allowedHosts: ['local'],
  parameters: ScreenCaptureParamsSchema,
  examples: [
    { description: 'Capture primary display', params: {} },
    { description: 'Capture region as JPEG', params: { region: { x: 0, y: 0, width: 800, height: 600 }, format: 'jpg' } },
  ],

  async execute(_context: ToolExecutionContext, params: ScreenCaptureParams): Promise<ToolResult<ScreenCaptureResult>> {
    const platform = process.platform;
    const format = params.format ?? 'png';

    if (platform !== 'darwin' && platform !== 'linux') {
      return { success: false, error: { code: 'UNSUPPORTED_PLATFORM', message: `Screen capture is not supported on ${platform}` } };
    }

    const outputPath = params.output
      ? path.resolve(params.output)
      : path.join(os.tmpdir(), `screenshot-${Date.now()}.${format}`);

    try {
      if (platform === 'darwin') {
        const args: string[] = ['-x', '-t', format];
        if (params.region) {
          const { x, y, width, height } = params.region;
          args.push('-R', `${x},${y},${width},${height}`);
        }
        if (params.display !== 0) args.push('-D', String(params.display));
        args.push(outputPath);
        await execFile('screencapture', args);
      } else {
        if (params.region) {
          const { x, y, width, height } = params.region;
          try {
            await execFile('scrot', ['--area', `${x},${y},${width},${height}`, outputPath]);
          } catch {
            await execFile('import', ['-window', 'root', '-crop', `${width}x${height}+${x}+${y}`, outputPath]);
          }
        } else {
          try {
            await execFile('scrot', [outputPath]);
          } catch {
            await execFile('import', ['-window', 'root', outputPath]);
          }
        }
      }

      const stats = await fs.stat(outputPath);
      logger.debug(`[Integrations] Screenshot saved to ${outputPath}`, { component: 'Integrations' });

      return {
        success: true,
        data: { path: outputPath, size: stats.size, format },
        output: `Screenshot saved to ${outputPath} (${(stats.size / 1024).toFixed(1)} KB)`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: { code: 'CAPTURE_ERROR', message: `Screen capture failed: ${message}` } };
    }
  },
};

// -- clipboard_read -----------------------------------------------------------

export const clipboardReadTool: ToolDefinition<ClipboardReadParams, ClipboardReadResult> = {
  name: 'clipboard_read',
  description: `Read the current clipboard contents.
Supports macOS (pbpaste) and Linux (xclip).`,
  category: 'system',
  securityLevel: 'moderate',
  requiresApproval: true,
  allowedHosts: ['local'],
  parameters: ClipboardReadParamsSchema,
  examples: [
    { description: 'Read clipboard as plain text', params: {} },
    { description: 'Read clipboard as HTML', params: { format: 'html' } },
  ],

  async execute(_context: ToolExecutionContext, params: ClipboardReadParams): Promise<ToolResult<ClipboardReadResult>> {
    const platform = process.platform;
    const format = params.format ?? 'text';

    if (platform !== 'darwin' && platform !== 'linux') {
      return { success: false, error: { code: 'UNSUPPORTED_PLATFORM', message: `Clipboard access is not supported on ${platform}` } };
    }

    try {
      let content: string;

      if (platform === 'darwin') {
        const args = format === 'html' ? ['-Prefer', 'html'] : [];
        const { stdout } = await execFile('pbpaste', args);
        content = stdout;
      } else {
        const args = format === 'html'
          ? ['-selection', 'clipboard', '-o', '-t', 'text/html']
          : ['-selection', 'clipboard', '-o'];
        const { stdout } = await execFile('xclip', args);
        content = stdout;
      }

      logger.debug(`[Integrations] Clipboard read: ${content.length} chars`, { component: 'Integrations' });
      return { success: true, data: { content, format, length: content.length }, output: content };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: { code: 'CLIPBOARD_READ_ERROR', message: `Failed to read clipboard: ${message}` } };
    }
  },
};

// -- clipboard_write ----------------------------------------------------------

export const clipboardWriteTool: ToolDefinition<ClipboardWriteParams, ClipboardWriteResult> = {
  name: 'clipboard_write',
  description: `Write content to the clipboard.
Supports macOS (pbcopy) and Linux (xclip).
Content is piped via stdin to avoid shell injection.`,
  category: 'system',
  securityLevel: 'moderate',
  requiresApproval: true,
  allowedHosts: ['local'],
  parameters: ClipboardWriteParamsSchema,
  examples: [
    { description: 'Copy text to clipboard', params: { content: 'Hello, clipboard!' } },
  ],

  async execute(_context: ToolExecutionContext, params: ClipboardWriteParams): Promise<ToolResult<ClipboardWriteResult>> {
    const platform = process.platform;
    const format = params.format ?? 'text';

    if (platform !== 'darwin' && platform !== 'linux') {
      return { success: false, error: { code: 'UNSUPPORTED_PLATFORM', message: `Clipboard access is not supported on ${platform}` } };
    }

    try {
      await new Promise<void>((resolve, reject) => {
        const [cmd, args] = platform === 'darwin'
          ? ['pbcopy', format === 'html' ? ['-Prefer', 'html'] : []] as [string, string[]]
          : ['xclip', format === 'html'
              ? ['-selection', 'clipboard', '-t', 'text/html']
              : ['-selection', 'clipboard']] as [string, string[]];

        const child = spawn(cmd, args, { stdio: ['pipe', 'ignore', 'pipe'] });
        child.stdin.write(params.content, 'utf-8');
        child.stdin.end();
        child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`Process exited with code ${code}`))));
        child.on('error', reject);
      });

      logger.debug(`[Integrations] Clipboard write: ${params.content.length} chars`, { component: 'Integrations' });
      return {
        success: true,
        data: { written: true, length: params.content.length },
        output: `Wrote ${params.content.length} characters to clipboard`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: { code: 'CLIPBOARD_WRITE_ERROR', message: `Failed to write clipboard: ${message}` } };
    }
  },
};

// -- notify -------------------------------------------------------------------

export const notifyTool: ToolDefinition<NotifyParams, NotifyResult> = {
  name: 'notify',
  description: `Send a desktop notification.
Supports macOS (osascript) and Linux (notify-send).
Useful for alerting users when a long-running task completes.`,
  category: 'system',
  securityLevel: 'safe',
  allowedHosts: ['local'],
  parameters: NotifyParamsSchema,
  examples: [
    { description: 'Task complete alert', params: { title: 'Done', message: 'Build succeeded.' } },
    { description: 'Critical error alert', params: { title: 'Error', message: 'Build failed!', urgency: 'critical' } },
  ],

  async execute(_context: ToolExecutionContext, params: NotifyParams): Promise<ToolResult<NotifyResult>> {
    const platform = process.platform;

    if (platform !== 'darwin' && platform !== 'linux') {
      return { success: false, error: { code: 'UNSUPPORTED_PLATFORM', message: `Desktop notifications are not supported on ${platform}` } };
    }

    // Strip quotes to prevent osascript injection via the AppleScript string literal
    const title = params.title.replace(/"/g, '');
    const message = params.message.replace(/"/g, '');

    try {
      if (platform === 'darwin') {
        const soundClause = params.sound ? ' sound name "Glass"' : '';
        await execFile('osascript', ['-e', `display notification "${message}" with title "${title}"${soundClause}`]);
      } else {
        const args = [title, message, `--urgency=${params.urgency ?? 'normal'}`];
        if (params.sound) args.push('--hint=string:sound-name:message-new-instant');
        await execFile('notify-send', args);
      }

      logger.debug(`[Integrations] Notification sent: "${params.title}"`, { component: 'Integrations' });
      return { success: true, data: { sent: true, platform }, output: `Notification sent: "${params.title}"` };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: { code: 'NOTIFY_ERROR', message: `Failed to send notification: ${message}` } };
    }
  },
};

// -- Result types -------------------------------------------------------------

export interface ScreenCaptureResult {
  path: string;
  size: number;
  format: string;
  width?: number;
  height?: number;
}

export interface ClipboardReadResult {
  content: string;
  format: string;
  length: number;
}

export interface ClipboardWriteResult {
  written: true;
  length: number;
}

export interface NotifyResult {
  sent: true;
  platform: string;
}
