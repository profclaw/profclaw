/**
 * Tool Result Formatter
 *
 * Converts raw tool results into formatted output for different channels:
 * - plain: WhatsApp, SMS (no markdown)
 * - html: Telegram (supports <b>, <code>, <i>)
 * - discord: Discord markdown + optional embed fields
 */

// Types

export type ChannelFormat = 'plain' | 'html' | 'discord';

export interface FormattedToolResult {
  /** One-line summary (e.g., "Created ticket PC-42: Fix login") */
  summary: string;
  /** Multi-line detail (markdown, html, or plain depending on format) */
  detail?: string;
  /** Discord embed fields */
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
}

// Helpers

/** Extract first heading or first line from markdown output */
function extractSummaryFromOutput(output: string): string {
  const lines = output.split('\n').filter(l => l.trim());
  for (const line of lines) {
    // Match ## Heading or **bold** lines
    const headingMatch = line.match(/^#{1,3}\s+(.+)/);
    if (headingMatch) return headingMatch[1].trim();
    const boldMatch = line.match(/^\*\*(.+?)\*\*/);
    if (boldMatch) return boldMatch[1].trim();
  }
  return lines[0]?.replace(/^[#*\s]+/, '').trim() || 'Tool completed';
}

/** Convert markdown to plain text */
function mdToPlain(md: string): string {
  return md
    .replace(/#{1,3}\s+/g, '')        // Remove headings
    .replace(/\*\*(.+?)\*\*/g, '$1')  // Bold → plain
    .replace(/\*(.+?)\*/g, '$1')      // Italic → plain
    .replace(/`(.+?)`/g, '$1')        // Code → plain
    .replace(/\|/g, ' ')              // Table pipes
    .replace(/^-{3,}/gm, '')          // Horizontal rules
    .replace(/^[-*]\s+/gm, '- ')      // Normalize bullets
    .replace(/\n{3,}/g, '\n\n')       // Collapse whitespace
    .trim();
}

/** Convert markdown to Telegram HTML */
function mdToHtml(md: string): string {
  return md
    .replace(/#{1,3}\s+(.+)/g, '<b>$1</b>')           // Headings → bold
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')            // Bold
    .replace(/\*(.+?)\*/g, '<i>$1</i>')                // Italic
    .replace(/`(.+?)`/g, '<code>$1</code>')            // Code
    .replace(/\|[^|]+\|[^|]+\|[^|]+\|[^|]+\|/g, '')   // Remove table header separators
    .trim();
}

/** Extract key-value fields from data for Discord embeds */
function extractFields(
  data: Record<string, unknown>
): Array<{ name: string; value: string; inline?: boolean }> {
  const fields: Array<{ name: string; value: string; inline?: boolean }> = [];
  const inlineKeys = ['status', 'type', 'priority', 'key', 'projectKey'];

  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === null) continue;
    if (key === 'id' || key === 'url') continue; // Skip internal fields
    if (typeof value === 'object' && !Array.isArray(value)) continue; // Skip nested objects

    const displayValue = Array.isArray(value) ? value.join(', ') : String(value);
    if (displayValue.length > 200) continue; // Skip very long values

    fields.push({
      name: key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()).trim(),
      value: displayValue,
      inline: inlineKeys.includes(key),
    });
  }

  return fields.slice(0, 10); // Discord max 25, but keep it reasonable
}

// Per-tool formatters

type ToolFormatter = (
  result: Record<string, unknown>,
  format: ChannelFormat
) => FormattedToolResult;

const toolFormatters: Record<string, ToolFormatter> = {
  create_ticket(result, format) {
    const data = (result.data || result) as Record<string, unknown>;
    const key = data.key || 'UNKNOWN';
    const title = data.title || '';
    const summary = `Created ticket ${key}: ${title}`;

    if (result.output && typeof result.output === 'string') {
      return formatFromOutput(summary, result.output as string, data, format);
    }

    return { summary, detail: summary };
  },

  create_project(result, format) {
    const data = (result.data || result) as Record<string, unknown>;
    const name = data.name || '';
    const key = data.key || '';
    const summary = `Created project ${name} (${key})`;

    if (result.output && typeof result.output === 'string') {
      return formatFromOutput(summary, result.output as string, data, format);
    }

    return { summary, detail: summary };
  },

  list_tickets(result, format) {
    const data = (result.data || result) as Record<string, unknown>;
    const total = (data.total as number) || 0;
    const summary = `Found ${total} ticket${total !== 1 ? 's' : ''}`;

    if (result.output && typeof result.output === 'string') {
      return formatFromOutput(summary, result.output as string, data, format);
    }

    return { summary, detail: summary };
  },

  list_projects(result, format) {
    const data = (result.data || result) as Record<string, unknown>;
    const projectList = (data.projects as unknown[]) || [];
    const summary = `Found ${projectList.length} project${projectList.length !== 1 ? 's' : ''}`;

    if (result.output && typeof result.output === 'string') {
      return formatFromOutput(summary, result.output as string, data, format);
    }

    return { summary, detail: summary };
  },

  update_ticket(result, format) {
    const data = (result.data || result) as Record<string, unknown>;
    const key = data.key || 'UNKNOWN';
    const summary = `Updated ticket ${key}`;

    if (result.output && typeof result.output === 'string') {
      return formatFromOutput(summary, result.output as string, data, format);
    }

    return { summary, detail: summary };
  },

  get_ticket(result, format) {
    const data = (result.data || result) as Record<string, unknown>;
    const key = data.key || 'UNKNOWN';
    const title = data.title || '';
    const summary = `${key}: ${title}`;

    if (result.output && typeof result.output === 'string') {
      return formatFromOutput(summary, result.output as string, data, format);
    }

    return { summary, detail: summary };
  },
};

/** Build a FormattedToolResult from an output markdown string */
function formatFromOutput(
  summary: string,
  output: string,
  data: Record<string, unknown>,
  format: ChannelFormat
): FormattedToolResult {
  switch (format) {
    case 'plain':
      return { summary, detail: mdToPlain(output) };
    case 'html':
      return { summary, detail: mdToHtml(output) };
    case 'discord':
      return {
        summary,
        detail: output, // Discord supports markdown natively
        fields: extractFields(data),
      };
    default:
      return { summary, detail: output };
  }
}

// Main formatter

/**
 * Format a tool result for a specific channel.
 *
 * @param toolName - The tool that produced the result
 * @param result - The raw result object (may include data, output, success fields)
 * @param format - Target channel format
 */
export function formatToolResult(
  toolName: string,
  result: unknown,
  format: ChannelFormat
): FormattedToolResult {
  if (!result || typeof result !== 'object') {
    return { summary: 'Tool completed successfully' };
  }

  const record = result as Record<string, unknown>;

  // Error results
  if (record.success === false) {
    const errorMsg = typeof record.error === 'string'
      ? record.error
      : (record.error as Record<string, unknown>)?.message as string || 'Unknown error';
    return { summary: `Error: ${errorMsg}` };
  }

  // Use per-tool formatter if available
  const formatter = toolFormatters[toolName];
  if (formatter) {
    return formatter(record, format);
  }

  // Generic: use output field if available
  if (typeof record.output === 'string') {
    const summary = extractSummaryFromOutput(record.output);
    return formatFromOutput(summary, record.output, record.data as Record<string, unknown> || {}, format);
  }

  return { summary: 'Tool completed successfully' };
}
