/**
 * StreamingMessage Component
 *
 * Renders streaming or complete LLM output with inline markdown formatting.
 * Reuses the same formatting logic as renderer.ts (bold, italic, code, lists,
 * headings, blockquotes) but outputs Ink Text nodes instead of ANSI escape codes.
 *
 * For streaming, pass isStreaming=true and update `content` as tokens arrive.
 * A blinking cursor is shown at the end of the partial line while streaming.
 */

import React from 'react';
import { Box, Text } from 'ink';

export interface StreamingMessageProps {
  role: 'user' | 'assistant';
  content: string;
  isStreaming?: boolean;
  model?: string;
}

// ── inline markdown to segments ──────────────────────────────────────────────

type Segment =
  | { type: 'text'; value: string }
  | { type: 'bold'; value: string }
  | { type: 'italic'; value: string }
  | { type: 'code'; value: string }
  | { type: 'link'; label: string; url: string };

function parseInline(text: string): Segment[] {
  const segments: Segment[] = [];
  // Very simple tokeniser — handles **bold**, *italic*, `code`, [label](url)
  const re =
    /(\*\*(.+?)\*\*|\*([^*]+)\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\))/g;
  let last = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      segments.push({ type: 'text', value: text.slice(last, m.index) });
    }
    if (m[2] !== undefined) {
      segments.push({ type: 'bold', value: m[2] });
    } else if (m[3] !== undefined) {
      segments.push({ type: 'italic', value: m[3] });
    } else if (m[4] !== undefined) {
      segments.push({ type: 'code', value: m[4] });
    } else if (m[5] !== undefined && m[6] !== undefined) {
      segments.push({ type: 'link', label: m[5], url: m[6] });
    }
    last = m.index + m[0].length;
  }

  if (last < text.length) {
    segments.push({ type: 'text', value: text.slice(last) });
  }
  return segments;
}

const InlineSegment: React.FC<{ seg: Segment }> = ({ seg }) => {
  switch (seg.type) {
    case 'bold':
      return <Text bold>{seg.value}</Text>;
    case 'italic':
      return <Text italic>{seg.value}</Text>;
    case 'code':
      return <Text color="yellow">{seg.value}</Text>;
    case 'link':
      return (
        <Text color="blue" underline>
          {seg.label}
        </Text>
      );
    default:
      return <Text>{seg.value}</Text>;
  }
};

// ── line renderer ─────────────────────────────────────────────────────────────

interface LineProps {
  line: string;
  inCode: boolean;
}

const RenderedLine: React.FC<LineProps> = ({ line, inCode }) => {
  if (inCode) {
    return (
      <Box paddingLeft={2}>
        <Text color="yellow">{line}</Text>
      </Box>
    );
  }

  // Heading
  if (line.startsWith('### '))
    return (
      <Text bold>{line.slice(4)}</Text>
    );
  if (line.startsWith('## '))
    return (
      <Text bold underline>
        {line.slice(3)}
      </Text>
    );
  if (line.startsWith('# '))
    return (
      <Text bold underline color="cyan">
        {line.slice(2)}
      </Text>
    );

  // Blockquote
  if (line.startsWith('> ')) {
    return (
      <Box paddingLeft={2}>
        <Text italic color="gray">
          {line.slice(2)}
        </Text>
      </Box>
    );
  }

  // Bullet list
  const bullet = line.match(/^(\s*)([-*])\s(.*)/);
  if (bullet) {
    const indent = bullet[1].length;
    const segs = parseInline(bullet[3]);
    return (
      <Box paddingLeft={indent + 2} flexDirection="row" gap={1}>
        <Text dimColor>›</Text>
        <Text>
          {segs.map((s, i) => (
            <InlineSegment key={i} seg={s} />
          ))}
        </Text>
      </Box>
    );
  }

  // Numbered list
  const num = line.match(/^(\s*)(\d+\.)\s(.*)/);
  if (num) {
    const indent = num[1].length;
    const segs = parseInline(num[3]);
    return (
      <Box paddingLeft={indent + 2} flexDirection="row" gap={1}>
        <Text dimColor>{num[2]}</Text>
        <Text>
          {segs.map((s, i) => (
            <InlineSegment key={i} seg={s} />
          ))}
        </Text>
      </Box>
    );
  }

  // Horizontal rule
  if (line.match(/^[-*_]{3,}$/)) {
    return <Text dimColor>{'─'.repeat(40)}</Text>;
  }

  // Empty line
  if (line.trim() === '') return <Text>{' '}</Text>;

  // Normal text
  const segs = parseInline(line);
  return (
    <Text>
      {segs.map((s, i) => (
        <InlineSegment key={i} seg={s} />
      ))}
    </Text>
  );
};

// ── main component ────────────────────────────────────────────────────────────

export const StreamingMessage: React.FC<StreamingMessageProps> = ({
  role,
  content,
  isStreaming = false,
  model,
}) => {
  const lines = content.split('\n');
  const renderedLines: React.ReactNode[] = [];
  let inCode = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('```')) {
      inCode = !inCode;
      if (inCode) {
        const lang = line.slice(3).trim();
        renderedLines.push(
          <Box key={`fence-${i}`} paddingLeft={1}>
            <Text dimColor>{'┌───'} {lang}</Text>
          </Box>
        );
      } else {
        renderedLines.push(
          <Box key={`fence-${i}`} paddingLeft={1}>
            <Text dimColor>└───</Text>
          </Box>
        );
      }
      continue;
    }

    const isLastLine = i === lines.length - 1;
    const showCursor = isStreaming && isLastLine;

    renderedLines.push(
      <Box key={`line-${i}`} flexDirection="row">
        <RenderedLine line={line} inCode={inCode} />
        {showCursor && <Text color="white">▌</Text>}
      </Box>
    );
  }

  const isUser = role === 'user';

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
        {renderedLines}
      </Box>
    </Box>
  );
};
