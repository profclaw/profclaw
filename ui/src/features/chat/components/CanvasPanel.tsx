/**
 * Canvas Panel
 *
 * Sidebar panel listing all canvas artifacts from the current conversation.
 * Clicking an artifact scrolls to and highlights it in the chat view.
 */

import {
  Code2,
  Image,
  Table,
  BarChart3,
  FileText,
  GitBranch,
  X,
  Layers,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CanvasArtifactData } from './CanvasArtifact';

// =============================================================================
// Types
// =============================================================================

interface CanvasPanelProps {
  artifacts: CanvasArtifactData[];
  onClose: () => void;
  onSelect: (id: string) => void;
  selectedId?: string;
}

// =============================================================================
// Icon map
// =============================================================================

const TYPE_ICONS: Record<CanvasArtifactData['type'], typeof Code2> = {
  code:     Code2,
  html:     Code2,
  markdown: FileText,
  mermaid:  GitBranch,
  diagram:  GitBranch,
  svg:      Image,
  table:    Table,
  chart:    BarChart3,
};

const TYPE_COLORS: Record<CanvasArtifactData['type'], string> = {
  code:     'text-violet-400',
  html:     'text-orange-400',
  markdown: 'text-blue-400',
  mermaid:  'text-emerald-400',
  diagram:  'text-emerald-400',
  svg:      'text-pink-400',
  table:    'text-cyan-400',
  chart:    'text-yellow-400',
};

// =============================================================================
// Component
// =============================================================================

export function CanvasPanel({ artifacts, onClose, onSelect, selectedId }: CanvasPanelProps) {
  return (
    <aside
      className="flex flex-col w-64 shrink-0 rounded-2xl border border-border/20 bg-card/60 backdrop-blur-sm shadow-sm overflow-hidden"
      aria-label="Canvas artifacts panel"
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border/10">
        <Layers className="h-4 w-4 text-primary/70 shrink-0" aria-hidden="true" />
        <span className="font-semibold text-[13px] tracking-tight flex-1">Canvas</span>
        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/40 mr-1">
          {artifacts.length}
        </span>
        <button
          onClick={onClose}
          aria-label="Close canvas panel"
          className="p-1 rounded-lg hover:bg-white/5 text-muted-foreground/50 hover:text-foreground transition-colors"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>

      {/* Artifact list */}
      <div className="flex-1 overflow-y-auto py-2 scrollbar-glass">
        {artifacts.length === 0 ? (
          <p className="text-center text-[12px] text-muted-foreground/40 py-8 px-4">
            No artifacts yet. Ask the agent to render code, charts, or diagrams.
          </p>
        ) : (
          <ul role="list" className="px-2 space-y-0.5">
            {artifacts.map((artifact) => {
              const Icon = TYPE_ICONS[artifact.type];
              const colorClass = TYPE_COLORS[artifact.type];
              const label = artifact.title || `Untitled ${artifact.type}`;
              const isSelected = artifact.id === selectedId;

              return (
                <li key={artifact.id}>
                  <button
                    onClick={() => onSelect(artifact.id)}
                    aria-label={`View ${artifact.type} artifact: ${label}`}
                    aria-current={isSelected ? 'true' : undefined}
                    className={cn(
                      'w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left transition-all duration-150',
                      isSelected
                        ? 'bg-primary/10 border border-primary/20'
                        : 'hover:bg-foreground/[0.04] border border-transparent',
                    )}
                  >
                    <Icon
                      className={cn('h-4 w-4 shrink-0', colorClass)}
                      aria-hidden="true"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-[12px] font-medium leading-tight truncate">
                        {label}
                      </p>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/40 mt-0.5">
                        {artifact.type}
                        {artifact.language ? ` · ${artifact.language}` : ''}
                      </p>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
