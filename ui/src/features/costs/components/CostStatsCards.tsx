/**
 * Cost Statistics Cards Component
 *
 * Displays key cost metrics in card format
 */

import { Card } from '@/components/ui/card';
import { DollarSign, Zap, TrendingUp, Activity } from 'lucide-react';

interface CostStatsCardsProps {
  summary: {
    totalTokens: number;
    inputTokens: number;
    outputTokens: number;
    totalCost: number;
    taskCount: number;
  };
  analytics?: {
    totalCost: number;
    totalTokens: number;
    daily: Array<{ date: string; cost: number; tokens: number }>;
  } | null;
}

export function CostStatsCards({ summary, analytics }: CostStatsCardsProps) {
  // Calculate average cost per task
  const avgCostPerTask = summary.taskCount > 0
    ? summary.totalCost / summary.taskCount
    : 0;

  // Calculate projected monthly cost (based on last 7 days)
  const projectedMonthlyCost = analytics && analytics.daily.length > 0
    ? (analytics.daily.slice(-7).reduce((sum, day) => sum + day.cost, 0) / 7) * 30
    : summary.totalCost * 30;

  const stats = [
    {
      label: 'Total Spend',
      value: `$${summary.totalCost.toFixed(4)}`,
      icon: DollarSign,
      subtext: `${summary.taskCount} tasks`,
      color: 'text-green-500',
    },
    {
      label: 'Total Tokens',
      value: summary.totalTokens.toLocaleString(),
      icon: Zap,
      subtext: `${summary.inputTokens.toLocaleString()} in / ${summary.outputTokens.toLocaleString()} out`,
      color: 'text-blue-500',
    },
    {
      label: 'Avg Cost/Task',
      value: `$${avgCostPerTask.toFixed(4)}`,
      icon: Activity,
      subtext: summary.taskCount > 0 ? 'Per task average' : 'No tasks yet',
      color: 'text-indigo-500',
    },
    {
      label: 'Projected Monthly',
      value: `$${projectedMonthlyCost.toFixed(2)}`,
      icon: TrendingUp,
      subtext: 'Based on recent usage',
      color: 'text-orange-500',
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {stats.map((stat) => (
        <Card
          key={stat.label}
          className="glass p-6 rounded-2xl hover-lift transition-liquid"
        >
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <p className="text-sm text-muted-foreground mb-1">
                {stat.label}
              </p>
              <p className="text-2xl font-bold text-foreground mb-1">
                {stat.value}
              </p>
              <p className="text-xs text-muted-foreground">
                {stat.subtext}
              </p>
            </div>
            <div className={`p-3 rounded-xl bg-muted/50 ${stat.color}`}>
              <stat.icon className="w-5 h-5" />
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
