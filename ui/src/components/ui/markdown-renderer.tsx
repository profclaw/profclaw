/**
 * Markdown Renderer
 *
 * Renders markdown content with syntax highlighting and proper styling.
 * Uses react-markdown with rehype-highlight for code blocks.
 */

import ReactMarkdown, { type Components } from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { cn } from '@/lib/utils';
import { Copy, Check } from 'lucide-react';
import { useState } from 'react';

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

function CodeBlock({
  inline,
  className,
  children,
  ...props
}: {
  inline?: boolean;
  className?: string;
  children?: React.ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  const match = /language-(\w+)/.exec(className || '');
  const language = match ? match[1] : '';
  const codeString = String(children).replace(/\n$/, '');

  const handleCopy = async () => {
    await navigator.clipboard.writeText(codeString);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (inline) {
    return (
      <code
        className="px-1.5 py-0.5 rounded bg-muted font-mono text-[0.9em]"
        {...props}
      >
        {children}
      </code>
    );
  }

  return (
    <div className="relative group my-3 overflow-hidden">
      {language && (
        <div className="absolute top-0 left-0 px-3 py-1 text-xs text-muted-foreground bg-muted/80 rounded-tl-lg rounded-br-lg font-mono z-10">
          {language}
        </div>
      )}
      <button
        onClick={handleCopy}
        className="absolute top-2 right-2 p-1.5 rounded-lg bg-muted/80 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-muted z-10"
      >
        {copied ? (
          <Check className="h-3.5 w-3.5 text-green-400" />
        ) : (
          <Copy className="h-3.5 w-3.5 text-muted-foreground" />
        )}
      </button>
      <SyntaxHighlighter
        style={oneDark}
        language={language || 'text'}
        PreTag="div"
        wrapLongLines={true}
        customStyle={{
          margin: 0,
          borderRadius: '0.75rem',
          fontSize: '0.85em',
          padding: language ? '2rem 1rem 1rem 1rem' : '1rem',
          overflowX: 'auto',
        }}
        {...props}
      >
        {codeString}
      </SyntaxHighlighter>
    </div>
  );
}

export function MarkdownRenderer({ content, className }: MarkdownRendererProps) {
  return (
    <ReactMarkdown
      className={cn('prose prose-invert prose-sm max-w-none wrap-anywhere', className)}
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex]}
      components={{
        code: CodeBlock as Components['code'],
        // Style other elements - add word wrapping
        p: ({ children }) => <p className="mb-3 last:mb-0 wrap-anywhere">{children}</p>,
        ul: ({ children }) => <ul className="list-disc pl-4 mb-3 space-y-1">{children}</ul>,
        ol: ({ children }) => <ol className="list-decimal pl-4 mb-3 space-y-1">{children}</ol>,
        li: ({ children }) => <li className="text-sm">{children}</li>,
        h1: ({ children }) => <h1 className="text-xl font-bold mb-3 mt-4">{children}</h1>,
        h2: ({ children }) => <h2 className="text-lg font-semibold mb-2 mt-3">{children}</h2>,
        h3: ({ children }) => <h3 className="text-base font-medium mb-2 mt-2">{children}</h3>,
        a: ({ href, children }) => (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            {children}
          </a>
        ),
        blockquote: ({ children }) => (
          <blockquote className="border-l-2 border-primary/50 pl-4 italic text-muted-foreground">
            {children}
          </blockquote>
        ),
        table: ({ children }) => (
          <div className="overflow-x-auto my-3">
            <table className="min-w-full rounded-lg">{children}</table>
          </div>
        ),
        th: ({ children }) => (
          <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground bg-muted border-b border-border">
            {children}
          </th>
        ),
        td: ({ children }) => (
          <td className="px-3 py-2 text-sm border-b border-border">{children}</td>
        ),
        hr: () => <hr className="my-4 border-border" />,
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

export default MarkdownRenderer;
