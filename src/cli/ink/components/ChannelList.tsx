import React from 'react';
import { Box, Text } from 'ink';

export type ChannelStatus = 'connected' | 'disconnected' | 'error' | 'connecting';

export interface Channel {
  name: string;
  type: string;
  status: ChannelStatus;
  messageCount?: number;
  lastActivity?: string;
}

interface ChannelListProps {
  channels: Channel[];
  loading?: boolean;
  error?: string;
}

function statusColor(status: ChannelStatus): string {
  const map: Record<ChannelStatus, string> = {
    connected: 'green',
    connecting: 'yellow',
    disconnected: 'gray',
    error: 'red',
  };
  return map[status];
}

function statusDot(status: ChannelStatus): string {
  return status === 'connected' ? '●' : status === 'connecting' ? '◐' : '○';
}

function formatRelative(iso?: string): string {
  if (!iso) return '-';
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function ChannelList({ channels, loading, error }: ChannelListProps): React.ReactElement {
  return (
    <Box flexDirection="column" gap={0}>
      <Text bold color="white">Chat Channels</Text>
      <Box flexDirection="column" marginTop={1}>
        {loading && <Text dimColor>  Loading channels...</Text>}
        {error && <Text color="red">  {error}</Text>}
        {!loading && !error && channels.length === 0 && (
          <Text dimColor>  No channels configured</Text>
        )}
        {!loading && !error && channels.length > 0 && (
          <>
            <Box gap={2} marginBottom={1}>
              <Text dimColor bold>{'  Channel'.padEnd(18)}</Text>
              <Text dimColor bold>{'Type'.padEnd(12)}</Text>
              <Text dimColor bold>{'Status'.padEnd(16)}</Text>
              <Text dimColor bold>{'Messages'.padEnd(10)}</Text>
              <Text dimColor bold>Last active</Text>
            </Box>
            {channels.filter((c) => c.name).map((c) => (
              <Box key={c.name} gap={2}>
                <Text>{'  ' + (c.name ?? '').slice(0, 16).padEnd(16)}</Text>
                <Text dimColor>{(c.type ?? '').slice(0, 10).padEnd(10)}</Text>
                <Box width={16} gap={1}>
                  <Text color={statusColor(c.status)}>{statusDot(c.status)}</Text>
                  <Text color={statusColor(c.status)}>{c.status}</Text>
                </Box>
                <Text dimColor>{String(c.messageCount ?? 0).padEnd(8)}</Text>
                <Text dimColor>{formatRelative(c.lastActivity)}</Text>
              </Box>
            ))}
          </>
        )}
      </Box>
    </Box>
  );
}
