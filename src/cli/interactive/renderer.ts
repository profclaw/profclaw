/**
 * Terminal Renderer - Polished CLI Output
 *
 * Design inspired by Claude Code, OpenClaw, Charm.sh, and clig.dev:
 *
 *   - Response text indented 2 spaces for visual separation from prompt
 *   - Tool calls framed with thin Unicode box-drawing lines
 *   - Markdown rendered inline (bold, code, lists, headings, quotes)
 *   - Streaming markdown: lines formatted as they complete
 *   - Syntax highlighting for common languages in code blocks
 *   - Word-wrap respects terminal width
 *   - Color used intentionally: cyan for links, gold for code, dim for chrome
 *   - Progress within 100ms (spinner starts immediately)
 *   - Errors are actionable, not cryptic
 *   - Respects NO_COLOR env var
 *   - Cost/time shown only when meaningful
 *
 * @package profclaw-interactive (future standalone)
 */

import chalk from 'chalk';
import type { Renderer, TokenUsage } from './types.js';

// Unicode box-drawing and symbols
const H_LINE  = '\u2500'; // -
const V_LINE  = '\u2502'; // |
const T_LEFT  = '\u251c'; // |-
const B_LEFT  = '\u2514'; // |_
const DOT     = '\u00b7'; // .
const ARROW   = '\u25b8'; // >
const CHECK   = '\u2713'; // v
const CROSS   = '\u2717'; // x
const CIRCLE  = '\u25cf'; // o
const GEAR    = '\u2699'; // gear
const ELLIP   = '\u2026'; // ...
const LINK_ICON = '\u2197'; // arrow NE (link indicator)

// Respect NO_COLOR (clig.dev recommendation)
const noColor = !!process.env.NO_COLOR;

// Get terminal width
function getWidth(): number {
  return process.stdout.columns || 80;
}

// Strip ANSI escape sequences for measuring visible length
function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

// Themed colors (OpenClaw-inspired palette, dark mode focused)
const theme = {
  gold:    noColor ? (s: string) => s : chalk.hex('#F6C453'),
  mint:    noColor ? (s: string) => s : chalk.hex('#7DD3A5'),
  coral:   noColor ? (s: string) => s : chalk.hex('#F97066'),
  cream:   noColor ? (s: string) => s : chalk.hex('#E8E3D5'),
  code:    noColor ? (s: string) => s : chalk.hex('#F0C987'),
  link:    noColor ? (s: string) => s : chalk.hex('#8CC8FF'),
  border:  noColor ? (s: string) => s : chalk.hex('#3C414B'),
  dim:     noColor ? (s: string) => s : chalk.dim,
  bold:    noColor ? (s: string) => s : chalk.bold,
  italic:  noColor ? (s: string) => s : chalk.italic,
  // Syntax highlighting colors
  keyword: noColor ? (s: string) => s : chalk.hex('#C792EA'),
  string:  noColor ? (s: string) => s : chalk.hex('#C3E88D'),
  number:  noColor ? (s: string) => s : chalk.hex('#F78C6C'),
  comment: noColor ? (s: string) => s : chalk.hex('#546E7A'),
  func:    noColor ? (s: string) => s : chalk.hex('#82AAFF'),
  type:    noColor ? (s: string) => s : chalk.hex('#FFCB6B'),
};

// Word-wrap a single visible line at terminal width
function wrapText(text: string, indent: number): string {
  const maxWidth = getWidth() - indent - 2; // 2 for safety margin
  if (maxWidth <= 20) return text; // Don't wrap on tiny terminals

  const visibleLen = stripAnsi(text).length;
  if (visibleLen <= maxWidth) return text;

  // Simple word-boundary wrap for plain text
  const words = text.split(/(\s+)/);
  const lines: string[] = [];
  let currentLine = '';
  let currentLen = 0;

  for (const word of words) {
    const wordLen = stripAnsi(word).length;
    if (currentLen + wordLen > maxWidth && currentLine.length > 0) {
      lines.push(currentLine);
      currentLine = word.trimStart();
      currentLen = stripAnsi(currentLine).length;
    } else {
      currentLine += word;
      currentLen += wordLen;
    }
  }
  if (currentLine) lines.push(currentLine);

  const pad = ' '.repeat(indent);
  return lines.join(`\n${pad}`);
}

