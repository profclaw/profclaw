/**
 * SessionOutput Component
 *
 * Displays streaming tool execution output with:
 * - Real-time output streaming via SSE
 * - ANSI color code support
 * - Auto-scroll to bottom
 * - Status indicators
 * - Kill/stdin support
 */

import React, { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import {
  useSessionStream,
  type SessionStreamState,
} from '@/core/hooks/useSessionStream';
import {
  Terminal,
  X,
  Loader2,
  CheckCircle,
  XCircle,
  Clock,
  Skull,
  Send,
} from 'lucide-react';
import { Button } from './button';
import { Input } from './input';

interface SessionOutputProps {
  sessionId: string | null;
  className?: string;
  maxHeight?: string;
  showControls?: boolean;
  showStatus?: boolean;
  onComplete?: (state: SessionStreamState) => void;
}

// Simple ANSI to HTML converter for basic colors
function ansiToHtml(text: string): string {
  const ansiColors: Record<string, string> = {
    '30': 'color: #4a4a4a',
    '31': 'color: #ef4444',
    '32': 'color: #22c55e',
    '33': 'color: #eab308',
    '34': 'color: #3b82f6',
    '35': 'color: #a855f7',
    '36': 'color: #06b6d4',
    '37': 'color: #e5e5e5',
    '90': 'color: #737373',
    '91': 'color: #f87171',
    '92': 'color: #4ade80',
    '93': 'color: #facc15',
    '94': 'color: #60a5fa',
    '95': 'color: #c084fc',
    '96': 'color: #22d3ee',
    '97': 'color: #ffffff',
    '1': 'font-weight: bold',
    '0': '',
  };

  // Replace ANSI codes with spans
  let result = text.replace(
    /\x1b\[([0-9;]+)m/g,
    (_, codes: string) => {
      const styles = codes.split(';').map((c) => ansiColors[c] || '').filter(Boolean);
      if (styles.length === 0 || codes === '0') {
        return '</span>';
      }
      return `<span style="${styles.join(';')}">`;
    }
  );

  // Close any unclosed spans
  const openSpans = (result.match(/<span/g) || []).length;
  const closeSpans = (result.match(/<\/span>/g) || []).length;
  for (let i = closeSpans; i < openSpans; i++) {
    result += '</span>';
  }

  return result;
}

const statusConfig = {
  connecting: { icon: Loader2, color: 'text-blue-500', label: 'Connecting...', spin: true },
  running: { icon: Loader2, color: 'text-green-500', label: 'Running', spin: true },
  completed: { icon: CheckCircle, color: 'text-green-500', label: 'Completed', spin: false },
  failed: { icon: XCircle, color: 'text-red-500', label: 'Failed', spin: false },
  killed: { icon: Skull, color: 'text-orange-500', label: 'Killed', spin: false },
  timeout: { icon: Clock, color: 'text-yellow-500', label: 'Timeout', spin: false },
  disconnected: { icon: X, color: 'text-muted-foreground', label: 'Disconnected', spin: false },
};

export function SessionOutput({
  sessionId,
  className,
  maxHeight = '400px',
  showControls = true,
  showStatus = true,
  onComplete,
}: SessionOutputProps) {
  const outputRef = useRef<HTMLPreElement>(null);
  const [stdinValue, setStdinValue] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);

  const stream = useSessionStream(sessionId, {
    onComplete: (data) => {
      onComplete?.({
        connected: false,
        sessionId,
        toolName: null,
        status: data.status,
        output: data.output,
        exitCode: data.exitCode,
        exitSignal: data.exitSignal ?? undefined,
      });
    },
  });

  // Auto-scroll to bottom on new output
  useEffect(() => {
    if (autoScroll && outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [stream.output, autoScroll]);

  // Detect manual scroll
  const handleScroll = () => {
    if (outputRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = outputRef.current;
      const isAtBottom = scrollTop + clientHeight >= scrollHeight - 20;
      setAutoScroll(isAtBottom);
    }
  };

  const handleSendStdin = async () => {
    if (stdinValue.trim()) {
      const success = await stream.appendToStdin(stdinValue + '\n');
      if (success) {
        setStdinValue('');
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendStdin();
    }
  };

  const statusInfo = statusConfig[stream.status];
  const StatusIcon = statusInfo.icon;

  if (!sessionId) {
    return null;
  }

  return (
    <div className={cn('rounded-lg glass', className)}>
      {/* Header */}
      {showStatus && (
        <div className="flex items-center justify-between gap-2 border-b border-border/20 px-4 py-2 bg-muted/30">
          <div className="flex items-center gap-2">
            <Terminal className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">
              {stream.toolName || 'Session'} <span className="text-muted-foreground">({stream.sessionId || sessionId})</span>
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className={cn('flex items-center gap-1.5 text-sm', statusInfo.color)}>
              <StatusIcon className={cn('h-4 w-4', statusInfo.spin && 'animate-spin')} />
              <span>{statusInfo.label}</span>
            </div>
            {stream.exitCode !== undefined && (
              <span className={cn(
                'text-xs px-2 py-0.5 rounded-full',
                stream.exitCode === 0
                  ? 'bg-green-500/10 text-green-500'
                  : 'bg-red-500/10 text-red-500'
              )}>
                exit: {stream.exitCode}
              </span>
            )}
            {showControls && stream.status === 'running' && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-red-500 hover:text-red-600 hover:bg-red-500/10"
                onClick={() => stream.kill()}
              >
                <X className="h-3 w-3 mr-1" />
                Kill
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Output */}
      <pre
        ref={outputRef}
        onScroll={handleScroll}
        className="overflow-auto p-4 font-mono text-sm bg-black/90 text-green-400 whitespace-pre-wrap break-words"
        style={{ maxHeight }}
        dangerouslySetInnerHTML={{ __html: ansiToHtml(stream.output || '(no output)') }}
      />

      {/* Stdin Input */}
      {showControls && stream.status === 'running' && (
        <div className="flex items-center gap-2 border-t border-border/20 p-2 bg-muted/30">
          <Terminal className="h-4 w-4 text-muted-foreground" />
          <Input
            value={stdinValue}
            onChange={(e) => setStdinValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type input and press Enter..."
            className="h-8 text-sm font-mono bg-background"
          />
          <Button
            size="sm"
            variant="ghost"
            className="h-8 px-2"
            onClick={handleSendStdin}
            disabled={!stdinValue.trim()}
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Connection indicator */}
      {!stream.connected && stream.status !== 'disconnected' && !['completed', 'failed', 'killed', 'timeout'].includes(stream.status) && (
        <div className="border-t border-border/20 px-4 py-2 bg-muted/30 text-xs text-muted-foreground">
          Attempting to reconnect...
        </div>
      )}
    </div>
  );
}

/**
 * Compact session status badge
 */
export function SessionStatusBadge({
  sessionId,
  className,
}: {
  sessionId: string | null;
  className?: string;
}) {
  const stream = useSessionStream(sessionId);
  const statusInfo = statusConfig[stream.status];
  const StatusIcon = statusInfo.icon;

  if (!sessionId) {
    return null;
  }

  return (
    <div className={cn('flex items-center gap-1.5 text-xs', statusInfo.color, className)}>
      <StatusIcon className={cn('h-3 w-3', statusInfo.spin && 'animate-spin')} />
      <span>{statusInfo.label}</span>
    </div>
  );
}
