/**
 * Markdown Renderer for Ink TUI
 *
 * Converts markdown text to Ink React elements with proper formatting.
 * Ports the syntax highlighting and inline formatting patterns from
 * src/cli/interactive/renderer.ts, adapted to output Ink Text/Box nodes
 * instead of ANSI escape codes.
 *
 * Supports:
 *   - **bold**, *italic*, `inline code`, ~~strikethrough~~
 *   - ```lang ... ``` code blocks with syntax highlighting
 *   - # ## ### headings
 *   - > blockquotes
 *   - - / * bullet lists and 1. numbered lists
 *   - [text](url) links
 *   - --- horizontal rules
 */

import React from 'react';
import type { ReactElement } from 'react';
import { Box, Text } from 'ink';

// ── Public API types ──────────────────────────────────────────────────────────

export interface RenderOptions {
  maxWidth?: number;
  syntaxHighlight?: boolean;
  linkStyle?: 'inline' | 'footnote' | 'hidden';
}

// ── Syntax highlighting ───────────────────────────────────────────────────────

const JS_KEYWORDS = new Set([
  'const', 'let', 'var', 'function', 'async', 'await', 'return',
  'import', 'export', 'from', 'default', 'class', 'extends', 'super',
  'this', 'if', 'else', 'for', 'while', 'do', 'switch', 'case',
  'break', 'continue', 'try', 'catch', 'finally', 'throw', 'new',
  'delete', 'typeof', 'instanceof', 'yield', 'of', 'in', 'static',
  'get', 'set', 'enum', 'interface', 'type', 'implements', 'declare',
  'abstract', 'readonly', 'as', 'is', 'keyof', 'infer', 'satisfies',
]);

const PY_KEYWORDS = new Set([
  'def', 'class', 'if', 'elif', 'else', 'for', 'while', 'try',
  'except', 'finally', 'with', 'as', 'import', 'from', 'return',
  'yield', 'raise', 'pass', 'break', 'continue', 'and', 'or', 'not',
  'in', 'is', 'lambda', 'global', 'nonlocal', 'True', 'False', 'None',
  'async', 'await', 'self',
]);

const COMMON_TYPES = new Set([
  'string', 'number', 'boolean', 'void', 'null', 'undefined', 'any',
  'never', 'unknown', 'object', 'Array', 'Map', 'Set', 'Promise',
  'Record', 'Partial', 'Required', 'Readonly', 'Pick', 'Omit',
  'int', 'float', 'str', 'bool', 'list', 'dict', 'tuple',
  // From the spec
  'Dict', 'List', 'Optional',
]);

type SyntaxToken =
  | { kind: 'comment'; value: string }
  | { kind: 'string'; value: string }
  | { kind: 'number'; value: string }
  | { kind: 'keyword'; value: string }
  | { kind: 'type'; value: string }
  | { kind: 'func'; value: string }
  | { kind: 'plain'; value: string };