// Draw separator lines
function separator(label?: string): string {
  const w = Math.min(getWidth() - 4, 68);
  const line = theme.border(H_LINE.repeat(w));
  if (!label) return `  ${line}`;

  const padded = ` ${label} `;
  const plainLen = stripAnsi(padded).length;
  const side = Math.max(2, Math.floor((w - plainLen) / 2));
  const right = Math.max(2, w - side - plainLen);
  return `  ${theme.border(H_LINE.repeat(side))}${padded}${theme.border(H_LINE.repeat(right))}`;
}

// Syntax highlighting for code blocks (built-in, no external deps)
const JS_KEYWORDS = /\b(const|let|var|function|async|await|return|if|else|for|while|do|switch|case|break|continue|try|catch|finally|throw|new|delete|typeof|instanceof|import|export|from|default|class|extends|super|this|yield|of|in|static|get|set|enum|interface|type|implements|declare|abstract|readonly|as|is|keyof|infer|satisfies)\b/g;
const PY_KEYWORDS = /\b(def|class|if|elif|else|for|while|try|except|finally|with|as|import|from|return|yield|raise|pass|break|continue|and|or|not|in|is|lambda|global|nonlocal|True|False|None|async|await|self)\b/g;
const COMMON_TYPES = /\b(string|number|boolean|void|null|undefined|any|never|unknown|object|Array|Map|Set|Promise|Record|Partial|Required|Readonly|Pick|Omit|int|float|str|bool|list|dict|tuple)\b/g;

