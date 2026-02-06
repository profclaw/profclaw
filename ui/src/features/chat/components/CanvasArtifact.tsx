/**
 * Canvas Artifact Viewer
 *
 * Renders a single canvas artifact produced by the canvas_render tool.
 * Supports: code, html, markdown, mermaid, diagram, svg, table, chart.
 * Collapsed by default — click the header to expand.
 */

import { useState } from 'react';
import {
  Code2,
  Image,
  Table,
  BarChart3,
  FileText,
  Copy,
  Check,
  ChevronDown,
  ChevronRight,
  Maximize2,
  GitBranch,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { MarkdownRenderer } from '@/components/ui/markdown-renderer';

// =============================================================================
// Types
// =============================================================================

export interface CanvasArtifactData {
  id: string;
  type: 'code' | 'chart' | 'diagram' | 'table' | 'html' | 'markdown' | 'mermaid' | 'svg';
  title?: string;
  content: string;
  language?: string;
  metadata?: Record<string, unknown>;
}

interface CanvasArtifactProps {
  artifact: CanvasArtifactData;
  /** Highlight this artifact (e.g. when selected from the panel) */
  highlighted?: boolean;
}

// =============================================================================
// Helpers
// =============================================================================

const TYPE_CONFIG: Record<
  CanvasArtifactData['type'],
  { label: string; Icon: typeof Code2; colorClass: string }
> = {
  code:     { label: 'Code',     Icon: Code2,    colorClass: 'text-violet-400 bg-violet-500/10' },
  html:     { label: 'HTML',     Icon: Code2,    colorClass: 'text-orange-400 bg-orange-500/10' },
  markdown: { label: 'Markdown', Icon: FileText, colorClass: 'text-blue-400 bg-blue-500/10' },
  mermaid:  { label: 'Mermaid',  Icon: GitBranch,colorClass: 'text-emerald-400 bg-emerald-500/10' },
  diagram:  { label: 'Diagram',  Icon: GitBranch,colorClass: 'text-emerald-400 bg-emerald-500/10' },
  svg:      { label: 'SVG',      Icon: Image,    colorClass: 'text-pink-400 bg-pink-500/10' },
  table:    { label: 'Table',    Icon: Table,    colorClass: 'text-cyan-400 bg-cyan-500/10' },
  chart:    { label: 'Chart',    Icon: BarChart3, colorClass: 'text-yellow-400 bg-yellow-500/10' },
};

/** Strip <script> tags from SVG before rendering inline */
function sanitizeSvg(raw: string): string {
  return raw.replace(/<script[\s\S]*?<\/script>/gi, '');
}

/** Parse JSON table content. Returns null if unparseable. */
function parseTableData(content: string): Record<string, unknown>[] | null {
  try {
    const parsed: unknown = JSON.parse(content);
    if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'object') {
      return parsed as Record<string, unknown>[];
    }
    return null;
  } catch {
    return null;
  }
}

// =============================================================================
// Sub-renderers
// =============================================================================

function CodeRenderer({ content, language }: { content: string; language?: string }) {
  return (
    <pre
      className={cn(
        'text-[12px] font-mono leading-relaxed bg-black/20 rounded-xl p-4 overflow-x-auto',
        'border border-white/5 scrollbar-glass whitespace-pre-wrap break-all max-h-96',
        language && `language-${language}`,
      )}
    >
      <code>{content}</code>
    </pre>
  );
}

function HtmlRenderer({ content }: { content: string }) {
  return (
    <iframe
      srcDoc={content}
      sandbox="allow-scripts"
      title="HTML artifact"
      className="w-full rounded-xl border border-border/20 bg-white"
      style={{ minHeight: '200px', maxHeight: '480px' }}
      aria-label="Rendered HTML content"
    />
  );
}

function SvgRenderer({ content }: { content: string }) {
  const safe = sanitizeSvg(content);
  return (
    <div
      className="flex items-center justify-center rounded-xl border border-border/20 bg-white/5 p-4 overflow-auto max-h-96"
      // eslint-disable-next-line react/no-danger -- SVG is sanitized above
      dangerouslySetInnerHTML={{ __html: safe }}
      aria-label="SVG artifact"
    />
  );
}