function tokenizeLine(line: string, lang: string): SyntaxToken[] {
  const isPython = lang === 'python' || lang === 'py';
  const isBash = lang === 'bash' || lang === 'shell' || lang === 'sh';
  const isJson = lang === 'json';
  const isYaml = lang === 'yaml' || lang === 'yml';

  // Comments (whole line)
  const commentMatch = line.match(/^(\s*)(\/\/.*|#.*)$/);
  if (commentMatch) {
    const tokens: SyntaxToken[] = [];
    if (commentMatch[1]) tokens.push({ kind: 'plain', value: commentMatch[1] });
    tokens.push({ kind: 'comment', value: commentMatch[2] });
    return tokens;
  }

  // For JSON/YAML, do minimal tokenization (strings + numbers)
  if (isJson || isYaml || isBash) {
    return tokenizeSimple(line);
  }

  // Full tokenization for JS/TS/Python/Go/Rust
  const tokens: SyntaxToken[] = [];
  const keywords = isPython ? PY_KEYWORDS : JS_KEYWORDS;

  // We walk the string and emit tokens as we go.
  // Strategy: scan for strings first (they can contain keywords), then others.
  let i = 0;
  let plain = '';

  const flushPlain = () => {
    if (!plain) return;
    // Match: identifier (possibly followed by '('), standalone number, or any other char.
    // NOTE: \s* is NOT used after identifiers — whitespace is captured by the `\s+` arm
    // so it is emitted as a plain token and not silently swallowed.
    const wordRe = /([a-zA-Z_]\w*)(\()?|\b(\d+\.?\d*)\b|(\s+)|([\S])/g;
    let wm: RegExpExecArray | null;
    const plainResult: SyntaxToken[] = [];
    let wp = 0;
    while ((wm = wordRe.exec(plain)) !== null) {
      if (wm.index > wp) {
        plainResult.push({ kind: 'plain', value: plain.slice(wp, wm.index) });
      }
      wp = wm.index + wm[0].length;

      if (wm[3] !== undefined) {
        // standalone number (not part of an identifier)
        plainResult.push({ kind: 'number', value: wm[3] });
      } else if (wm[4] !== undefined) {
        // whitespace — always emit as plain so spacing is preserved
        plainResult.push({ kind: 'plain', value: wm[4] });
      } else if (wm[5] !== undefined) {
        // any other non-space character
        plainResult.push({ kind: 'plain', value: wm[5] });
      } else if (wm[1] !== undefined) {
        const word = wm[1];
        const hasParens = wm[2] !== undefined;
        if (keywords.has(word)) {
          plainResult.push({ kind: 'keyword', value: word });
          if (hasParens) plainResult.push({ kind: 'plain', value: '(' });
        } else if (COMMON_TYPES.has(word)) {
          plainResult.push({ kind: 'type', value: word });
          if (hasParens) plainResult.push({ kind: 'plain', value: '(' });
        } else if (hasParens) {
          plainResult.push({ kind: 'func', value: word });
          plainResult.push({ kind: 'plain', value: '(' });
        } else {
          plainResult.push({ kind: 'plain', value: word });
        }
      }
    }
    if (wp < plain.length) {
      plainResult.push({ kind: 'plain', value: plain.slice(wp) });
    }
    tokens.push(...plainResult);
    plain = '';
  };

  while (i < line.length) {
    const ch = line[i];

    // String literals (single, double, backtick)
    if (ch === '"' || ch === "'" || ch === '`') {
      flushPlain();
      const quote = ch;
      let str = quote;
      i++;
      while (i < line.length) {
        const c = line[i];
        str += c;
        if (c === '\\') {
          i++;
          if (i < line.length) { str += line[i]; i++; }
          continue;
        }
        if (c === quote) { i++; break; }
        i++;
      }
      tokens.push({ kind: 'string', value: str });
      continue;
    }

    plain += ch;
    i++;
  }
  flushPlain();

  return tokens;
}

function tokenizeSimple(line: string): SyntaxToken[] {
  const tokens: SyntaxToken[] = [];
  const strRe = /(["'])(?:(?!\1|\\).|\\.)*?\1|\b(\d+\.?\d*)\b/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = strRe.exec(line)) !== null) {
    if (m.index > last) {
      tokens.push({ kind: 'plain', value: line.slice(last, m.index) });
    }
    if (m[1] !== undefined) {
      tokens.push({ kind: 'string', value: m[0] });
    } else {
      tokens.push({ kind: 'number', value: m[0] });
    }
    last = m.index + m[0].length;
  }
  if (last < line.length) {
    tokens.push({ kind: 'plain', value: line.slice(last) });
  }
  return tokens;
}

function tokenColor(kind: SyntaxToken['kind']): string | undefined {
  switch (kind) {
    case 'comment':  return '#546E7A';
    case 'string':   return '#C3E88D';
    case 'number':   return '#F78C6C';
    case 'keyword':  return '#C792EA';
    case 'type':     return '#FFCB6B';
    case 'func':     return '#82AAFF';
    default:         return undefined;
  }
}

/**
 * Renders a single line of code with syntax highlighting.
 * Returns an array of React elements (one per token).
 */
export function highlightCode(code: string, language: string): ReactElement {
  const tokens = tokenizeLine(code, language);
  return (
    <Text>
      {tokens.map((tok, i) => {
        const color = tokenColor(tok.kind);
        return color
          ? <Text key={i} color={color}>{tok.value}</Text>
          : <Text key={i}>{tok.value}</Text>;
      })}
    </Text>
  );
}

// ── Inline markdown segments ──────────────────────────────────────────────────

type InlineSegment =
  | { type: 'text';          value: string }
  | { type: 'bold';          value: string }
  | { type: 'italic';        value: string }
  | { type: 'code';          value: string }
  | { type: 'strike';        value: string }
  | { type: 'link';          label: string; url: string };

function parseInline(text: string): InlineSegment[] {
  const segments: InlineSegment[] = [];
  // Order matters: bold (**) before italic (*), strike (~~) before others
  const re =
    /(\*\*(.+?)\*\*|~~(.+?)~~|\*([^*\n]+)\*(?!\*)|_([^_\n]+)_|`([^`]+)`|\[([^\]\n]+)\]\(([^)\n]+)\))/g;

  let last = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      segments.push({ type: 'text', value: text.slice(last, m.index) });
    }

    if (m[2] !== undefined) {
      segments.push({ type: 'bold', value: m[2] });
    } else if (m[3] !== undefined) {
      segments.push({ type: 'strike', value: m[3] });
    } else if (m[4] !== undefined) {
      segments.push({ type: 'italic', value: m[4] });
    } else if (m[5] !== undefined) {
      segments.push({ type: 'italic', value: m[5] });
    } else if (m[6] !== undefined) {
      segments.push({ type: 'code', value: m[6] });
    } else if (m[7] !== undefined && m[8] !== undefined) {
      segments.push({ type: 'link', label: m[7], url: m[8] });
    }

    last = m.index + m[0].length;
  }

  if (last < text.length) {
    segments.push({ type: 'text', value: text.slice(last) });
  }

  return segments;
}

interface InlineSegmentProps {
  seg: InlineSegment;
  linkStyle: NonNullable<RenderOptions['linkStyle']>;
}

const InlineSegmentNode: React.FC<InlineSegmentProps> = ({ seg, linkStyle }) => {
  switch (seg.type) {
    case 'bold':
      return <Text bold>{seg.value}</Text>;
    case 'italic':
      return <Text italic>{seg.value}</Text>;
    case 'code':
      return <Text color="#F0C987">{seg.value}</Text>;
    case 'strike':
      return <Text strikethrough dimColor>{seg.value}</Text>;
    case 'link': {
      if (linkStyle === 'hidden') {
        return <Text>{seg.label}</Text>;
      }
      if (linkStyle === 'footnote') {
        return (
          <Text>
            <Text color="blue" underline>{seg.label}</Text>
            <Text dimColor>{' (' + seg.url + ')'}</Text>
          </Text>
        );
      }
      // Default: inline — label in blue + underline
      return <Text color="blue" underline>{seg.label}</Text>;
    }
    default:
      return <Text>{seg.value}</Text>;
  }
};

// ── Inline text renderer (renders parsed segments) ────────────────────────────

interface InlineTextProps {
  text: string;
  linkStyle: NonNullable<RenderOptions['linkStyle']>;
}

const InlineText: React.FC<InlineTextProps> = ({ text, linkStyle }) => {
  const segs = parseInline(text);
  if (segs.length === 1 && segs[0].type === 'text') {
    return <Text>{segs[0].value}</Text>;
  }
  return (
    <Text>
      {segs.map((seg, i) => (
        <InlineSegmentNode key={i} seg={seg} linkStyle={linkStyle} />
      ))}
    </Text>
  );
};

// ── Block line renderer ───────────────────────────────────────────────────────

interface BlockLineProps {
  line: string;
  inCode: boolean;
  codeLang: string;
  linkStyle: NonNullable<RenderOptions['linkStyle']>;
  syntaxHighlight: boolean;
}

const BlockLine: React.FC<BlockLineProps> = ({
  line,
  inCode,
  codeLang,
  linkStyle,
  syntaxHighlight,
}) => {
  // Inside code block
  if (inCode) {
    return (
      <Box paddingLeft={1}>
        <Text color="#3C414B">│ </Text>
        {syntaxHighlight
          ? highlightCode(line, codeLang)
          : <Text color="#F0C987">{line}</Text>
        }
      </Box>
    );
  }

  // H1
  if (line.startsWith('# ')) {
    return (
      <Text bold color="cyan">
        <InlineText text={line.slice(2)} linkStyle={linkStyle} />
      </Text>
    );
  }

  // H2
  if (line.startsWith('## ')) {
    return (
      <Text bold color="cyan">
        <InlineText text={line.slice(3)} linkStyle={linkStyle} />
      </Text>
    );
  }

  // H3+
  if (line.startsWith('### ')) {
    return (
      <Text bold>
        <InlineText text={line.slice(4)} linkStyle={linkStyle} />
      </Text>
    );
  }
  if (line.startsWith('#### ')) {
    return (
      <Text bold>
        <InlineText text={line.slice(5)} linkStyle={linkStyle} />
      </Text>
    );
  }

  // Blockquote
  if (line.startsWith('> ')) {
    return (
      <Box flexDirection="row">
        <Text color="#3C414B">│ </Text>
        <Text italic dimColor>
          <InlineText text={line.slice(2)} linkStyle={linkStyle} />
        </Text>
      </Box>
    );
  }

  // Bullet list
  const bullet = line.match(/^(\s*)([-*])\s(.*)/);
  if (bullet) {
    const indent = bullet[1].length;
    return (
      <Box paddingLeft={indent + 2} flexDirection="row" gap={1}>
        <Text dimColor>›</Text>
        <InlineText text={bullet[3]} linkStyle={linkStyle} />
      </Box>
    );
  }

  // Numbered list
  const num = line.match(/^(\s*)(\d+\.)\s(.*)/);
  if (num) {
    const indent = num[1].length;
    return (
      <Box paddingLeft={indent + 2} flexDirection="row" gap={1}>
        <Text dimColor>{num[2]}</Text>
        <InlineText text={num[3]} linkStyle={linkStyle} />
      </Box>
    );
  }

  // Horizontal rule
  if (line.match(/^[-*_]{3,}$/)) {
    return <Text dimColor>{'─'.repeat(40)}</Text>;
  }

  // Empty line — spacer
  if (line.trim() === '') {
    return <Text>{' '}</Text>;
  }

  // Normal paragraph text
  return <InlineText text={line} linkStyle={linkStyle} />;
};

// ── Code fence header/footer components ──────────────────────────────────────

const CodeFenceOpen: React.FC<{ lang: string }> = ({ lang }) => (
  <Box paddingLeft={1}>
    <Text dimColor>{'┌───'}</Text>
    {lang ? <Text dimColor> {lang}</Text> : null}
  </Box>
);

const CodeFenceClose: React.FC = () => (
  <Box paddingLeft={1}>
    <Text dimColor>└───</Text>
  </Box>
);

// ── Main renderMarkdown function ──────────────────────────────────────────────

/**
 * Convert a markdown string to Ink React elements.
 *
 * Handles:
 *   - **bold**, *italic*, `inline code`, ~~strikethrough~~
 *   - ```lang ... ``` code blocks with optional syntax highlighting
 *   - # / ## / ### headings → bold cyan
 *   - > blockquotes → dim italic with left border
 *   - - / * bullet and 1. numbered lists with indent
 *   - [text](url) links
 *   - --- horizontal rules
 */
export function renderMarkdown(
  text: string,
  options?: RenderOptions,
): ReactElement {
  const syntaxHighlight = options?.syntaxHighlight ?? true;
  const linkStyle = options?.linkStyle ?? 'inline';

  const lines = text.split('\n');
  const nodes: ReactElement[] = [];
  let inCode = false;
  let codeLang = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('```')) {
      if (inCode) {
        inCode = false;
        nodes.push(<CodeFenceClose key={`cfclose-${i}`} />);
        codeLang = '';
      } else {
        inCode = true;
        codeLang = line.slice(3).trim();
        nodes.push(<CodeFenceOpen key={`cfopen-${i}`} lang={codeLang} />);
      }
      continue;
    }

    nodes.push(
      <Box key={`line-${i}`}>
        <BlockLine
          line={line}
          inCode={inCode}
          codeLang={codeLang}
          linkStyle={linkStyle}
          syntaxHighlight={syntaxHighlight}
        />
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {nodes}
    </Box>
  );
}

// ── stripMarkdown ─────────────────────────────────────────────────────────────

/**
 * Strip all markdown formatting from text, returning plain readable text.
 * Used by /copy and /save operations.
 */
export function stripMarkdown(text: string): string {
  return text
    // Code fences — remove fence markers, keep content
    .replace(/^```[a-z]*\n?/gm, '')
    .replace(/^```\s*$/gm, '')
    // Headings — remove # prefix
    .replace(/^#{1,6}\s+/gm, '')
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '$1')
    // Strikethrough
    .replace(/~~(.+?)~~/g, '$1')
    // Italic (asterisk and underscore)
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/_([^_\n]+)_/g, '$1')
    // Inline code
    .replace(/`([^`]+)`/g, '$1')
    // Links — keep label, discard URL
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // Blockquotes — remove leading >
    .replace(/^>\s*/gm, '')
    // Horizontal rules
    .replace(/^[-*_]{3,}$/gm, '')
    // Trim trailing whitespace per line
    .split('\n')
    .map((l) => l.trimEnd())
    .join('\n')
    // Collapse 3+ consecutive blank lines to 2
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
