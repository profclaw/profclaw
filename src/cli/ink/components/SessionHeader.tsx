/**
 * SessionHeader Component
 *
 * Compact one-line display showing session info:
 * model name, provider, session ID, and mode (pico/mini/pro).
 */

import React from 'react';
import { Box, Text } from 'ink';

export interface SessionHeaderProps {
  model: string;
  provider: string;
  sessionId: string;
  mode: 'pico' | 'mini' | 'pro' | 'chat' | 'agentic';
}

const MODE_COLORS: Record<string, string> = {
  pico: 'cyan',
  mini: 'green',
  pro: 'magenta',
  chat: 'cyan',
  agentic: 'yellow',
};

export const SessionHeader: React.FC<SessionHeaderProps> = ({
  model,
  provider,
  sessionId,
  mode,
}) => {
  const modeColor = MODE_COLORS[mode] ?? 'white';
  const shortId = sessionId.slice(0, 8);

  return (
    <Box flexDirection="row" gap={2} borderStyle="single" borderColor="gray" paddingX={1}>
      <Text color="cyan" bold>
        profClaw
      </Text>
      <Text dimColor>·</Text>
      <Text color="white">{model}</Text>
      <Text dimColor>via</Text>
      <Text color="blue">{provider}</Text>
      <Text dimColor>·</Text>
      <Text color={modeColor}>{mode}</Text>
      <Text dimColor>·</Text>
      <Text dimColor>#{shortId}</Text>
    </Box>
  );
};
