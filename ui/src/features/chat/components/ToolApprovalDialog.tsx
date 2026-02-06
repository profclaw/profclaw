/**
 * Tool Approval Dialog
 *
 * Displays pending tool execution requests that require user approval.
 * Shows tool details, security level, and countdown timer.
 */

import { useState, useEffect, useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Shield,
  ShieldAlert,
  ShieldCheck,
  Terminal,
  Clock,
  X,
  Check,
  CheckCheck,
  AlertTriangle,
  Loader2,
  FileCode,
  Globe,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// Types
export interface PendingApproval {
  id: string;
  toolName: string;
  command?: string;
  params: Record<string, unknown>;
  securityLevel: 'moderate' | 'dangerous';
  createdAt: number;
  expiresAt: number;
  conversationId: string;
}

interface ToolApprovalDialogProps {
  approvals: PendingApproval[];
  onApprovalHandled: () => void;
}

type ApprovalDecision = 'allow-once' | 'allow-always' | 'deny';

export function ToolApprovalDialog({ approvals, onApprovalHandled }: ToolApprovalDialogProps) {
  const queryClient = useQueryClient();
  const [currentIndex] = useState(0);
  const [countdown, setCountdown] = useState(0);
  const [processingDecision, setProcessingDecision] = useState<ApprovalDecision | null>(null);

  const currentApproval = approvals[currentIndex];

  // Handle approval mutation
  const handleApproval = useMutation({
    mutationFn: async ({ approvalId, decision }: { approvalId: string; decision: ApprovalDecision }) => {
      const res = await fetch('http://localhost:3000/api/tools/approval', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approvalId, decision }),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({ error: 'Failed' }));
        throw new Error(error.error || 'Failed to process approval');
      }
      return res.json();
    },
    onSuccess: (_data, { decision }) => {
      const messages = {
        'allow-once': 'Tool execution approved',
        'allow-always': 'Tool approved and added to allowlist',
        'deny': 'Tool execution denied',
      };
      toast.success(messages[decision]);
      queryClient.invalidateQueries({ queryKey: ['tools', 'security'] });
      onApprovalHandled();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to process approval');
    },
    onSettled: () => {
      setProcessingDecision(null);
    },
  });

  // Calculate countdown
  useEffect(() => {
    if (!currentApproval) return;

    const updateCountdown = () => {
      const remaining = Math.max(0, Math.floor((currentApproval.expiresAt - Date.now()) / 1000));
      setCountdown(remaining);

      // Auto-deny when expired
      if (remaining === 0) {
        handleApproval.mutate({ approvalId: currentApproval.id, decision: 'deny' });
      }
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [currentApproval]);

  // Handle decision
  const handleDecision = useCallback((decision: ApprovalDecision) => {
    if (!currentApproval || processingDecision) return;
    setProcessingDecision(decision);
    handleApproval.mutate({ approvalId: currentApproval.id, decision });
  }, [currentApproval, processingDecision, handleApproval]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!currentApproval || processingDecision) return;

      if (e.key === 'Enter' || e.key === 'y') {
        e.preventDefault();
        handleDecision('allow-once');
      } else if (e.key === 'n' || e.key === 'Escape') {
        e.preventDefault();
        handleDecision('deny');
      } else if (e.key === 'a' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleDecision('allow-always');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentApproval, processingDecision, handleDecision]);

  if (!currentApproval) return null;

  const isDangerous = currentApproval.securityLevel === 'dangerous';
  const isExpiringSoon = countdown <= 10;

  // Get tool icon based on name
  const getToolIcon = () => {
    const name = currentApproval.toolName.toLowerCase();
    if (name.includes('exec') || name.includes('command')) return Terminal;
    if (name.includes('file') || name.includes('read') || name.includes('write')) return FileCode;
    if (name.includes('fetch') || name.includes('web') || name.includes('http')) return Globe;
    return Shield;
  };

  const ToolIcon = getToolIcon();

  // Format command/params for display
  const displayContent = currentApproval.command
    || JSON.stringify(currentApproval.params, null, 2);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className={cn(
        'w-full max-w-lg rounded-2xl overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200',
        isDangerous ? 'bg-gradient-to-b from-red-500/10 to-background border border-red-500/30'
                    : 'bg-gradient-to-b from-amber-500/10 to-background border border-amber-500/30'
      )}>
        {/* Header */}
        <div className={cn(
          'px-6 py-4 flex items-center gap-4',
          isDangerous ? 'bg-red-500/5' : 'bg-amber-500/5'
        )}>
          <div className={cn(
            'h-12 w-12 rounded-xl flex items-center justify-center',
            isDangerous ? 'bg-red-500/20' : 'bg-amber-500/20'
          )}>
            {isDangerous ? (
              <ShieldAlert className={cn('h-6 w-6', isDangerous ? 'text-red-500' : 'text-amber-500')} />
            ) : (
              <ShieldCheck className="h-6 w-6 text-amber-500" />
            )}
          </div>
          <div className="flex-1">
            <h3 className="font-bold text-lg">Tool Approval Required</h3>
            <p className="text-sm text-muted-foreground">
              {isDangerous ? 'This action requires careful review' : 'Review and approve this action'}
            </p>
          </div>
          {/* Countdown Timer */}
          <div className={cn(
            'flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-mono',
            isExpiringSoon
              ? 'bg-red-500/20 text-red-400 animate-pulse'
              : 'bg-muted text-muted-foreground'
          )}>
            <Clock className="h-4 w-4" />
            <span>{countdown}s</span>
          </div>
        </div>

        {/* Content */}
        <div className="px-6 py-4 space-y-4">
          {/* Tool Info */}
          <div className="flex items-center gap-3 p-4 rounded-xl bg-muted/50 border border-border">
            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <ToolIcon className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium">{currentApproval.toolName}</p>
              <p className="text-xs text-muted-foreground">
                Security Level: <span className={cn(
                  'font-semibold',
                  isDangerous ? 'text-red-400' : 'text-amber-400'
                )}>{currentApproval.securityLevel}</span>
              </p>
            </div>
            <span className={cn(
              'px-2 py-1 rounded-full text-xs font-medium',
              isDangerous ? 'bg-red-500/20 text-red-400' : 'bg-amber-500/20 text-amber-400'
            )}>
              {isDangerous ? 'Dangerous' : 'Moderate'}
            </span>
          </div>

          {/* Command/Params Display */}
          <div className="rounded-xl overflow-hidden border border-border">
            <div className="bg-muted/50 px-4 py-2 flex items-center justify-between border-b border-border">
              <span className="text-xs font-medium text-muted-foreground">
                {currentApproval.command ? 'Command' : 'Parameters'}
              </span>
              <span className="premium-label">
                Review Carefully
              </span>
            </div>
            <pre className="bg-zinc-950 dark:bg-zinc-900 p-4 overflow-x-auto max-h-48 overflow-y-auto">
              <code className="text-sm font-mono text-zinc-300 whitespace-pre-wrap break-all">
                {displayContent}
              </code>
            </pre>
          </div>

          {/* Warning for dangerous actions */}
          {isDangerous && (
            <div className="flex items-start gap-3 p-3 rounded-xl bg-red-500/10 border border-red-500/20">
              <AlertTriangle className="h-5 w-5 text-red-400 shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-medium text-red-400">Security Warning</p>
                <p className="text-muted-foreground text-xs mt-0.5">
                  This tool has elevated privileges. Only approve if you trust the source and understand the consequences.
                </p>
              </div>
            </div>
          )}

          {/* Approval count indicator */}
          {approvals.length > 1 && (
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <span>{currentIndex + 1} of {approvals.length} pending approvals</span>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="px-6 py-4 bg-muted/30 border-t border-border">
          <div className="flex items-center gap-3">
            {/* Deny */}
            <Button
              variant="outline"
              onClick={() => handleDecision('deny')}
              disabled={!!processingDecision}
              className="flex-1 rounded-xl border-red-500/30 text-red-400 hover:bg-red-500/10 hover:text-red-400"
            >
              {processingDecision === 'deny' ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <X className="h-4 w-4 mr-2" />
              )}
              Deny
              <kbd className="ml-2 text-[10px] opacity-60 hidden sm:inline">N</kbd>
            </Button>

            {/* Allow Once */}
            <Button
              onClick={() => handleDecision('allow-once')}
              disabled={!!processingDecision}
              className={cn(
                'flex-1 rounded-xl',
                isDangerous
                  ? 'bg-amber-500 hover:bg-amber-600 text-white'
                  : 'bg-green-500 hover:bg-green-600 text-white'
              )}
            >
              {processingDecision === 'allow-once' ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Check className="h-4 w-4 mr-2" />
              )}
              Allow Once
              <kbd className="ml-2 text-[10px] opacity-60 hidden sm:inline">Y</kbd>
            </Button>

            {/* Allow Always */}
            <Button
              variant="outline"
              onClick={() => handleDecision('allow-always')}
              disabled={!!processingDecision}
              className="flex-1 rounded-xl border-green-500/30 text-green-400 hover:bg-green-500/10 hover:text-green-400"
            >
              {processingDecision === 'allow-always' ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <CheckCheck className="h-4 w-4 mr-2" />
              )}
              Always
              <kbd className="ml-2 text-[10px] opacity-60 hidden sm:inline">⌘A</kbd>
            </Button>
          </div>

          {/* Keyboard hints */}
          <p className="text-[10px] text-center text-muted-foreground mt-3">
            Press <kbd className="px-1 py-0.5 bg-muted rounded text-xs">Y</kbd> to allow,{' '}
            <kbd className="px-1 py-0.5 bg-muted rounded text-xs">N</kbd> to deny,{' '}
            <kbd className="px-1 py-0.5 bg-muted rounded text-xs">⌘A</kbd> to always allow
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * Compact inline approval prompt for message stream
 */
