/**
 * AgentStatus Component
 *
 * Real-time agent status display showing current action, step count,
 * tokens used, and elapsed time. Uses a spinner when agent is active.
 */

import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';

export type AgentStatusState = 'idle' | 'thinking' | 'executing' | 'complete' | 'error';

export interface AgentStatusProps {
  status: AgentStatusState;
  currentAction?: string;
  stepCount: number;
  tokensUsed: number;
  elapsedMs: number;
}

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  return `${mins}m ${secs}s`;
}

function formatTokens(count: number): string {
  if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
  if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
  return count.toString();
}

const STATUS_COLORS: Record<AgentStatusState, string> = {
  idle: 'gray',
  thinking: 'yellow',
  executing: 'cyan',
  complete: 'green',
  error: 'red',
};

const isActive = (status: AgentStatusState): boolean =>
  status === 'thinking' || status === 'executing';

export const AgentStatus: React.FC<AgentStatusProps> = ({
  status,
  currentAction,
  stepCount,
  tokensUsed,
  elapsedMs,
}) => {
  const statusColor = STATUS_COLORS[status];
  const active = isActive(status);

  return (
    <Box flexDirection="row" gap={1} paddingX={1}>
      {active ? (
        <Text color={statusColor}>
          <Spinner type="dots" />
        </Text>
      ) : (
        <Text color={statusColor}>{status === 'complete' ? '✓' : status === 'error' ? '✗' : '·'}</Text>
      )}
      <Text color={statusColor} bold={active}>
        {status}
      </Text>
      {currentAction !== undefined && currentAction.length > 0 && (
        <>
          <Text dimColor>›</Text>
          <Text color="white">{currentAction}</Text>
        </>
      )}
      <Text dimColor>
        {' '}step {stepCount} · {formatTokens(tokensUsed)} tok · {formatElapsed(elapsedMs)}
      </Text>
    </Box>
  );
};