function TableRenderer({ content }: { content: string }) {
  const rows = parseTableData(content);

  if (!rows) {
    return (
      <pre className="text-[12px] font-mono bg-black/20 rounded-xl p-4 overflow-x-auto border border-white/5 whitespace-pre-wrap break-all max-h-96">
        {content}
      </pre>
    );
  }

  const headers = Object.keys(rows[0]);

  return (
    <div className="overflow-auto max-h-96 rounded-xl border border-border/20">
      <table className="w-full text-[13px] border-collapse">
        <thead>
          <tr className="bg-muted/40 border-b border-border/30">
            {headers.map((h) => (
              <th
                key={h}
                className="px-3 py-2 text-left font-semibold text-muted-foreground tracking-tight"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={i}
              className="border-b border-border/10 hover:bg-foreground/[0.02] transition-colors"
            >
              {headers.map((h) => (
                <td key={h} className="px-3 py-2 text-foreground/80">
                  {String(row[h] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MermaidRenderer({ content }: { content: string }) {
  return (
    <div className="rounded-xl border border-border/20 bg-muted/20 p-4">
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60 mb-3">
        Mermaid source (rendered on load)
      </p>
      <div className="mermaid text-[13px] font-mono text-foreground/80 whitespace-pre-wrap">
        {content}
      </div>
    </div>
  );
}

function ChartPlaceholder() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-border/20 bg-muted/20 p-10">
      <BarChart3 className="h-12 w-12 text-muted-foreground/30" aria-hidden="true" />
      <p className="text-sm text-muted-foreground/60">Chart rendering coming soon</p>
    </div>
  );
}

// =============================================================================
// Main component
// =============================================================================

export function CanvasArtifact({ artifact, highlighted = false }: CanvasArtifactProps) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const config = TYPE_CONFIG[artifact.type];
  const { Icon, label, colorClass } = config;
  const title = artifact.title || `Untitled ${label}`;

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await navigator.clipboard.writeText(artifact.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const renderContent = () => {
    switch (artifact.type) {
      case 'code':
        return <CodeRenderer content={artifact.content} language={artifact.language} />;
      case 'html':
        return <HtmlRenderer content={artifact.content} />;
      case 'markdown':
        return (
          <div className="prose prose-sm prose-invert max-w-none rounded-xl bg-black/10 p-4 border border-white/5">
            <MarkdownRenderer content={artifact.content} />
          </div>
        );
      case 'mermaid':
      case 'diagram':
        return <MermaidRenderer content={artifact.content} />;
      case 'svg':
        return <SvgRenderer content={artifact.content} />;
      case 'table':
        return <TableRenderer content={artifact.content} />;
      case 'chart':
        return <ChartPlaceholder />;
      default:
        return (
          <pre className="text-[12px] font-mono bg-black/20 rounded-xl p-4 overflow-x-auto border border-white/5 whitespace-pre-wrap break-all max-h-96">
            {artifact.content}
          </pre>
        );
    }
  };

  return (
    <div
      id={`canvas-artifact-${artifact.id}`}
      className={cn(
        'my-3 rounded-2xl border overflow-hidden transition-all duration-300',
        'bg-card/60 backdrop-blur-sm shadow-sm',
        highlighted
          ? 'border-primary/40 shadow-primary/10 shadow-md'
          : 'border-border/20',
      )}
    >
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        aria-controls={`canvas-content-${artifact.id}`}
        aria-label={`${expanded ? 'Collapse' : 'Expand'} ${label} artifact: ${title}`}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-foreground/[0.02] transition-colors text-left"
      >
        {/* Type badge */}
        <div
          className={cn(
            'h-8 w-8 rounded-lg flex items-center justify-center shrink-0',
            colorClass,
          )}
        >
          <Icon className="h-4 w-4" aria-hidden="true" />
        </div>

        {/* Title + type label */}
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-[13px] leading-tight truncate">{title}</p>
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50 mt-0.5">
            {label}
            {artifact.language ? ` · ${artifact.language}` : ''}
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 ml-auto shrink-0">
          <button
            onClick={handleCopy}
            aria-label="Copy artifact content"
            className="p-1.5 rounded-lg hover:bg-white/5 transition-all text-muted-foreground/50 hover:text-foreground"
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 text-green-400" aria-hidden="true" />
            ) : (
              <Copy className="h-3.5 w-3.5" aria-hidden="true" />
            )}
          </button>

          {expanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground/40" aria-hidden="true" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground/40" aria-hidden="true" />
          )}
        </div>
      </button>

      {/* Expandable content */}
      {expanded && (
        <div
          id={`canvas-content-${artifact.id}`}
          className="border-t border-border/10 px-4 pb-4 pt-3"
        >
          {/* Expand-to-full hint for HTML/SVG */}
          {(artifact.type === 'html' || artifact.type === 'svg') && (
            <div className="flex items-center gap-1.5 mb-2 text-[10px] text-muted-foreground/50">
              <Maximize2 className="h-3 w-3" aria-hidden="true" />
              <span>Sandboxed preview</span>
            </div>
          )}
          {renderContent()}
        </div>
      )}
    </div>
  );
}
