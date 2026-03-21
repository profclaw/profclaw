/**
 * Markdown Converter
 *
 * Converts standard markdown to platform-specific formats.
 * The AI agent always produces markdown. Each delivery channel
 * needs its own format.
 *
 * Supported targets:
 *   - telegram: HTML subset (<b>, <i>, <code>, <pre>, <a>)
 *   - slack: mrkdwn (*bold*, _italic_, `code`, ```blocks```, <url|text>)
 *   - discord: Standard markdown (mostly pass-through)
 *   - plain: Strip all formatting
 */

export type FormatTarget = 'telegram' | 'slack' | 'discord' | 'plain' | 'html';

/**
 * Convert markdown text to the target format.
 */
export function convertMarkdown(text: string, target: FormatTarget): string {
  switch (target) {
    case 'telegram':
      return markdownToTelegramHtml(text);
    case 'slack':
      return markdownToSlackMrkdwn(text);
    case 'discord':
      return text; // Discord supports standard markdown
    case 'plain':
      return stripMarkdown(text);
    case 'html':
      return markdownToHtml(text);
    default:
      return text;
  }
}

/**
 * Markdown -> Telegram HTML
 * Telegram supports: <b>, <i>, <u>, <s>, <code>, <pre>, <a href="url">text</a>
 */
function markdownToTelegramHtml(text: string): string {
  let result = text;

  // Escape HTML entities first (but not our converted tags)
  result = result
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Code blocks: ```lang\n...\n``` -> <pre><code>...</code></pre>
  result = result.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, lang: string, code: string) => {
    const langAttr = lang ? ` class="language-${lang}"` : '';
    return `<pre><code${langAttr}>${code.trim()}</code></pre>`;
  });

  // Inline code: `text` -> <code>text</code>
  result = result.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Bold: **text** -> <b>text</b>
  result = result.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');

  // Italic: *text* or _text_ -> <i>text</i>
  result = result.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<i>$1</i>');
  result = result.replace(/(?<!_)_([^_]+)_(?!_)/g, '<i>$1</i>');

  // Strikethrough: ~~text~~ -> <s>text</s>
  result = result.replace(/~~(.+?)~~/g, '<s>$1</s>');

  // Links: [text](url) -> <a href="url">text</a>
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  // Headings: # text -> <b>text</b> (Telegram has no heading tag)
  result = result.replace(/^#{1,3}\s+(.+)$/gm, '<b>$1</b>');

  // Bullet lists: - text or * text -> bullet
  result = result.replace(/^\s*[-*]\s+(.+)$/gm, '\u2022 $1');

  // Numbered lists: keep as-is (Telegram renders them fine)

  // Block quotes: > text -> (no Telegram equivalent, use italic)
  result = result.replace(/^>\s+(.+)$/gm, '<i>$1</i>');

  return result;
}

/**
 * Markdown -> Slack mrkdwn
 * Slack uses: *bold*, _italic_, ~strikethrough~, `code`, ```code blocks```, <url|text>
 */
function markdownToSlackMrkdwn(text: string): string {
  let result = text;

  // Code blocks: keep as-is (Slack supports ```)
  // But remove language hints
  result = result.replace(/```\w*\n/g, '```\n');

  // Bold: **text** -> *text*
  result = result.replace(/\*\*(.+?)\*\*/g, '*$1*');

  // Italic: *text* -> _text_ (but not inside bold)
  // Skip this - could conflict with bold conversion

  // Strikethrough: ~~text~~ -> ~text~
  result = result.replace(/~~(.+?)~~/g, '~$1~');

  // Links: [text](url) -> <url|text>
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<$2|$1>');

  // Headings: # text -> *text* (bold)
  result = result.replace(/^#{1,3}\s+(.+)$/gm, '*$1*');

  // Block quotes: > text -> > text (Slack supports this)
  // Keep as-is

  return result;
}

/**
 * Markdown -> HTML (for web/email)
 */
function markdownToHtml(text: string): string {
  let result = text;

  // Escape HTML
  result = result
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Code blocks
  result = result.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, lang: string, code: string) => {
    return `<pre><code class="${lang}">${code.trim()}</code></pre>`;
  });

  // Inline code
  result = result.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Bold
  result = result.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

  // Italic
  result = result.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');
  result = result.replace(/(?<!_)_([^_]+)_(?!_)/g, '<em>$1</em>');

  // Links
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  // Headings
  result = result.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  result = result.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  result = result.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // Bullet lists
  result = result.replace(/^\s*[-*]\s+(.+)$/gm, '<li>$1</li>');

  // Paragraphs
  result = result.replace(/\n\n/g, '</p><p>');
  result = `<p>${result}</p>`;

  return result;
}

/**
 * Strip all markdown formatting -> plain text
 */
export function stripMarkdown(text: string): string {
  let result = text;

  // Code blocks: remove fences, keep content
  result = result.replace(/```\w*\n([\s\S]*?)```/g, '$1');

  // Inline code: remove backticks
  result = result.replace(/`([^`]+)`/g, '$1');

  // Bold/italic: remove markers
  result = result.replace(/\*\*(.+?)\*\*/g, '$1');
  result = result.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '$1');
  result = result.replace(/(?<!_)_([^_]+)_(?!_)/g, '$1');

  // Strikethrough
  result = result.replace(/~~(.+?)~~/g, '$1');

  // Links: [text](url) -> text (url)
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)');

  // Headings: remove #
  result = result.replace(/^#{1,3}\s+/gm, '');

  // Bullet lists: - text -> text
  result = result.replace(/^\s*[-*]\s+/gm, '- ');

  return result;
}
