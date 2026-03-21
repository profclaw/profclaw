/**
 * Natural Language Automation Input
 *
 * "Every morning at 8am summarize my GitHub notifications and send to Telegram"
 * Parses natural language into cron jobs with preview before creating.
 */

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Card } from '@/components/ui/card';
import { Sparkles, Play, Eye, Clock, Send, Loader2 } from 'lucide-react';
import { request } from '@/core/api/domains/base';

interface ParsedResult {
  success: boolean;
  parsed?: {
    schedule?: string;
    humanReadable?: string;
    cronExpression?: string;
    cronExplained?: string;
  };
  intent?: { action: string };
  delivery?: { channel: string; target: string };
  jobParams?: Record<string, unknown>;
  message?: string;
  error?: string;
  hint?: string;
}

export function NaturalLanguageInput() {
  const [input, setInput] = useState('');
  const [preview, setPreview] = useState<ParsedResult | null>(null);
  const queryClient = useQueryClient();

  const previewMutation = useMutation({
    mutationFn: (text: string) =>
      request<ParsedResult>('/cron/automate?dryRun=true', {
        method: 'POST',
        body: JSON.stringify({ input: text }),
      }),
    onSuccess: (data) => setPreview(data),
  });

  const createMutation = useMutation({
    mutationFn: (text: string) =>
      request<ParsedResult & { job?: Record<string, unknown> }>('/cron/automate', {
        method: 'POST',
        body: JSON.stringify({ input: text }),
      }),
    onSuccess: () => {
      setInput('');
      setPreview(null);
      queryClient.invalidateQueries({ queryKey: ['cron'] });
    },
  });

  const handlePreview = () => {
    if (input.trim().length < 5) return;
    previewMutation.mutate(input);
  };

  const handleCreate = () => {
    if (input.trim().length < 5) return;
    createMutation.mutate(input);
  };

  const examples = [
    'every morning at 8am summarize GitHub notifications',
    'daily at 9am send AI news digest to telegram',
    'every friday at 5pm send sprint report to slack',
    'check server health every 30 minutes',
    'nightly at 2am clean up old logs',
  ];

  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-3">
        <Sparkles className="h-4 w-4 text-primary" />
        <h3 className="font-medium text-sm">Quick Automate</h3>
      </div>

      {/* Input */}
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setPreview(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handlePreview();
          }}
          placeholder="e.g., every morning at 8am send AI news digest to telegram"
          className="flex-1 px-3 py-2 text-sm rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-primary/50"
        />
        <button
          onClick={handlePreview}
          disabled={input.trim().length < 5 || previewMutation.isPending}
          className="px-3 py-2 text-sm rounded-lg bg-muted hover:bg-muted/80 disabled:opacity-50 flex items-center gap-1.5"
        >
          {previewMutation.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Eye className="h-3.5 w-3.5" />
          )}
          Preview
        </button>
        <button
          onClick={handleCreate}
          disabled={!preview?.success || createMutation.isPending}
          className="px-3 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1.5"
        >
          {createMutation.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Play className="h-3.5 w-3.5" />
          )}
          Create
        </button>
      </div>

      {/* Preview result */}
      {preview && (
        <div className={`mt-3 p-3 rounded-lg text-sm ${
          preview.success
            ? 'bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800'
            : 'bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800'
        }`}>
          {preview.success ? (
            <div className="space-y-1.5">
              <div className="font-medium text-emerald-800 dark:text-emerald-200">
                {preview.message}
              </div>
              {preview.parsed?.cronExpression && (
                <div className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400">
                  <Clock className="h-3 w-3" />
                  <span>{preview.parsed.cronExplained ?? preview.parsed.cronExpression}</span>
                </div>
              )}
              {preview.delivery && (
                <div className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400">
                  <Send className="h-3 w-3" />
                  <span>Deliver to {preview.delivery.channel} ({preview.delivery.target})</span>
                </div>
              )}
            </div>
          ) : (
            <div>
              <div className="font-medium text-red-800 dark:text-red-200">{preview.error}</div>
              {preview.hint && (
                <div className="text-xs text-red-600 dark:text-red-400 mt-1">{preview.hint}</div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Success message */}
      {createMutation.isSuccess && (
        <div className="mt-3 p-3 rounded-lg bg-emerald-100 dark:bg-emerald-900/30 text-sm text-emerald-800 dark:text-emerald-200">
          Automation created successfully!
        </div>
      )}

      {/* Examples */}
      {!input && !preview && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {examples.map((ex, i) => (
            <button
              key={i}
              onClick={() => {
                setInput(ex);
                setPreview(null);
              }}
              className="px-2 py-1 text-xs rounded-full bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            >
              {ex}
            </button>
          ))}
        </div>
      )}
    </Card>
  );
}
