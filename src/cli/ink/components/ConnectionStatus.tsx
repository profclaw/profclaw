/**
 * ConnectionStatus Component
 *
 * Small indicator shown in the session header area displaying the live
 * server connection state, optional latency, and active provider.
 *
 * Visual states:
 *   ● Connected   (green)
 *   ○ Reconnecting... (yellow, animated dot cycle)
 *   ✗ Disconnected (red)
 */

import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';

export interface ConnectionStatusProps {
  status: 'connected' | 'reconnecting' | 'disconnected';
  latencyMs?: number;
  provider?: string;
}

// Spinner frames used while reconnecting
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const;

export const ConnectionStatus: React.FC<ConnectionStatusProps> = ({
  status,
  latencyMs,
  provider,
}) => {
  const [spinnerIdx, setSpinnerIdx] = useState(0);

  // Animate the spinner only while reconnecting
  useEffect(() => {
    if (status !== 'reconnecting') return;
    const id = setInterval(() => {
      setSpinnerIdx(prev => (prev + 1) % SPINNER_FRAMES.length);
    }, 80);
    return () => clearInterval(id);
  }, [status]);

  let indicator: string;
  let color: string;
  let label: string;

  switch (status) {
    case 'connected':
      indicator = '●';
      color = 'green';
      label = 'Connected';
      break;
    case 'reconnecting':
      indicator = SPINNER_FRAMES[spinnerIdx] ?? '○';
      color = 'yellow';
      label = 'Reconnecting...';
      break;
    case 'disconnected':
      indicator = '✗';
      color = 'red';
      label = 'Disconnected';
      break;
  }

  return (
    <Box flexDirection="row" gap={1}>
      <Text color={color}>{indicator}</Text>
      <Text color={color}>{label}</Text>
      {provider !== undefined && provider.length > 0 && (
        <Text dimColor>via {provider}</Text>
      )}
      {latencyMs !== undefined && status === 'connected' && (
        <Text dimColor>{latencyMs}ms</Text>
      )}
    </Box>
  );
};
