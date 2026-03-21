/**
 * Smart Routing Savings Card
 *
 * Shows how much the smart router has saved the user.
 * The #1 marketing-as-product component.
 */

import { useQuery } from '@tanstack/react-query';
import { api } from '@/core/api/client';
import { Card } from '@/components/ui/card';
import { Sparkles, TrendingDown, ExternalLink } from 'lucide-react';

export function SmartRoutingSavings() {
  const { data: routing } = useQuery({
    queryKey: ['costs', 'routing'],
    queryFn: api.costs.routing,
    refetchInterval: 30000,
  });

  const { data: optimize } = useQuery({
    queryKey: ['costs', 'optimize'],
    queryFn: api.costs.optimize,
    refetchInterval: 60000,
  });

  const stats = routing?.data;
  const advice = optimize?.data;

  return (
    <div className="space-y-4">
      {/* Main savings card */}
      <Card className="p-6 bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-950/30 dark:to-teal-950/30 border-emerald-200 dark:border-emerald-800">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Sparkles className="h-5 w-5 text-emerald-600" />
              <h3 className="font-semibold text-emerald-900 dark:text-emerald-100">Smart Routing</h3>
            </div>
            <p className="text-sm text-emerald-700 dark:text-emerald-300">
              {stats?.message ?? 'Smart routing automatically picks the cheapest model for each query.'}
            </p>
          </div>
          {stats && stats.totalRouted > 0 && (
            <div className="text-right">
              <div className="text-2xl font-bold text-emerald-700 dark:text-emerald-300">
                {stats.totalSaved}
              </div>
              <div className="text-xs text-emerald-600 dark:text-emerald-400">
                saved ({stats.avgSavingsPercent} avg)
              </div>
            </div>
          )}
        </div>

        {/* Tier breakdown */}
        {stats && stats.totalRouted > 0 && (
          <div className="mt-4 grid grid-cols-3 gap-3">
            {(['trivial', 'standard', 'complex'] as const).map((tier) => {
              const count = stats.byTier[tier] ?? 0;
              const percent = stats.totalRouted > 0
                ? Math.round((count / stats.totalRouted) * 100)
                : 0;
              const colors = {
                trivial: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
                standard: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
                complex: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300',
              };
              return (
                <div key={tier} className={`rounded-lg p-2 text-center ${colors[tier]}`}>
                  <div className="text-lg font-semibold">{percent}%</div>
                  <div className="text-xs capitalize">{tier}</div>
                  <div className="text-xs opacity-70">{count} queries</div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Provider recommendations */}
      {advice && advice.recommendations.length > 0 && !advice.optimalSetup && (
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <TrendingDown className="h-4 w-4 text-amber-500" />
            <h4 className="font-medium text-sm">Cost Optimization Tips</h4>
          </div>
          <div className="space-y-2">
            {advice.recommendations.slice(0, 3).map((rec, i) => (
              <div
                key={i}
                className={`flex items-start gap-2 p-2 rounded-lg text-sm ${
                  rec.priority === 'high'
                    ? 'bg-amber-50 dark:bg-amber-950/20'
                    : 'bg-neutral-50 dark:bg-neutral-900/30'
                }`}
              >
                <span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ${
                  rec.priority === 'high' ? 'bg-amber-200 text-amber-800' :
                  rec.priority === 'medium' ? 'bg-blue-200 text-blue-800' :
                  'bg-neutral-200 text-neutral-700'
                }`}>
                  {rec.priority}
                </span>
                <div className="flex-1">
                  <div className="font-medium">{rec.action}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{rec.reason}</div>
                  <div className="text-xs text-emerald-600 dark:text-emerald-400 mt-0.5">
                    Est. savings: {rec.estimatedMonthlySavings}
                  </div>
                </div>
                {rec.signupUrl && (
                  <a
                    href={rec.signupUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 p-1 hover:bg-neutral-200 dark:hover:bg-neutral-700 rounded"
                  >
                    <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                  </a>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Optimal setup badge */}
      {advice?.optimalSetup && (
        <div className="flex items-center gap-2 px-3 py-2 bg-emerald-50 dark:bg-emerald-950/20 rounded-lg text-sm text-emerald-700 dark:text-emerald-300">
          <Sparkles className="h-4 w-4" />
          Your provider setup is cost-optimal
        </div>
      )}
    </div>
  );
}
