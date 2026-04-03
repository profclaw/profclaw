import React from 'react';
import { Box, Text } from 'ink';

export interface Hook {
  name: string;
  point: string;
  priority?: number;
  active: boolean;
}

interface HookStatusProps {
  hooks: Hook[];
  loading?: boolean;
  error?: string;
}

export function HookStatus({ hooks, loading, error }: HookStatusProps): React.ReactElement {
  const sorted = [...hooks].sort((a, b) => (a.priority ?? 50) - (b.priority ?? 50));

  return (
    <Box flexDirection="column" gap={0}>
      <Text bold color="white">Registered Hooks</Text>
      <Box flexDirection="column" marginTop={1}>
        {loading && <Text dimColor>  Loading hooks...</Text>}
        {error && <Text color="red">  {error}</Text>}
        {!loading && !error && sorted.length === 0 && (
          <Text dimColor>  No hooks registered</Text>
        )}
        {!loading && !error && sorted.length > 0 && (
          <>
            <Box gap={2} marginBottom={1}>
              <Text dimColor bold>{'  Name'.padEnd(22)}</Text>
              <Text dimColor bold>{'Hook point'.padEnd(20)}</Text>
              <Text dimColor bold>{'Priority'.padEnd(10)}</Text>
              <Text dimColor bold>State</Text>
            </Box>
            {sorted.map((h, i) => (
              <Box key={`${h.name}-${i}`} gap={2}>
                <Text>{'  ' + h.name.slice(0, 20).padEnd(20)}</Text>
                <Text dimColor>{h.point.slice(0, 18).padEnd(18)}</Text>
                <Text dimColor>{String(h.priority ?? '-').padEnd(8)}</Text>
                <Text color={h.active ? 'green' : 'gray'}>
                  {h.active ? '● active' : '○ inactive'}
                </Text>
              </Box>
            ))}
          </>
        )}
      </Box>
    </Box>
  );
}
