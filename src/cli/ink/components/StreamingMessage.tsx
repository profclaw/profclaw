/**
 * StreamingMessage Component
 *
 * Renders streaming or complete LLM output with full markdown formatting.
 * Delegates to renderMarkdown() in markdown-renderer.tsx for consistent,
 * rich rendering: bold, italic, code blocks with syntax highlighting,
 * headings, blockquotes, lists, links, strikethrough, and horizontal rules.
 *
 * For streaming, pass isStreaming=true and update `content` as tokens arrive.
 * A blinking cursor is shown at the end of the partial line while streaming.
 */

import React from 'react';
import { Box, Text } from 'ink';
import { renderMarkdown } from '../markdown-renderer.js';

export interface StreamingMessageProps {
  role: 'user' | 'assistant';
  content: string;
  isStreaming?: boolean;
  model?: string;
}

export const StreamingMessage: React.FC<StreamingMessageProps> = ({
  role,
  content,
  isStreaming = false,
  model,
}) => {
  const isUser = role === 'user';

  // For streaming, append the cursor character to the raw content so
  // renderMarkdown sees it as part of the last text run.
  const displayContent = isStreaming ? content + '▌' : content;

  return (
    <Box
      flexDirection="column"
      paddingX={1}
      marginY={0}
      borderLeft={!isUser}
      borderTop={false}
      borderBottom={false}
      borderRight={false}
      borderLeftColor={!isUser ? 'cyan' : undefined}
      borderStyle="single"
    >
      <Box flexDirection="row" gap={1} marginBottom={0}>
        <Text bold color={isUser ? 'green' : 'cyan'}>
          {isUser ? 'You' : 'profClaw'}
        </Text>
        {model !== undefined && !isUser && (
          <Text dimColor>({model})</Text>
        )}
      </Box>
      <Box flexDirection="column" paddingLeft={isUser ? 0 : 1}>
        {renderMarkdown(displayContent, { syntaxHighlight: true, linkStyle: 'inline' })}
      </Box>
    </Box>
  );
};
