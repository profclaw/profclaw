import React from 'react';
import { Box, Text } from 'ink';

export interface SystemMetrics {
  version?: string;
  uptime?: number;
  mode?: string;
  healthy?: boolean;
  memoryUsedMb?: number;
  memoryTotalMb?: number;
  cpuPercent?: number;
  queueBackend?: 'redis' | 'memory';
  degraded?: boolean;
}

interface SystemHealthProps {
  metrics: SystemMetrics;
  loading?: boolean;
  error?: string;
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(' ');
}

function HealthRow({ label, value, color = 'white', dimColor = false }: {
  label: string;
  value: string;
  color?: string;
  dimColor?: boolean;
}): React.ReactElement {
  return (
    <Box gap={0}>
      <Text dimColor>{'  ' + label.padEnd(16)}</Text>
      <Text color={dimColor ? undefined : color} dimColor={dimColor}>{value}</Text>
    </Box>
  );
}

export function SystemHealth({ metrics, loading, error }: SystemHealthProps): React.ReactElement {
  if (loading) {
    return (
      <Box flexDirection="column">
        <Text bold color="white">System Health</Text>
        <Text dimColor>  Loading...</Text>
      </Box>
    );
  }

  if (error) {
    return (
      <Box flexDirection="column">
        <Text bold color="white">System Health</Text>
        <Box flexDirection="column" marginTop={1}>
          <Text color="red">  Unable to connect to profClaw server.</Text>
          <Text dimColor>  Is it running? Try: profclaw serve</Text>
        </Box>
      </Box>
    );
  }

  const healthColor = metrics.healthy ? 'green' : 'red';
  const healthLabel = metrics.healthy
    ? '● healthy'
    : metrics.degraded
    ? '● degraded'
    : '● unhealthy';

  const memUsage = metrics.memoryUsedMb != null && metrics.memoryTotalMb != null
    ? `${metrics.memoryUsedMb}MB / ${metrics.memoryTotalMb}MB`
    : undefined;

  const cpuColor = (metrics.cpuPercent ?? 0) > 80 ? 'red'
    : (metrics.cpuPercent ?? 0) > 50 ? 'yellow'
    : 'green';

  return (
    <Box flexDirection="column" gap={0}>
      <Box gap={2}>
        <Text bold color="white">System Health</Text>
        {metrics.degraded && (
          <Text color="yellow" bold>⚠ DEGRADED</Text>
        )}
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {metrics.version && (
          <HealthRow label="Version" value={metrics.version} dimColor />
        )}
        <HealthRow
          label="Status"
          value={healthLabel}
          color={healthColor}
        />
        <HealthRow
          label="Mode"
          value={metrics.mode ?? 'mini'}
          color="cyan"
        />
        {metrics.uptime != null && (
          <HealthRow label="Uptime" value={formatUptime(metrics.uptime)} dimColor />
        )}
        {memUsage && (
          <HealthRow label="Memory" value={memUsage} dimColor />
        )}
        {metrics.cpuPercent != null && (
          <HealthRow
            label="CPU"
            value={`${metrics.cpuPercent.toFixed(1)}%`}
            color={cpuColor}
          />
        )}
        <HealthRow
          label="Queue backend"
          value={metrics.queueBackend ?? 'memory'}
          color={metrics.queueBackend === 'redis' ? 'green' : 'yellow'}
        />
      </Box>
    </Box>
  );
}
