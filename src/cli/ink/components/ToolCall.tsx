/**
 * ToolCall Component
 *
 * Renders a single tool call with name, args preview, result, and duration.
 * Color-coded: green for success, red for error, yellow for timeout/pending.
 */

import React from 'react';
import { Box, Text } from 'ink';

export type ToolCallStatus = 'pending' | 'running' | 'success' | 'error' | 'timeout';

export interface ToolCallProps {
  name: string;
  args: Record<string, unknown>;
  result?: unknown;
  status: ToolCallStatus;
  durationMs?: number;
}

function argsPreview(args: Record<string, unknown>, maxLen = 60): string {
  const entries = Object.entries(args);
  if (entries.length === 0) return '{}';
  const [, firstVal] = entries[0];
  const preview = String(firstVal ?? '');
  return preview.length > maxLen ? preview.slice(0, maxLen - 1) + '…' : preview;
}

function resultPreview(result: unknown, maxLen = 80): string {
  if (result === undefined || result === null) return '';
  const str = typeof result === 'string' ? result : JSON.stringify(result);
  return str.length > maxLen ? str.slice(0, maxLen - 1) + '…' : str;
}

const STATUS_COLOR: Record<ToolCallStatus, string> = {
  pending: 'gray',
  running: 'yellow',
  success: 'green',
  error: 'red',
  timeout: 'yellow',
};

const STATUS_ICON: Record<ToolCallStatus, string> = {
  pending: '○',
  running: '◎',
  success: '✓',
  error: '✗',
  timeout: '⏱',
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export const ToolCall: React.FC<ToolCallProps> = ({
  name,
  args,
  result,
  status,
  durationMs,
}) => {
  const color = STATUS_COLOR[status];
  const icon = STATUS_ICON[status];
  const preview = argsPreview(args);
  const res = result !== undefined ? resultPreview(result) : undefined;

  return (
    <Box flexDirection="column" paddingX={1} marginY={0}>
      <Box flexDirection="row" gap={1}>
        <Text color={color}>{icon}</Text>
        <Text color="yellow" bold>
          {name}
        </Text>
        {preview.length > 0 && <Text dimColor>{preview}</Text>}
        {durationMs !== undefined && (
          <Text dimColor>({formatDuration(durationMs)})</Text>
        )}
      </Box>
      {res !== undefined && res.length > 0 && (
        <Box paddingLeft={3}>
          <Text color={status === 'error' ? 'red' : 'gray'}>{res}</Text>
        </Box>
      )}
    </Box>
  );
};
