/**
 * Cost Analytics Dashboard
 *
 * Shows token costs, budget tracking, and analytics
 * Uses Recharts for visualizations
 */

import { useQuery } from '@tanstack/react-query';
import { api } from '@/core/api/client';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { DollarSign, Activity } from 'lucide-react';
import { CostStatsCards } from '../components/CostStatsCards';
import { DailyCostsChart } from '../components/DailyCostsChart';
import { CostsByAgentChart } from '../components/CostsByAgentChart';
import { BudgetTracker } from '../components/BudgetTracker';
import { SmartRoutingSavings } from '../components/SmartRoutingSavings';

export function CostsDashboard() {
  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ['costs', 'summary'],
    queryFn: api.costs.summary,
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  const { data: analytics, isLoading: analyticsLoading } = useQuery({
    queryKey: ['costs', 'analytics'],
    queryFn: api.costs.analytics,
    refetchInterval: 30000,
  });

  const { data: budget, isLoading: budgetLoading } = useQuery({
    queryKey: ['costs', 'budget'],
    queryFn: api.costs.budget,
    refetchInterval: 30000,
  });

  const isLoading = summaryLoading || analyticsLoading || budgetLoading;

  if (isLoading) {
    return (
      <div className="space-y-6 p-6">
        <div>
          <Skeleton className="h-8 w-48 mb-2" />
          <Skeleton className="h-4 w-64" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-32 rounded-2xl" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Skeleton className="h-80 rounded-2xl" />
          <Skeleton className="h-80 rounded-2xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-foreground mb-2">
          Cost Analytics
        </h1>
        <p className="text-sm text-muted-foreground">
          Track token usage, costs, and budget across all AI agents
        </p>
      </div>

      {/* Stats Cards */}
      {summary && (
        <CostStatsCards summary={summary} analytics={analytics} />
      )}

      {/* Smart Routing Savings */}
      <SmartRoutingSavings />

      {/* Budget Tracker */}
      {budget && (
        <BudgetTracker budget={budget} />
      )}

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Daily Costs Chart */}
        {analytics && analytics.daily.length > 0 && (
          <DailyCostsChart data={analytics.daily} />
        )}

        {/* Costs by Agent Chart */}
        {analytics && Object.keys(analytics.byAgent).length > 0 && (
          <CostsByAgentChart data={analytics.byAgent} />
        )}
      </div>

      {/* Costs by Model */}
      {analytics && Object.keys(analytics.byModel).length > 0 && (
        <Card className="glass p-6 rounded-2xl">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Activity className="w-5 h-5 text-primary" />
            Costs by Model
          </h3>
          <div className="space-y-3">
            {Object.entries(analytics.byModel)
              .sort(([, a], [, b]) => b.cost - a.cost)
              .map(([model, data]) => (
                <div
                  key={model}
                  className="flex items-center justify-between p-3 rounded-xl bg-muted/50 hover:bg-muted/70 transition-liquid"
                >
                  <div>
                    <div className="font-medium text-sm">{model}</div>
                    <div className="text-xs text-muted-foreground">
                      {data.tokens.toLocaleString()} tokens
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold text-primary">
                      ${data.cost.toFixed(4)}
                    </div>
                  </div>
                </div>
              ))}
          </div>
        </Card>
      )}

      {/* Empty State */}
      {(!analytics || analytics.daily.length === 0) && (
        <Card className="glass p-12 rounded-2xl text-center">
          <DollarSign className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-50" />
          <h3 className="text-lg font-semibold mb-2">No Cost Data Yet</h3>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Cost analytics will appear here once AI agents start processing tasks.
            Create a task to get started!
          </p>
        </Card>
      )}
    </div>
  );
}