export function highlightCode(line: string, lang: string): string {
  if (noColor) return line;

  let result = line;

  // Comments (single-line)
  const commentMatch = result.match(/^(\s*)(\/\/.*|#.*)$/);
  if (commentMatch) {
    return commentMatch[1] + theme.comment(commentMatch[2]);
  }

  // Strings (simple - single/double/backtick quoted)
  result = result.replace(/(["'`])(?:(?!\1|\\).|\\.)*?\1/g, (m) => theme.string(m));

  // Numbers
  result = result.replace(/\b(\d+\.?\d*)\b/g, (m) => theme.number(m));

  // Keywords based on language
  const isPython = lang === 'python' || lang === 'py';
  const keywordRe = isPython ? PY_KEYWORDS : JS_KEYWORDS;
  result = result.replace(keywordRe, (m) => theme.keyword(m));

  // Types
  result = result.replace(COMMON_TYPES, (m) => theme.type(m));

  // Function calls
  result = result.replace(/\b([a-zA-Z_]\w*)\s*\(/g, (_, name: string) => theme.func(name) + '(');

  return result;
}

// Link rendering constants
const LINK_BRACKET_L = '\u276a'; // box bracket left (heavy)
const LINK_BRACKET_R = '\u276b'; // box bracket right (heavy)

/**
 * OSC 8 clickable hyperlink for terminals that support it.
 * Format: ESC ] 8 ; params ; uri ST text ESC ] 8 ; ; ST
 * Supported: iTerm2, Windows Terminal, GNOME Terminal, Konsole, foot, WezTerm, etc.
 * Falls back to plain text + URL for non-TTY or NO_COLOR.
 */
function hyperlink(url: string, displayText: string): string {
  // Ensure full URL
  const fullUrl = url.startsWith('http') ? url : `https://${url}`;
  if (noColor || !process.stdout.isTTY) return displayText;
  return `\x1b]8;;${fullUrl}\x07${displayText}\x1b]8;;\x07`;
}

/** Extract readable domain + path from a URL */
function shortDomain(url: string): string {
  try {
    const fullUrl = url.startsWith('http') ? url : `https://${url}`;
    const parsed = new URL(fullUrl);
    const host = parsed.hostname.replace(/^www\./, '');
    const path = parsed.pathname;
    if (path && path !== '/') {
      // Shorten long paths: show first + last segment
      const segments = path.split('/').filter(Boolean);
      if (segments.length > 2) {
        return `${host}/${segments[0]}/${ELLIP}/${segments[segments.length - 1]}`;
      }
      if (path.length < 40) return `${host}${path}`;
      return `${host}/${segments[0]}/${ELLIP}`;
    }
    return host;
  } catch {
    return url.length > 40 ? url.slice(0, 37) + ELLIP : url;
  }
}

/**
 * Render a link with a clear visual box treatment.
 * Output: ` [link icon] Label  domain.com/path `
 * The entire label is an OSC 8 clickable hyperlink in supporting terminals.
 */
function renderLink(label: string, url: string): string {
  const domain = shortDomain(url);
  // Clickable label text
  const styledLabel = hyperlink(url, theme.link(chalk.bold.underline(label)));
  // Domain hint - dimmed, with link arrow icon
  const domainHint = theme.dim(`${LINK_ICON} ${domain}`);
  // Visual bracket treatment to make links pop
  return `${theme.link(LINK_BRACKET_L)} ${styledLabel} ${domainHint} ${theme.link(LINK_BRACKET_R)}`;
}

/**
 * Render a bare URL with clickable domain display.
 * Output: ` [link icon] domain.com/path `
 */
function renderBareUrl(url: string): string {
  const domain = shortDomain(url);
  const styledDomain = hyperlink(url, theme.link(chalk.underline(domain)));
  return `${theme.link(LINK_ICON)} ${styledDomain}`;
}

// Inline markdown formatting
function fmt(text: string): string {
  if (noColor) return text;
  // Bold
  text = text.replace(/\*\*(.+?)\*\*/g, (_, c: string) => chalk.bold(c));
  // Italic
  text = text.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, (_, c: string) => chalk.italic(c));
  text = text.replace(/(?<!_)_([^_]+)_(?!_)/g, (_, c: string) => chalk.italic(c));
  // Inline code
  text = text.replace(/`([^`]+)`/g, (_, c: string) => theme.code(c));
  // Strikethrough
  text = text.replace(/~~(.+?)~~/g, (_, c: string) => chalk.strikethrough.dim(c));

  // Use a placeholder to prevent double-matching URLs in markdown links vs bare URLs
  const linkPlaceholders: string[] = [];

  // 1. Markdown links [text](url) - highest priority
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label: string, url: string) => {
    const idx = linkPlaceholders.length;
    linkPlaceholders.push(renderLink(label, url));
    return `\x00LINK${idx}\x00`;
  });

  // 2. Contextual phrase + URL patterns:
  //    "details here https://..." / "view it here: https://..." / "click here https://..."
  //    Merge the phrase and URL into one styled link
  text = text.replace(/((?:click |view |see |read |check |visit |details |full details |more )?here|this (?:link|page|article|site|resource))([.:,]?\s*)(https?:\/\/[^\s,;)>\]"']+[^\s,;)>\]"'.!?])/gi, (_match: string, phrase: string, sep: string, url: string) => {
    const idx = linkPlaceholders.length;
    linkPlaceholders.push(renderLink(phrase.trim(), url));
    return `\x00LINK${idx}\x00`;
  });

  // 3. URL + contextual phrase patterns (reversed):
  //    "https://... (here)" / "https://... - click here"
  text = text.replace(/(https?:\/\/[^\s,;)>\]"']+[^\s,;)>\]"'.!?])\s*[-(\s]*\b(here|this (?:link|page))\b[)\s]*/gi, (_match: string, url: string, phrase: string) => {
    const idx = linkPlaceholders.length;
    linkPlaceholders.push(renderLink(phrase.trim(), url));
    return `\x00LINK${idx}\x00`;
  });

  // 4. Bare URLs with protocol: https://... http://...
  text = text.replace(/(https?:\/\/[^\s,;)>\]"']+[^\s,;)>\]"'.!?])/g, (url: string) => {
    const idx = linkPlaceholders.length;
    linkPlaceholders.push(renderBareUrl(url));
    return `\x00LINK${idx}\x00`;
  });

  // 5. Common bare domains without protocol: example.com/path
  text = text.replace(/(?<=\s|^)((?:[a-zA-Z0-9-]+\.)+(?:com|org|net|io|dev|ai|co|app|gov|edu|info|me)(?:\/[^\s,;)>\]"']*[^\s,;)>\]"'.!?])?)/g, (url: string) => {
    const idx = linkPlaceholders.length;
    linkPlaceholders.push(renderBareUrl(url));
    return `\x00LINK${idx}\x00`;
  });

  // 6. Orphan link phrases with no URL - highlight as missing/broken link
  //    "You can view the full details here." where "here" has no URL nearby
  text = text.replace(/\b((?:click |view |see |read |check (?:it )?|visit )?here|this (?:link|page|article))\b(?!\x00)/gi, (phrase: string) => {
    // Only style if no placeholder follows (i.e., no URL was found nearby)
    return theme.link(chalk.underline(phrase)) + theme.dim(` ${LINK_ICON}?`);
  });

  // Restore placeholders
  for (let i = 0; i < linkPlaceholders.length; i++) {
    text = text.replace(`\x00LINK${i}\x00`, linkPlaceholders[i]);
  }

  return text;
}

// Render a single line with markdown
function renderLine(line: string, inCode: boolean, codeLang?: string): string {
  if (inCode) {
    const highlighted = highlightCode(line, codeLang || '');
    return `  ${theme.border(V_LINE)} ${highlighted}`;
  }

  // Headings
  if (line.startsWith('### ')) return `  ${theme.bold(fmt(line.slice(4)))}`;
  if (line.startsWith('## '))  return `  ${theme.bold(fmt(line.slice(3)))}`;
  if (line.startsWith('# '))   return `  ${theme.bold(chalk.underline(fmt(line.slice(2))))}`;

  // Block quotes
  if (line.startsWith('> ')) {
    return `  ${theme.border(V_LINE)} ${theme.italic(fmt(line.slice(2)))}`;
  }

  // Bullet lists
  const bullet = line.match(/^(\s*)([-*])\s(.*)/);
  if (bullet) {
    const indent = bullet[1];
    return `  ${indent}${theme.dim(ARROW)} ${wrapText(fmt(bullet[3]), 4 + indent.length)}`;
  }

  // Numbered lists
  const num = line.match(/^(\s*)(\d+\.)\s(.*)/);
  if (num) {
    return `  ${num[1]}${theme.dim(num[2])} ${wrapText(fmt(num[3]), 4 + num[1].length + num[2].length)}`;
  }

  // Horizontal rule
  if (line.match(/^[-*_]{3,}$/)) return separator();

  // Empty line
  if (line.trim() === '') return '';

  // Normal text with word-wrap
  return `  ${wrapText(fmt(line), 2)}`;
}

// Public helpers

export function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  return `${mins}m ${secs}s`;
}

export function formatTokens(count: number): string {
  if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
  if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
  return count.toString();
}

function truncStr(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max - 1) + ELLIP;
}

// Full markdown block rendering (for post-stream fallback)
export function renderMarkdownLite(text: string): string {
  const lines = text.split('\n');
  const out: string[] = [];
  let inCode = false;
  let codeLang = '';

  for (const line of lines) {
    if (line.startsWith('```')) {
      if (inCode) {
        inCode = false;
        out.push(`  ${theme.border(B_LEFT + H_LINE.repeat(3))}`);
        codeLang = '';
      } else {
        inCode = true;
        codeLang = line.slice(3).trim();
        out.push(`  ${theme.border(T_LEFT + H_LINE.repeat(3))} ${theme.dim(codeLang)}`);
      }
      continue;
    }
    out.push(renderLine(line, inCode, codeLang));
  }
  return out.join('\n');
}

// Renderer Implementation

export function createRenderer(): Renderer {
  // Streaming markdown state
  let streamBuf = '';
  let streamLineCount = 0;
  let partialLine = '';      // Incomplete line being streamed
  let inCodeBlock = false;   // Track code block state across lines
  let codeLang = '';          // Current code block language
  let firstLineDone = false; // Track if we've started outputting

  // Thinking state
  let thinkingBuf = '';

  return {
    userMessage(): void {
      // Don't echo - user knows what they typed
    },

    assistantStart(): void {
      console.log('');
      streamBuf = '';
      streamLineCount = 0;
      partialLine = '';
      inCodeBlock = false;
      codeLang = '';
      firstLineDone = false;
    },

    assistantDelta(chunk: string): void {
      streamBuf += chunk;

      // Streaming markdown: process complete lines immediately
      const combined = partialLine + chunk;
      const lines = combined.split('\n');

      // Last element is the incomplete line (may be empty string if chunk ended with \n)
      partialLine = lines.pop() || '';

      // Render each complete line with markdown formatting
      for (const line of lines) {
        // Code block fence detection
        if (line.startsWith('```')) {
          if (inCodeBlock) {
            inCodeBlock = false;
            process.stdout.write(`  ${theme.border(B_LEFT + H_LINE.repeat(3))}\n`);
            codeLang = '';
          } else {
            inCodeBlock = true;
            codeLang = line.slice(3).trim();
            process.stdout.write(`  ${theme.border(T_LEFT + H_LINE.repeat(3))} ${theme.dim(codeLang)}\n`);
          }
          streamLineCount++;
          continue;
        }

        const rendered = renderLine(line, inCodeBlock, codeLang);
        process.stdout.write(rendered + '\n');
        streamLineCount++;
        firstLineDone = true;
      }

      // Write partial line raw (will be overwritten when line completes)
      if (partialLine) {
        if (inCodeBlock) {
          process.stdout.write(`\r\x1b[K  ${theme.border(V_LINE)} ${highlightCode(partialLine, codeLang)}`);
        } else {
          process.stdout.write(`\r\x1b[K  ${fmt(partialLine)}`);
        }
      }
    },

    assistantEnd(): void {
      if (streamBuf.length === 0) return;

      // Flush any remaining partial line
      if (partialLine) {
        const rendered = renderLine(partialLine, inCodeBlock, codeLang);
        process.stdout.write(`\r\x1b[K${rendered}\n`);
        partialLine = '';
      } else if (firstLineDone) {
        // Just ensure we end with a newline
      }

      streamBuf = '';
      streamLineCount = 0;
      inCodeBlock = false;
      codeLang = '';
    },

    thinkingStart(): void {
      thinkingBuf = '';
      process.stdout.write(theme.dim(`  ${CIRCLE} thinking`));
    },

    thinkingDelta(chunk: string): void {
      if (!chunk || chunk.trim() === '') {
        process.stdout.write(theme.dim('.'));
        return;
      }
      // First real content - clear the "thinking..." line
      if (thinkingBuf === '') {
        process.stdout.write('\r\x1b[K');
        console.log(theme.dim(`  ${CIRCLE} thinking:`));
      }
      thinkingBuf += chunk;
      const lines = chunk.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (i > 0) process.stdout.write('\n');
        if (lines[i]) {
          process.stdout.write(theme.dim(theme.italic(`    ${lines[i]}`)));
        }
      }
    },

    thinkingEnd(): void {
      process.stdout.write('\n');
      if (thinkingBuf) {
        console.log(theme.dim(`  ${CIRCLE} done thinking`));
      }
      thinkingBuf = '';
    },

    toolCall(name: string, args: Record<string, unknown>): void {
      const firstVal = Object.values(args)[0];
      const preview = firstVal ? truncStr(String(firstVal), 36) : '';
      const label = preview
        ? `${theme.gold(GEAR + ' ' + name)} ${theme.dim(preview)}`
        : theme.gold(GEAR + ' ' + name);
      console.log(separator(label));

      // Show key arguments for common tools
      const entries = Object.entries(args);
      if (entries.length > 1) {
        const maxArgs = 3;
        for (let i = 0; i < Math.min(entries.length, maxArgs); i++) {
          const [key, val] = entries[i];
          const valStr = truncStr(String(val), 50);
          console.log(theme.dim(`  ${theme.border(V_LINE)} ${key}: ${valStr}`));
        }
        if (entries.length > maxArgs) {
          console.log(theme.dim(`  ${theme.border(V_LINE)} +${entries.length - maxArgs} more`));
        }
      }
    },

    toolResult(name: string, result: unknown, success: boolean, durationMs?: number): void {
      const icon = success ? theme.mint(CHECK) : theme.coral(CROSS);
      const dur = durationMs ? theme.dim(` ${formatElapsed(durationMs)}`) : '';
      const statusText = success ? '' : theme.coral(' failed');

      // Show result preview for verbose mode
      if (result !== undefined && result !== null) {
        const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
        if (!success) {
          // Show error details
          const errPreview = truncStr(resultStr, 80);
          console.log(`  ${icon}${statusText}${dur}`);
          console.log(theme.coral(`  ${theme.border(V_LINE)} ${errPreview}`));
        } else {
          // Show success with brief preview
          const preview = truncStr(resultStr, 60);
          if (preview.length > 5 && resultStr.length > 10) {
            console.log(`  ${icon}${dur} ${theme.dim(preview)}`);
          } else {
            console.log(`  ${icon}${dur}`);
          }
        }
      } else {
        console.log(`  ${icon}${statusText}${dur}`);
      }

      console.log(separator());
    },

    usage(usage: TokenUsage, durationMs?: number): void {
      const parts: string[] = [];
      if (durationMs) parts.push(formatElapsed(durationMs));
      if (usage.totalTokens) {
        parts.push(`${formatTokens(usage.promptTokens)} in ${DOT} ${formatTokens(usage.completionTokens)} out`);
      }
      if (usage.cost !== undefined && usage.cost > 0) parts.push(`$${usage.cost.toFixed(4)}`);
      if (parts.length > 0) {
        console.log('');
        console.log(theme.dim(`  ${parts.join(` ${DOT} `)}`));
      }
    },

    error(message: string): void {
      console.log(`  ${theme.coral(CROSS)} ${message}`);
    },

    info(message: string): void {
      console.log(theme.dim(`  ${message}`));
    },

    success(message: string): void {
      console.log(`  ${theme.mint(CHECK)} ${message}`);
    },

    warn(message: string): void {
      console.log(`  ${theme.gold('!')} ${message}`);
    },

    divider(): void {
      console.log(separator());
    },

    clear(): void {
      console.clear();
    },

    statusLine(text: string): void {
      // Write to bottom of terminal using ANSI save/restore cursor
      if (process.stdout.isTTY) {
        const rows = process.stdout.rows || 24;
        process.stdout.write(`\x1b7`);          // Save cursor
        process.stdout.write(`\x1b[${rows};1H`); // Move to bottom row
        process.stdout.write(`\x1b[2K`);          // Clear line
        process.stdout.write(theme.dim(text));
        process.stdout.write(`\x1b8`);            // Restore cursor
      }
    },

    sessionFooter(state: { sessionTokens: number; sessionCost: number; messageCount: number; model?: string }): void {
      const parts: string[] = [];
      if (state.sessionTokens > 0) parts.push(`${formatTokens(state.sessionTokens)} tokens`);
      if (state.sessionCost > 0) parts.push(`$${state.sessionCost.toFixed(4)}`);
      parts.push(`${state.messageCount} msg${state.messageCount !== 1 ? 's' : ''}`);
      if (state.model) parts.push(state.model);
      console.log(theme.dim(`  ${parts.join(` ${DOT} `)}`));
    },
  };
}
