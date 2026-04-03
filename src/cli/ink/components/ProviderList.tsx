import React from 'react';
import { Box, Text } from 'ink';

export interface Provider {
  type: string;
  healthy: boolean;
  latencyMs?: number;
  modelCount?: number;
  priority?: number;
}

interface ProviderListProps {
  providers: Provider[];
  loading?: boolean;
  error?: string;
}

function StatusDot({ healthy }: { healthy: boolean }): React.ReactElement {
  return (
    <Text color={healthy ? 'green' : 'red'}>
      {healthy ? '●' : '●'}
    </Text>
  );
}

function LatencyLabel({ ms }: { ms?: number }): React.ReactElement {
  if (ms == null) return <Text dimColor>-</Text>;
  const color = ms < 500 ? 'green' : ms < 1500 ? 'yellow' : 'red';
  return <Text color={color}>{ms}ms</Text>;
}

export function ProviderList({ providers, loading, error }: ProviderListProps): React.ReactElement {
  const sorted = [...providers].sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));

  return (
    <Box flexDirection="column" gap={0}>
      <Text bold color="white">AI Providers</Text>
      <Box flexDirection="column" marginTop={1}>
        {loading && <Text dimColor>  Loading providers...</Text>}
        {error && <Text color="red">  {error}</Text>}
        {!loading && !error && sorted.length === 0 && (
          <Text dimColor>  No providers configured</Text>
        )}
        {!loading && !error && sorted.length > 0 && (
          <>
            <Box gap={2} marginBottom={1}>
              <Text dimColor bold>{'  Provider'.padEnd(16)}</Text>
              <Text dimColor bold>{'Status'.padEnd(10)}</Text>
              <Text dimColor bold>{'Latency'.padEnd(10)}</Text>
              <Text dimColor bold>Models</Text>
            </Box>
            {sorted.filter((p) => p.type).map((p) => (
              <Box key={p.type} gap={2}>
                <Text>{'  ' + (p.type ?? '').padEnd(14)}</Text>
                <Box width={10} gap={1}>
                  <StatusDot healthy={p.healthy} />
                  <Text color={p.healthy ? 'green' : 'red'}>
                    {p.healthy ? 'online' : 'offline'}
                  </Text>
                </Box>
                <Box width={10}>
                  <LatencyLabel ms={p.latencyMs} />
                </Box>
                <Text dimColor>
                  {p.modelCount != null ? String(p.modelCount) : '-'}
                </Text>
              </Box>
            ))}
          </>
        )}
      </Box>
    </Box>
  );
}
