/**
 * PermissionPrompt Component
 *
 * Interactive dialog asking user to approve/deny a tool action.
 * Shows: tool name, args, permission level, reason.
 * Options: [y]es, [n]o, [a]lways allow, [d]eny always.
 *
 * Captures keypress and calls onDecision with the result.
 */

import React, { useEffect } from 'react';
import { Box, Text, useInput } from 'ink';

export type PermissionDecision = 'yes' | 'no' | 'always' | 'deny_always';

export type PermissionLevel = 'read' | 'write' | 'execute' | 'network' | 'sensitive';

export interface PermissionPromptProps {
  toolName: string;
  args: Record<string, unknown>;
  permissionLevel: PermissionLevel;
  reason?: string;
  onDecision: (decision: PermissionDecision) => void;
}

const LEVEL_COLORS: Record<PermissionLevel, string> = {
  read: 'green',
  write: 'yellow',
  execute: 'red',
  network: 'magenta',
  sensitive: 'red',
};

function argsDisplay(args: Record<string, unknown>): string {
  const entries = Object.entries(args).slice(0, 3);
  return entries
    .map(([k, v]) => {
      const val = String(v ?? '');
      return `${k}: ${val.length > 40 ? val.slice(0, 39) + '…' : val}`;
    })
    .join(', ');
}

export const PermissionPrompt: React.FC<PermissionPromptProps> = ({
  toolName,
  args,
  permissionLevel,
  reason,
  onDecision,
}) => {
  const levelColor = LEVEL_COLORS[permissionLevel];

  useInput((input, key) => {
    if (key.escape || input === 'n') {
      onDecision('no');
    } else if (input === 'y') {
      onDecision('yes');
    } else if (input === 'a') {
      onDecision('always');
    } else if (input === 'd') {
      onDecision('deny_always');
    }
  });

  // Memoize useEffect dependency
  useEffect(() => {
    // no-op; key capture is handled by useInput above
  }, []);

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="yellow"
      paddingX={2}
      paddingY={1}
      marginY={1}
    >
      <Text bold color="yellow">
        Permission Required
      </Text>
      <Box marginTop={1} flexDirection="row" gap={1}>
        <Text dimColor>Tool:</Text>
        <Text bold color="cyan">
          {toolName}
        </Text>
        <Text dimColor>·</Text>
        <Text color={levelColor}>{permissionLevel}</Text>
      </Box>
      {Object.keys(args).length > 0 && (
        <Box marginTop={0} flexDirection="row" gap={1}>
          <Text dimColor>Args:</Text>
          <Text color="gray">{argsDisplay(args)}</Text>
        </Box>
      )}
      {reason !== undefined && reason.length > 0 && (
        <Box marginTop={0} flexDirection="row" gap={1}>
          <Text dimColor>Why:</Text>
          <Text color="white">{reason}</Text>
        </Box>
      )}
      <Box marginTop={1} flexDirection="row" gap={2}>
        <Text color="green">[y] Yes</Text>
        <Text color="red">[n] No</Text>
        <Text color="cyan">[a] Always allow</Text>
        <Text color="magenta">[d] Always deny</Text>
      </Box>
    </Box>
  );
};
