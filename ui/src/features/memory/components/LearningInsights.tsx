/**
 * Learning Insights Component
 *
 * Shows what profClaw has learned across conversations.
 * "Your agent at month 6 is measurably better than at month 1."
 */

import { useQuery } from '@tanstack/react-query';
import { api } from '@/core/api/client';
import { Card } from '@/components/ui/card';
import { Brain, TrendingUp, Workflow, Star, ArrowRight } from 'lucide-react';

export function LearningInsights() {
  const { data, isLoading } = useQuery({
    queryKey: ['memory', 'insights'],
    queryFn: api.memory.insights,
    refetchInterval: 60000,
  });

  if (isLoading) {
    return (
      <Card className="p-6 animate-pulse">
        <div className="h-6 w-32 bg-muted rounded mb-4" />
        <div className="h-4 w-64 bg-muted rounded mb-2" />
        <div className="h-4 w-48 bg-muted rounded" />
      </Card>
    );
  }

  const insights = data?.data;
  if (!insights) return null;

  return (
    <div className="space-y-4">
      {/* Summary Card */}
      <Card className="p-6 bg-gradient-to-br from-violet-50 to-indigo-50 dark:from-violet-950/20 dark:to-indigo-950/20 border-violet-200 dark:border-violet-800">
        <div className="flex items-start gap-3">
          <Brain className="h-6 w-6 text-violet-600 dark:text-violet-400 shrink-0 mt-0.5" />
          <div>
            <h3 className="font-semibold text-violet-900 dark:text-violet-100 mb-1">Learning Progress</h3>
            <p className="text-sm text-violet-700 dark:text-violet-300">{insights.summary}</p>
          </div>
        </div>

        {/* Stats row */}
        <div className="mt-4 grid grid-cols-3 gap-3">
          <div className="text-center p-2 rounded-lg bg-white/60 dark:bg-black/20">
            <div className="text-lg font-bold text-violet-700 dark:text-violet-300">
              {insights.stats.total}
            </div>
            <div className="text-xs text-violet-600 dark:text-violet-400">Experiences</div>
          </div>
          <div className="text-center p-2 rounded-lg bg-white/60 dark:bg-black/20">
            <div className="text-lg font-bold text-violet-700 dark:text-violet-300">
              {insights.learningRate}
            </div>
            <div className="text-xs text-violet-600 dark:text-violet-400">Learning Rate</div>
          </div>
          <div className="text-center p-2 rounded-lg bg-white/60 dark:bg-black/20">
            <div className="text-lg font-bold text-violet-700 dark:text-violet-300">
              {Object.keys(insights.stats.byType).length}
            </div>
            <div className="text-xs text-violet-600 dark:text-violet-400">Categories</div>
          </div>
        </div>
      </Card>

      {/* Top Tool Chains */}
      {insights.topToolChains.length > 0 && (
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <Workflow className="h-4 w-4 text-blue-500" />
            <h4 className="font-medium text-sm">Learned Tool Chains</h4>
          </div>
          <div className="space-y-2">
            {insights.topToolChains.map((chain, i) => (
              <div key={i} className="flex items-center gap-2 p-2 rounded-lg bg-muted/50 text-sm">
                <div className="flex-1">
                  <div className="flex items-center gap-1 flex-wrap">
                    {chain.tools.map((tool, j) => (
                      <span key={j} className="flex items-center gap-1">
                        <span className="px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200 text-xs font-mono">
                          {tool}
                        </span>
                        {j < chain.tools.length - 1 && (
                          <ArrowRight className="h-3 w-3 text-muted-foreground" />
                        )}
                      </span>
                    ))}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1 truncate">
                    {chain.intent}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Star className="h-3 w-3 text-amber-500" />
                  <span className="text-xs font-medium">{chain.useCount}x</span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Experience Type Breakdown */}
      {Object.keys(insights.stats.byType).length > 0 && (
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="h-4 w-4 text-emerald-500" />
            <h4 className="font-medium text-sm">Experience Breakdown</h4>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(insights.stats.byType).map(([type, count]) => {
              const labels: Record<string, string> = {
                tool_chain: 'Tool Chains',
                user_preference: 'Preferences',
                task_solution: 'Solutions',
                error_recovery: 'Error Fixes',
              };
              return (
                <div key={type} className="flex items-center justify-between p-2 rounded-lg bg-muted/30">
                  <span className="text-xs capitalize">{labels[type] ?? type}</span>
                  <span className="text-sm font-semibold">{count}</span>
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}
