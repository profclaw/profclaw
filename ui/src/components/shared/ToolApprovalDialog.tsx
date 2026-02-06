/**
 * Tool Approval Dialog
 *
 * Modal for approving/denying tool execution requests.
 * Shows tool details, command, security level, and approval options.
 */

import { useState, useEffect } from 'react';
import {
  Shield,
  ShieldAlert,
  ShieldCheck,
  Terminal,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  FileCode,
  Settings,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

export interface PendingApproval {
  id: string;
  toolName: string;
  params: Record<string, unknown>;
  securityLevel: 'moderate' | 'dangerous';
  command?: string;
  expiresAt?: number;
  createdAt?: number;
}

interface ToolApprovalDialogProps {
  approval: PendingApproval;
  onDecision: (approvalId: string, decision: 'allow-once' | 'allow-always' | 'deny') => void;
  onClose?: () => void;
  isLoading?: boolean;
}

const TOOL_ICONS: Record<string, typeof Terminal> = {
  exec: Terminal,
  read_file: FileCode,
  write_file: FileCode,
  search_files: FileCode,
  grep: FileCode,
  git_status: FileCode,
  git_commit: FileCode,
  git_push: FileCode,
  system_info: Settings,
  default: Terminal,
};

export function ToolApprovalDialog({
  approval,
  onDecision,
  isLoading = false,
}: ToolApprovalDialogProps) {
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null);
  const [selectedDecision, setSelectedDecision] = useState<string | null>(null);

  // Calculate time remaining
  useEffect(() => {
    if (!approval.expiresAt) return;

    const updateTime = () => {
      const remaining = Math.max(0, approval.expiresAt! - Date.now());
      setTimeRemaining(remaining);

      if (remaining === 0) {
        onDecision(approval.id, 'deny');
      }
    };

    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, [approval.expiresAt, approval.id, onDecision]);

  const handleDecision = (decision: 'allow-once' | 'allow-always' | 'deny') => {
    setSelectedDecision(decision);
    onDecision(approval.id, decision);
  };

  const Icon = TOOL_ICONS[approval.toolName] || TOOL_ICONS.default;
  const isDangerous = approval.securityLevel === 'dangerous';

  const formatTimeRemaining = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  const formatParams = (params: Record<string, unknown>) => {
    return Object.entries(params)
      .map(([key, value]) => {
        const strValue = typeof value === 'string' ? value : JSON.stringify(value);
        // Truncate long values
        const displayValue = strValue.length > 100 ? strValue.slice(0, 100) + '...' : strValue;
        return `${key}: ${displayValue}`;
      })
      .join('\n');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-lg mx-4 glass-heavy rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div
          className={cn(
            'px-6 py-4 border-b border-gray-200 dark:border-border flex items-center gap-3',
            isDangerous ? 'bg-red-50 dark:bg-red-500/10' : 'bg-yellow-50 dark:bg-yellow-500/10'
          )}
        >
          {isDangerous ? (
            <ShieldAlert className="h-6 w-6 text-red-500" />
          ) : (
            <Shield className="h-6 w-6 text-yellow-500" />
          )}
          <div className="flex-1">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-foreground">Tool Approval Required</h2>
            <p className="text-sm text-gray-600 dark:text-muted-foreground">
              {isDangerous
                ? 'This tool requires explicit approval'
                : 'Review before executing'}
            </p>
          </div>
          {timeRemaining !== null && (
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Clock className="h-4 w-4" />
              <span className={cn(timeRemaining < 30000 && 'text-red-500 font-medium')}>
                {formatTimeRemaining(timeRemaining)}
              </span>
            </div>
          )}
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          {/* Tool Info */}
          <div className="flex items-start gap-4">
            <div
              className={cn(
                'p-3 rounded-lg',
                isDangerous ? 'bg-red-100 dark:bg-red-500/10' : 'bg-yellow-100 dark:bg-yellow-500/10'
              )}
            >
              <Icon
                className={cn(
                  'h-6 w-6',
                  isDangerous ? 'text-red-500' : 'text-yellow-500'
                )}
              />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-gray-900 dark:text-foreground">{approval.toolName}</h3>
                <span
                  className={cn(
                    'px-2 py-0.5 text-xs font-medium rounded-full',
                    isDangerous
                      ? 'bg-red-100 dark:bg-red-500/20 text-red-600 dark:text-red-500'
                      : 'bg-yellow-100 dark:bg-yellow-500/20 text-yellow-700 dark:text-yellow-400'
                  )}
                >
                  {approval.securityLevel}
                </span>
              </div>
              <p className="text-sm text-gray-600 dark:text-muted-foreground mt-1">
                {isDangerous
                  ? 'This tool can modify files, execute commands, or access sensitive data.'
                  : 'This tool may access files or execute commands.'}
              </p>
            </div>
          </div>

          {/* Command/Params */}
          {(approval.command || Object.keys(approval.params).length > 0) && (
            <div className="bg-gray-100 dark:bg-muted/50 rounded-lg p-4 border border-gray-200 dark:border-border">
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                {approval.command ? 'Command' : 'Parameters'}
              </div>
              <pre className="text-sm font-mono whitespace-pre-wrap break-all text-gray-800 dark:text-foreground">
                {approval.command || formatParams(approval.params)}
              </pre>
            </div>
          )}

          {/* Warning */}
          {isDangerous && (
            <div className="flex items-start gap-3 p-3 bg-red-50 dark:bg-red-500/10 rounded-lg border border-red-200 dark:border-red-500/20">
              <AlertTriangle className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-medium text-red-600 dark:text-red-500">Security Warning</p>
                <p className="text-gray-600 dark:text-muted-foreground mt-1">
                  This operation could potentially harm your system or expose
                  sensitive data. Only approve if you trust the source.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="px-6 py-4 bg-gray-50 dark:bg-muted/30 border-t border-gray-200 dark:border-border flex items-center justify-between gap-3">
          <Button
            variant="ghost"
            onClick={() => handleDecision('deny')}
            disabled={isLoading}
            className="text-red-600 dark:text-red-500 hover:text-red-700 dark:hover:text-red-600 hover:bg-red-100 dark:hover:bg-red-500/10"
          >
            <XCircle className="h-4 w-4 mr-2" />
            Deny
          </Button>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => handleDecision('allow-always')}
              disabled={isLoading}
              className="border-green-300 dark:border-green-500/30 hover:bg-green-100 dark:hover:bg-green-500/10 text-green-700 dark:text-foreground"
            >
              <ShieldCheck className="h-4 w-4 mr-2 text-green-600 dark:text-green-500" />
              Allow Always
            </Button>
            <Button
              onClick={() => handleDecision('allow-once')}
              disabled={isLoading}
              className={cn(
                isDangerous
                  ? 'bg-red-500 hover:bg-red-600 text-white'
                  : 'bg-yellow-500 hover:bg-yellow-600 text-gray-900'
              )}
            >
              {isLoading && selectedDecision === 'allow-once' ? (
                <span className="animate-pulse">Processing...</span>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  Allow Once
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Hook for managing tool approvals in a component
 */
export function useToolApprovals() {
  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);

  const addApproval = (approval: PendingApproval) => {
    setPendingApprovals((prev) => {
      // Don't add duplicates
      if (prev.some((a) => a.id === approval.id)) return prev;
      return [...prev, approval];
    });
  };

  const removeApproval = (approvalId: string) => {
    setPendingApprovals((prev) => prev.filter((a) => a.id !== approvalId));
  };

  const handleDecision = async (
    approvalId: string,
    decision: 'allow-once' | 'allow-always' | 'deny',
    conversationId: string
  ) => {
    setIsProcessing(true);
    try {
      const response = await fetch('http://localhost:3000/api/chat/tools/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId,
          approvalId,
          decision,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to process approval');
      }

      const result = await response.json();
      removeApproval(approvalId);
      return result;
    } finally {
      setIsProcessing(false);
    }
  };

  return {
    pendingApprovals,
    addApproval,
    removeApproval,
    handleDecision,
    isProcessing,
  };
}

export default ToolApprovalDialog;
