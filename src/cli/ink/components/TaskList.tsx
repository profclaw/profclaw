import React from 'react';
import { Box, Text } from 'ink';

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface Task {
  id: string;
  title: string;
  status: TaskStatus;
  createdAt: string;
  durationMs?: number;
}

interface TaskListProps {
  tasks: Task[];
  loading?: boolean;
  error?: string;
}

function statusColor(status: TaskStatus): string {
  const map: Record<TaskStatus, string> = {
    pending: 'gray',
    running: 'yellow',
    completed: 'green',
    failed: 'red',
    cancelled: 'gray',
  };
  return map[status];
}

function statusLabel(status: TaskStatus): string {
  const map: Record<TaskStatus, string> = {
    pending: 'pending',
    running: 'running',
    completed: 'done',
    failed: 'failed',
    cancelled: 'cancel',
  };
  return map[status];
}

function formatDuration(ms?: number): string {
  if (ms == null) return '-';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m${Math.floor((ms % 60000) / 1000)}s`;
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function truncateId(id: string | undefined): string {
  if (!id) return '—';
  return id.length > 8 ? id.slice(0, 8) : id;
}

function truncateTitle(title: string | undefined, max = 30): string {
  if (!title) return '(untitled)';
  return title.length > max ? title.slice(0, max - 1) + '…' : title;
}

export function TaskList({ tasks, loading, error }: TaskListProps): React.ReactElement {
  const sorted = [...tasks].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  return (
    <Box flexDirection="column" gap={0}>
      <Text bold color="white">Recent Tasks</Text>
      <Box flexDirection="column" marginTop={1}>
        {loading && <Text dimColor>  Loading tasks...</Text>}
        {error && <Text color="red">  {error}</Text>}
        {!loading && !error && sorted.length === 0 && (
          <Text dimColor>  No tasks yet</Text>
        )}
        {!loading && !error && sorted.length > 0 && (
          <>
            <Box gap={2} marginBottom={1}>
              <Text dimColor bold>{'  ID'.padEnd(10)}</Text>
              <Text dimColor bold>{'Title'.padEnd(32)}</Text>
              <Text dimColor bold>{'Status'.padEnd(10)}</Text>
              <Text dimColor bold>{'Created'.padEnd(10)}</Text>
              <Text dimColor bold>Duration</Text>
            </Box>
            {sorted.map((t) => (
              <Box key={t.id} gap={2}>
                <Text dimColor>{'  ' + truncateId(t.id).padEnd(8)}</Text>
                <Text>{truncateTitle(t.title).padEnd(31)}</Text>
                <Box width={10}>
                  <Text color={statusColor(t.status)}>
                    {statusLabel(t.status).padEnd(8)}
                  </Text>
                </Box>
                <Text dimColor>{formatRelative(t.createdAt).padEnd(10)}</Text>
                <Text dimColor>{formatDuration(t.durationMs)}</Text>
              </Box>
            ))}
          </>
        )}
      </Box>
    </Box>
  );
}
