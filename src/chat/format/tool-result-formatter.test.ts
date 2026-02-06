/**
 * Tool Result Formatter Tests
 *
 * Tests for src/chat/format/tool-result-formatter.ts
 * Pure functions - no mocks needed.
 */

import { describe, expect, it } from 'vitest';
import { formatToolResult } from './tool-result-formatter.js';
import type { ChannelFormat } from './tool-result-formatter.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResult(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    success: true,
    output: '## Result Heading\n**Bold detail** here.',
    data: {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('formatToolResult', () => {
  // -------------------------------------------------------------------------
  // Null / non-object inputs
  // -------------------------------------------------------------------------

  describe('null / invalid inputs', () => {
    it('returns generic success for null result', () => {
      const formatted = formatToolResult('some_tool', null, 'plain');
      expect(formatted.summary).toBe('Tool completed successfully');
    });

    it('returns generic success for undefined result', () => {
      const formatted = formatToolResult('some_tool', undefined, 'plain');
      expect(formatted.summary).toBe('Tool completed successfully');
    });

    it('returns generic success for string result', () => {
      const formatted = formatToolResult('some_tool', 'just a string', 'plain');
      expect(formatted.summary).toBe('Tool completed successfully');
    });
  });

  // -------------------------------------------------------------------------
  // Error results
  // -------------------------------------------------------------------------

  describe('error results', () => {
    it('returns Error: prefix for success: false with string error', () => {
      const result = { success: false, error: 'Something went wrong' };
      const formatted = formatToolResult('any_tool', result, 'plain');
      expect(formatted.summary).toBe('Error: Something went wrong');
    });

    it('returns Error: prefix for success: false with object error', () => {
      const result = { success: false, error: { code: 'NOT_FOUND', message: 'Resource not found' } };
      const formatted = formatToolResult('any_tool', result, 'plain');
      expect(formatted.summary).toBe('Error: Resource not found');
    });

    it('uses Unknown error when error has no message', () => {
      const result = { success: false, error: { code: 'UNKNOWN' } };
      const formatted = formatToolResult('any_tool', result, 'plain');
      expect(formatted.summary).toBe('Error: Unknown error');
    });
  });

  // -------------------------------------------------------------------------
  // create_ticket
  // -------------------------------------------------------------------------

  describe('create_ticket', () => {
    it('formats ticket key and title in summary', () => {
      const result = {
        success: true,
        data: { key: 'PC-42', title: 'Fix login bug' },
        output: '## Ticket Created\n**PC-42**: Fix login bug',
      };

      const formatted = formatToolResult('create_ticket', result, 'plain');
      expect(formatted.summary).toContain('PC-42');
      expect(formatted.summary).toContain('Fix login bug');
    });

    it('uses UNKNOWN key when data.key is missing', () => {
      const result = { success: true, data: { title: 'No key' } };
      const formatted = formatToolResult('create_ticket', result, 'plain');
      expect(formatted.summary).toContain('UNKNOWN');
    });

    it('formats for discord channel with fields', () => {
      const result = {
        success: true,
        data: { key: 'PC-1', title: 'Test', status: 'Open', priority: 'high' },
        output: '## Ticket\n**PC-1**',
      };

      const formatted = formatToolResult('create_ticket', result, 'discord');
      expect(formatted.summary).toContain('PC-1');
      // Discord format should include fields for key/value pairs
    });
  });

  // -------------------------------------------------------------------------
  // create_project
  // -------------------------------------------------------------------------

  describe('create_project', () => {
    it('formats project name and key in summary', () => {
      const result = {
        success: true,
        data: { name: 'Alpha Project', key: 'AP' },
        output: '## Project Created\nAlpha Project (AP)',
      };

      const formatted = formatToolResult('create_project', result, 'plain');
      expect(formatted.summary).toContain('Alpha Project');
      expect(formatted.summary).toContain('AP');
    });
  });

  // -------------------------------------------------------------------------
  // list_tickets
  // -------------------------------------------------------------------------

  describe('list_tickets', () => {
    it('formats singular ticket count', () => {
      const result = {
        success: true,
        data: { total: 1 },
        output: '## Tickets\n1 ticket found',
      };

      const formatted = formatToolResult('list_tickets', result, 'plain');
      expect(formatted.summary).toBe('Found 1 ticket');
    });

    it('formats plural tickets count', () => {
      const result = {
        success: true,
        data: { total: 5 },
        output: '## Tickets\n5 tickets found',
      };

      const formatted = formatToolResult('list_tickets', result, 'plain');
      expect(formatted.summary).toBe('Found 5 tickets');
    });

    it('handles zero tickets', () => {
      const result = { success: true, data: { total: 0 } };
      const formatted = formatToolResult('list_tickets', result, 'plain');
      expect(formatted.summary).toBe('Found 0 tickets');
    });
  });

  // -------------------------------------------------------------------------
  // list_projects
  // -------------------------------------------------------------------------

  describe('list_projects', () => {
    it('formats projects count', () => {
      const result = {
        success: true,
        data: { projects: [{ id: 1 }, { id: 2 }, { id: 3 }] },
        output: '## Projects\n3 projects',
      };

      const formatted = formatToolResult('list_projects', result, 'plain');
      expect(formatted.summary).toBe('Found 3 projects');
    });

    it('formats singular project', () => {
      const result = {
        success: true,
        data: { projects: [{ id: 1 }] },
        output: '## Projects\n1 project',
      };

      const formatted = formatToolResult('list_projects', result, 'plain');
      expect(formatted.summary).toBe('Found 1 project');
    });
  });

  // -------------------------------------------------------------------------
  // update_ticket
  // -------------------------------------------------------------------------

  describe('update_ticket', () => {
    it('formats updated ticket key', () => {
      const result = {
        success: true,
        data: { key: 'PC-99' },
        output: '## Updated\nPC-99 updated',
      };

      const formatted = formatToolResult('update_ticket', result, 'plain');
      expect(formatted.summary).toContain('PC-99');
    });
  });

  // -------------------------------------------------------------------------
  // get_ticket
  // -------------------------------------------------------------------------

  describe('get_ticket', () => {
    it('formats ticket key and title', () => {
      const result = {
        success: true,
        data: { key: 'PC-10', title: 'Important bug' },
        output: '## PC-10\nImportant bug',
      };

      const formatted = formatToolResult('get_ticket', result, 'plain');
      expect(formatted.summary).toContain('PC-10');
      expect(formatted.summary).toContain('Important bug');
    });
  });

  // -------------------------------------------------------------------------
  // Generic tool (no specific formatter)
  // -------------------------------------------------------------------------

  describe('generic tool fallback', () => {
    it('extracts summary from ## heading in output', () => {
      const result = {
        success: true,
        output: '## Deployment Complete\nAll services running.',
      };

      const formatted = formatToolResult('deploy_app', result, 'plain');
      expect(formatted.summary).toBe('Deployment Complete');
    });

    it('extracts summary from **bold** first line', () => {
      const result = {
        success: true,
        output: '**Task finished**\nSome detail here.',
      };

      const formatted = formatToolResult('some_tool', result, 'plain');
      expect(formatted.summary).toBe('Task finished');
    });

    it('falls back to first line as summary', () => {
      const result = {
        success: true,
        output: 'Plain text result without heading',
      };

      const formatted = formatToolResult('some_tool', result, 'plain');
      expect(formatted.summary).toBe('Plain text result without heading');
    });

    it('returns generic success when no output field', () => {
      const result = { success: true };
      const formatted = formatToolResult('some_tool', result, 'plain');
      expect(formatted.summary).toBe('Tool completed successfully');
    });
  });

  // -------------------------------------------------------------------------
  // Channel format differences
  // -------------------------------------------------------------------------

  describe('channel format transformations', () => {
    const mdOutput = '## Heading\n**Bold text** and *italic*.\n\n`code snippet`';

    it('plain format strips markdown', () => {
      const result = { success: true, output: mdOutput };
      const formatted = formatToolResult('any_tool', result, 'plain');

      expect(formatted.detail).not.toContain('##');
      expect(formatted.detail).not.toContain('**');
      expect(formatted.detail).not.toContain('*italic*');
      expect(formatted.detail).not.toContain('`');
    });

    it('html format converts markdown to HTML tags', () => {
      const result = { success: true, output: mdOutput };
      const formatted = formatToolResult('any_tool', result, 'html');

      expect(formatted.detail).toContain('<b>');
      expect(formatted.detail).toContain('<code>');
    });

    it('discord format passes markdown through', () => {
      const result = { success: true, output: '## Deploy done\n**Status**: success' };
      const formatted = formatToolResult('any_tool', result, 'discord');

      expect(formatted.detail).toContain('**Status**');
    });

    it('discord format includes fields from data', () => {
      const result = {
        success: true,
        output: '## Done',
        data: { status: 'success', priority: 'high', type: 'bug' },
      };

      const formatted = formatToolResult('any_tool', result, 'discord');
      expect(Array.isArray(formatted.fields)).toBe(true);
      expect(formatted.fields?.length).toBeGreaterThan(0);
    });

    it('discord fields mark inline keys as inline', () => {
      const result = {
        success: true,
        output: '## Done',
        data: { status: 'active', type: 'feature', priority: 'low' },
      };

      const formatted = formatToolResult('any_tool', result, 'discord');
      const statusField = formatted.fields?.find(f => f.name.toLowerCase().includes('status'));
      expect(statusField?.inline).toBe(true);
    });

    it('discord fields skip null/undefined values', () => {
      const result = {
        success: true,
        output: '## Done',
        data: { status: 'ok', nullField: null, undefinedField: undefined },
      };

      const formatted = formatToolResult('any_tool', result, 'discord');
      const nullField = formatted.fields?.find(f => f.name.toLowerCase().includes('null'));
      expect(nullField).toBeUndefined();
    });

    it('discord fields skip id and url fields', () => {
      const result = {
        success: true,
        output: '## Done',
        data: { id: '123', url: 'https://example.com', status: 'ok' },
      };

      const formatted = formatToolResult('any_tool', result, 'discord');
      const idField = formatted.fields?.find(f => f.name.toLowerCase() === 'id');
      const urlField = formatted.fields?.find(f => f.name.toLowerCase() === 'url');
      expect(idField).toBeUndefined();
      expect(urlField).toBeUndefined();
    });

    it('discord fields skip nested objects', () => {
      const result = {
        success: true,
        output: '## Done',
        data: { status: 'ok', nested: { a: 1, b: 2 } },
      };

      const formatted = formatToolResult('any_tool', result, 'discord');
      const nestedField = formatted.fields?.find(f => f.name.toLowerCase().includes('nested'));
      expect(nestedField).toBeUndefined();
    });

    it('discord fields skip values longer than 200 chars', () => {
      const result = {
        success: true,
        output: '## Done',
        data: { longField: 'x'.repeat(201) },
      };

      const formatted = formatToolResult('any_tool', result, 'discord');
      const longField = formatted.fields?.find(f => f.name.toLowerCase().includes('long'));
      expect(longField).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Output format tests
  // -------------------------------------------------------------------------

  describe('output detail correctness', () => {
    it('detail is provided for tool with output', () => {
      const result = {
        success: true,
        output: '## Done\nSome details here.',
      };

      const formatted = formatToolResult('any_tool', result, 'plain');
      expect(formatted.detail).toBeDefined();
      expect(formatted.detail?.length).toBeGreaterThan(0);
    });

    it('all formats produce a non-empty summary', () => {
      const result = { success: true, output: '## Completed successfully' };
      const formats: ChannelFormat[] = ['plain', 'html', 'discord'];

      for (const fmt of formats) {
        const formatted = formatToolResult('any_tool', result, fmt);
        expect(formatted.summary.length).toBeGreaterThan(0);
      }
    });
  });
});
