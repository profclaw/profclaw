/**
 * Command Line Component
 *
 * Displays a command with copy button for terminal commands.
 */

import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CommandLineProps {
  command: string;
  description: string;
  highlight?: boolean;
}

export function CommandLine({ command, description, highlight }: CommandLineProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      className={cn(
        'group flex items-center justify-between gap-3 px-3 py-2 rounded-lg transition-colors',
        highlight
          ? 'bg-primary/10 border border-primary/20'
          : 'hover:bg-zinc-800'
      )}
    >
      <div className="flex items-center gap-3 min-w-0">
        <span className="text-emerald-400 font-mono text-xs">$</span>
        <code className="text-zinc-200 font-mono text-xs truncate">{command}</code>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-zinc-500 text-[10px] hidden sm:block">
          {description}
        </span>
        <button
          onClick={handleCopy}
          className={cn(
            'p-1.5 rounded-md transition-colors',
            copied
              ? 'bg-emerald-500/20 text-emerald-400'
              : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700'
          )}
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
        </button>
      </div>
    </div>
  );
}
