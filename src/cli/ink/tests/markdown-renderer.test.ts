/**
 * Markdown Renderer Tests
 *
 * Tests for renderMarkdown(), highlightCode(), and stripMarkdown().
 * Verifies that markdown constructs produce the expected Ink React elements
 * and that plain-text stripping works correctly for /copy and /save.
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { renderMarkdown, highlightCode, stripMarkdown } from '../markdown-renderer.js';

// ── renderMarkdown ─────────────────────────────────────────────────────────────

describe('renderMarkdown — bold', () => {
  it('renders **bold** text with Text bold prop', () => {
    const { lastFrame } = render(
      React.createElement(React.Fragment, null, renderMarkdown('This is **important** text.'))
    );
    // ink-testing-library renders bold via ANSI; the text itself should be visible
    expect(lastFrame()).toContain('important');
  });

  it('renders bold without extra asterisks in output', () => {
    const { lastFrame } = render(
      React.createElement(React.Fragment, null, renderMarkdown('**hello**'))
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('hello');
    expect(frame).not.toContain('**');
  });
});

describe('renderMarkdown — italic', () => {
  it('renders *italic* text', () => {
    const { lastFrame } = render(
      React.createElement(React.Fragment, null, renderMarkdown('*italicized*'))
    );
    expect(lastFrame()).toContain('italicized');
  });

  it('renders _italic_ underscore form', () => {
    const { lastFrame } = render(
      React.createElement(React.Fragment, null, renderMarkdown('_em_'))
    );
    expect(lastFrame()).toContain('em');
  });
});

describe('renderMarkdown — inline code', () => {
  it('renders `inline code` without backticks', () => {
    const { lastFrame } = render(
      React.createElement(React.Fragment, null, renderMarkdown('Use `npm install` to start.'))
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('npm install');
    expect(frame).not.toContain('`');
  });
});

describe('renderMarkdown — strikethrough', () => {
  it('renders ~~strikethrough~~ text without tildes', () => {
    const { lastFrame } = render(
      React.createElement(React.Fragment, null, renderMarkdown('~~deprecated~~'))
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('deprecated');
    expect(frame).not.toContain('~~');
  });
});

describe('renderMarkdown — headings', () => {
  it('renders # H1 heading bold cyan', () => {
    const { lastFrame } = render(
      React.createElement(React.Fragment, null, renderMarkdown('# Main Title'))
    );
    expect(lastFrame()).toContain('Main Title');
  });

  it('renders ## H2 heading bold cyan', () => {
    const { lastFrame } = render(
      React.createElement(React.Fragment, null, renderMarkdown('## Section'))
    );
    expect(lastFrame()).toContain('Section');
  });

  it('renders ### H3 heading bold', () => {
    const { lastFrame } = render(
      React.createElement(React.Fragment, null, renderMarkdown('### Subsection'))
    );
    expect(lastFrame()).toContain('Subsection');
  });

  it('does not include the # characters in output', () => {
    const { lastFrame } = render(
      React.createElement(React.Fragment, null, renderMarkdown('# Title'))
    );
    expect(lastFrame()).not.toContain('# ');
  });
});

describe('renderMarkdown — code blocks', () => {
  it('renders code fence with language label', () => {
    const md = '```typescript\nconst x = 1;\n```';
    const { lastFrame } = render(
      React.createElement(React.Fragment, null, renderMarkdown(md))
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('typescript');
    expect(frame).toContain('x = 1');
  });

  it('renders code fence open and close markers', () => {
    const md = '```js\nfoo();\n```';
    const { lastFrame } = render(
      React.createElement(React.Fragment, null, renderMarkdown(md))
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('┌');
    expect(frame).toContain('└');
  });

  it('renders code block without backtick lines in output', () => {
    const md = '```\nhello world\n```';
    const { lastFrame } = render(
      React.createElement(React.Fragment, null, renderMarkdown(md))
    );
    const frame = lastFrame() ?? '';
    expect(frame).not.toContain('```');
    expect(frame).toContain('hello world');
  });

  it('syntax highlights code block with language', () => {
    const md = '```python\ndef greet():\n    pass\n```';
    const { lastFrame } = render(
      React.createElement(React.Fragment, null, renderMarkdown(md))
    );
    const frame = lastFrame() ?? '';
    // Code content should be present
    expect(frame).toContain('def greet');
  });
});

describe('renderMarkdown — links', () => {
  it('renders [label](url) link with label text', () => {
    const { lastFrame } = render(
      React.createElement(React.Fragment, null, renderMarkdown('[GitHub](https://github.com)'))
    );
    expect(lastFrame()).toContain('GitHub');
  });

  it('renders link with color (blue) — label visible', () => {
    const { lastFrame } = render(
      React.createElement(React.Fragment, null, renderMarkdown('See [docs](https://example.com/docs)'))
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('docs');
    expect(frame).not.toContain('https://');
  });

  it('renders link label without markdown brackets/parens', () => {
    const { lastFrame } = render(
      React.createElement(React.Fragment, null, renderMarkdown('[Click me](https://x.com)'))
    );
    const frame = lastFrame() ?? '';
    expect(frame).not.toContain('[');
    expect(frame).not.toContain('](');
  });

  it('renders link footnote style with URL shown', () => {
    const { lastFrame } = render(
      React.createElement(React.Fragment, null,
        renderMarkdown('[Click](https://example.com)', { linkStyle: 'footnote' })
      )
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Click');
    expect(frame).toContain('https://example.com');
  });

  it('renders link hidden style with only label text', () => {
    const { lastFrame } = render(
      React.createElement(React.Fragment, null,
        renderMarkdown('[visit](https://example.com)', { linkStyle: 'hidden' })
      )
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('visit');
    expect(frame).not.toContain('https://');
  });
});

describe('renderMarkdown — blockquotes', () => {
  it('renders > blockquote without the > marker', () => {
    const { lastFrame } = render(
      React.createElement(React.Fragment, null, renderMarkdown('> Some quoted text'))
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Some quoted text');
    expect(frame).not.toContain('> ');
  });

  it('renders blockquote with left border character', () => {
    const { lastFrame } = render(
      React.createElement(React.Fragment, null, renderMarkdown('> quote'))
    );
    expect(lastFrame()).toContain('│');
  });
});

describe('renderMarkdown — bullet lists', () => {
  it('renders - bullet list item', () => {
    const { lastFrame } = render(
      React.createElement(React.Fragment, null, renderMarkdown('- First item'))
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('First item');
    expect(frame).toContain('›');
  });

  it('renders * bullet list item', () => {
    const { lastFrame } = render(
      React.createElement(React.Fragment, null, renderMarkdown('* Second item'))
    );
    expect(lastFrame()).toContain('Second item');
  });

  it('renders multiple bullet items', () => {
    const md = '- Alpha\n- Beta\n- Gamma';
    const { lastFrame } = render(
      React.createElement(React.Fragment, null, renderMarkdown(md))
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Alpha');
    expect(frame).toContain('Beta');
    expect(frame).toContain('Gamma');
  });
});

describe('renderMarkdown — numbered lists', () => {
  it('renders numbered list items', () => {
    const md = '1. First\n2. Second\n3. Third';
    const { lastFrame } = render(
      React.createElement(React.Fragment, null, renderMarkdown(md))
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('First');
    expect(frame).toContain('Second');
    expect(frame).toContain('Third');
  });

  it('shows the number prefix', () => {
    const { lastFrame } = render(
      React.createElement(React.Fragment, null, renderMarkdown('1. Item'))
    );
    expect(lastFrame()).toContain('1.');
  });
});

describe('renderMarkdown — horizontal rule', () => {
  it('renders --- as a dim line', () => {
    const { lastFrame } = render(
      React.createElement(React.Fragment, null, renderMarkdown('---'))
    );
    // Should render a horizontal line of dashes (─)
    expect(lastFrame()).toContain('─');
  });

  it('renders *** as horizontal rule', () => {
    const { lastFrame } = render(
      React.createElement(React.Fragment, null, renderMarkdown('***'))
    );
    expect(lastFrame()).toContain('─');
  });
});

describe('renderMarkdown — plain text passthrough', () => {
  it('renders plain text unchanged', () => {
    const { lastFrame } = render(
      React.createElement(React.Fragment, null, renderMarkdown('Hello, world!'))
    );
    expect(lastFrame()).toContain('Hello, world!');
  });

  it('renders multi-line plain text', () => {
    const { lastFrame } = render(
      React.createElement(React.Fragment, null, renderMarkdown('Line one\nLine two'))
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Line one');
    expect(frame).toContain('Line two');
  });
});

// ── highlightCode ──────────────────────────────────────────────────────────────

describe('highlightCode', () => {
  it('renders code text without crashing', () => {
    const { lastFrame } = render(
      React.createElement(React.Fragment, null, highlightCode('const x = 1;', 'typescript'))
    );
    expect(lastFrame()).toContain('x = 1');
  });

  it('includes the const keyword text', () => {
    const { lastFrame } = render(
      React.createElement(React.Fragment, null, highlightCode('const foo = "bar";', 'javascript'))
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('const');
    expect(frame).toContain('foo');
  });

  it('renders python code', () => {
    const { lastFrame } = render(
      React.createElement(React.Fragment, null, highlightCode('def hello():', 'python'))
    );
    expect(lastFrame()).toContain('def');
    expect(lastFrame()).toContain('hello');
  });

  it('renders bash/shell code plain', () => {
    const { lastFrame } = render(
      React.createElement(React.Fragment, null, highlightCode('echo "hello"', 'bash'))
    );
    expect(lastFrame()).toContain('echo');
  });

  it('renders JSON without crashing', () => {
    const { lastFrame } = render(
      React.createElement(React.Fragment, null, highlightCode('{"key": 42}', 'json'))
    );
    expect(lastFrame()).toContain('key');
    expect(lastFrame()).toContain('42');
  });

  it('renders a comment line in dimmed color', () => {
    const { lastFrame } = render(
      React.createElement(React.Fragment, null, highlightCode('// this is a comment', 'typescript'))
    );
    expect(lastFrame()).toContain('this is a comment');
  });
});

// ── stripMarkdown ──────────────────────────────────────────────────────────────

describe('stripMarkdown', () => {
  it('removes **bold** markers', () => {
    expect(stripMarkdown('This is **bold** text.')).toBe('This is bold text.');
  });

  it('removes *italic* markers', () => {
    expect(stripMarkdown('This is *italic* text.')).toBe('This is italic text.');
  });

  it('removes _italic_ underscore markers', () => {
    expect(stripMarkdown('_em_')).toBe('em');
  });

  it('removes ~~strikethrough~~ markers', () => {
    expect(stripMarkdown('~~old~~')).toBe('old');
  });

  it('removes `inline code` backticks', () => {
    expect(stripMarkdown('Run `npm install`.')).toBe('Run npm install.');
  });

  it('removes heading # prefix', () => {
    expect(stripMarkdown('# Title')).toBe('Title');
    expect(stripMarkdown('## Subtitle')).toBe('Subtitle');
    expect(stripMarkdown('### Sub')).toBe('Sub');
  });

  it('removes code fence markers, keeps code content', () => {
    const md = '```typescript\nconst x = 1;\n```';
    const stripped = stripMarkdown(md);
    expect(stripped).toContain('const x = 1;');
    expect(stripped).not.toContain('```');
  });

  it('removes code fence markers for unnamed fence', () => {
    const md = '```\nhello\n```';
    const stripped = stripMarkdown(md);
    expect(stripped).toContain('hello');
    expect(stripped).not.toContain('```');
  });

  it('replaces [label](url) link with just label', () => {
    expect(stripMarkdown('[GitHub](https://github.com)')).toBe('GitHub');
  });

  it('removes blockquote > prefix', () => {
    expect(stripMarkdown('> Some quote')).toBe('Some quote');
  });

  it('removes horizontal rule', () => {
    const stripped = stripMarkdown('Before\n---\nAfter');
    expect(stripped).not.toContain('---');
    expect(stripped).toContain('Before');
    expect(stripped).toContain('After');
  });

  it('removes all formatting in a complex document', () => {
    const md = [
      '# Heading',
      '',
      'Some **bold** and *italic* text.',
      '',
      '- Item one',
      '- Item two',
      '',
      '```js',
      'console.log("hi");',
      '```',
      '',
      '[Link](https://example.com)',
    ].join('\n');

    const stripped = stripMarkdown(md);

    expect(stripped).toContain('Heading');
    expect(stripped).toContain('bold');
    expect(stripped).toContain('italic');
    expect(stripped).toContain('Item one');
    expect(stripped).toContain('console.log');
    expect(stripped).toContain('Link');
    expect(stripped).not.toContain('**');
    expect(stripped).not.toContain('*');
    expect(stripped).not.toContain('```');
    expect(stripped).not.toContain('# ');
    expect(stripped).not.toContain('https://');
  });

  it('handles empty string', () => {
    expect(stripMarkdown('')).toBe('');
  });

  it('handles plain text with no markdown', () => {
    expect(stripMarkdown('Just plain text.')).toBe('Just plain text.');
  });
});
