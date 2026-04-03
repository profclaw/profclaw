/**
 * CostBar Component
 *
 * Horizontal progress bar showing budget usage.
 * - Green when < 50%
 * - Yellow when 50-80%
 * - Red when > 80%
 *
 * Shows: tokens used / max, estimated cost, and percentage.
 */

import React from 'react';
import { Box, Text, useStdout } from 'ink';

export interface CostBarProps {
  tokensUsed: number;
  tokensMax: number;
  estimatedCost?: number;
  width?: number;
}

function formatTokens(count: number): string {
  if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
  if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
  return count.toString();
}

function getBarColor(ratio: number): string {
  if (ratio > 0.8) return 'red';
  if (ratio > 0.5) return 'yellow';
  return 'green';
}

function buildBar(filled: number, total: number, fillChar = '█', emptyChar = '░'): string {
  return fillChar.repeat(filled) + emptyChar.repeat(total - filled);
}

export const CostBar: React.FC<CostBarProps> = ({
  tokensUsed,
  tokensMax,
  estimatedCost,
  width,
}) => {
  const { stdout } = useStdout();
  const termWidth = width ?? stdout?.columns ?? 80;
  // Reserve space for labels on each side
  const barWidth = Math.max(10, termWidth - 40);

  const ratio = tokensMax > 0 ? Math.min(tokensUsed / tokensMax, 1) : 0;
  const filledCount = Math.round(ratio * barWidth);
  const barColor = getBarColor(ratio);
  const pct = Math.round(ratio * 100);

  const bar = buildBar(filledCount, barWidth);
  const costStr =
    estimatedCost !== undefined && estimatedCost > 0
      ? ` $${estimatedCost.toFixed(4)}`
      : '';

  return (
    <Box flexDirection="row" gap={1} paddingX={1}>
      <Text dimColor>tokens</Text>
      <Text color={barColor}>{bar}</Text>
      <Text dimColor>
        {formatTokens(tokensUsed)}/{formatTokens(tokensMax)} ({pct}%){costStr}
      </Text>
    </Box>
  );
};