export function InlineApprovalPrompt({
  approval,
  onDecision,
  isProcessing,
}: {
  approval: PendingApproval;
  onDecision: (decision: ApprovalDecision) => void;
  isProcessing: boolean;
}) {
  const [countdown, setCountdown] = useState(0);

  useEffect(() => {
    const updateCountdown = () => {
      const remaining = Math.max(0, Math.floor((approval.expiresAt - Date.now()) / 1000));
      setCountdown(remaining);
      if (remaining === 0) {
        onDecision('deny');
      }
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [approval, onDecision]);

  const isDangerous = approval.securityLevel === 'dangerous';

  return (
    <div className={cn(
      'rounded-xl p-4 border',
      isDangerous ? 'bg-red-500/5 border-red-500/20' : 'bg-amber-500/5 border-amber-500/20'
    )}>
      <div className="flex items-start gap-3">
        <div className={cn(
          'h-8 w-8 rounded-lg flex items-center justify-center shrink-0',
          isDangerous ? 'bg-red-500/20' : 'bg-amber-500/20'
        )}>
          <ShieldAlert className={cn('h-4 w-4', isDangerous ? 'text-red-500' : 'text-amber-500')} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <p className="text-sm font-medium">Approval Required: {approval.toolName}</p>
            <span className={cn(
              'px-1.5 py-0.5 rounded text-[10px] font-medium',
              isDangerous ? 'bg-red-500/20 text-red-400' : 'bg-amber-500/20 text-amber-400'
            )}>
              {countdown}s
            </span>
          </div>
          {approval.command && (
            <code className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded block truncate">
              {approval.command}
            </code>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 mt-3">
        <Button
          size="sm"
          variant="outline"
          onClick={() => onDecision('deny')}
          disabled={isProcessing}
          className="h-7 text-xs border-red-500/30 text-red-400 hover:bg-red-500/10"
        >
          <X className="h-3 w-3 mr-1" />
          Deny
        </Button>
        <Button
          size="sm"
          onClick={() => onDecision('allow-once')}
          disabled={isProcessing}
          className={cn(
            'h-7 text-xs',
            isDangerous
              ? 'bg-amber-500 hover:bg-amber-600'
              : 'bg-green-500 hover:bg-green-600'
          )}
        >
          {isProcessing ? (
            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
          ) : (
            <Check className="h-3 w-3 mr-1" />
          )}
          Allow
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => onDecision('allow-always')}
          disabled={isProcessing}
          className="h-7 text-xs border-green-500/30 text-green-400 hover:bg-green-500/10"
        >
          <CheckCheck className="h-3 w-3 mr-1" />
          Always
        </Button>
      </div>
    </div>
  );
}
