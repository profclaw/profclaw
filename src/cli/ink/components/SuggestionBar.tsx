/**
 * SuggestionBar
 *
 * Renders 2-3 dimmed follow-up prompt suggestions below the last assistant
 * response. The user can press 1, 2, or 3 to select a suggestion.
 */

import React from 'react';
import { Box, Text, useInput } from 'ink';
import type { Suggestion } from '../../../agents/prompt-suggestions.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SuggestionBarProps {
  suggestions: Suggestion[];
  isActive: boolean;
  onSelect: (text: string) => void;
}

// ── Category colors ───────────────────────────────────────────────────────────

function categoryColor(category: Suggestion['category']): string {
  switch (category) {
    case 'action':   return 'yellow';
    case 'deeper':   return 'cyan';
    case 'related':  return 'magenta';
    case 'follow-up':
    default:         return 'white';
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export const SuggestionBar: React.FC<SuggestionBarProps> = ({
  suggestions,
  isActive,
  onSelect,
}) => {
  useInput((input) => {
    const digit = parseInt(input, 10);
    if (!isNaN(digit) && digit >= 1 && digit <= suggestions.length) {
      const suggestion = suggestions[digit - 1];
      if (suggestion) {
        onSelect(suggestion.text);
      }
    }
  }, { isActive });

  if (suggestions.length === 0) return null;

  return (
    <Box flexDirection="column" paddingX={2} paddingY={0} marginTop={0}>
      <Text dimColor>  ╌ suggestions ╌</Text>
      {suggestions.map((s, i) => (
        <Box key={i} flexDirection="row" gap={1}>
          <Text dimColor bold>{`  ${i + 1}.`}</Text>
          <Text dimColor color={categoryColor(s.category)}>{s.text}</Text>
        </Box>
      ))}
      <Text dimColor>     press 1–{suggestions.length} to use</Text>
    </Box>
  );
};
