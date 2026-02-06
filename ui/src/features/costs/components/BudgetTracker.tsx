/**
 * Budget Tracker Component
 *
 * Shows budget progress with visual indicator
 */

import { Card } from '@/components/ui/card';
import { AlertTriangle, CheckCircle, TrendingUp } from 'lucide-react';

interface BudgetTrackerProps {
  budget: {
    limit: number;
    spent: number;
    remaining: number;
    percentage: number;
  };
}

export function BudgetTracker({ budget }: BudgetTrackerProps) {
  // Safe defaults for all values
  const limit = budget?.limit ?? 0;
  const spent = budget?.spent ?? 0;
  const remaining = budget?.remaining ?? 0;
  const percentage = budget?.percentage ?? 0;

  const getStatusColor = () => {
    if (percentage >= 100) return 'text-red-500';
    if (percentage >= 80) return 'text-orange-500';
    if (percentage >= 50) return 'text-yellow-500';
    return 'text-green-500';
  };

  const getProgressColor = () => {
    if (percentage >= 100) return 'bg-red-500';
    if (percentage >= 80) return 'bg-orange-500';
    if (percentage >= 50) return 'bg-yellow-500';
    return 'bg-green-500';
  };

  const getStatusIcon = () => {
    if (percentage >= 100) return AlertTriangle;
    if (percentage >= 80) return AlertTriangle;
    return CheckCircle;
  };

  const StatusIcon = getStatusIcon();
  const statusColor = getStatusColor();
  const progressColor = getProgressColor();

  return (
    <Card className="glass p-6 rounded-2xl">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-primary" />
            Budget Tracker
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            Current spending vs budget limit
          </p>
        </div>
        <div className={`p-2 rounded-lg bg-muted/50 ${statusColor}`}>
          <StatusIcon className="w-5 h-5" />
        </div>
      </div>

      {/* Budget Stats */}
      <div className="grid grid-cols-3 gap-4 mb-4">
        <div>
          <p className="text-xs text-muted-foreground mb-1">Budget Limit</p>
          <p className="text-lg font-bold text-foreground">
            ${limit.toFixed(2)}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground mb-1">Spent</p>
          <p className={`text-lg font-bold ${statusColor}`}>
            ${spent.toFixed(2)}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground mb-1">Remaining</p>
          <p className="text-lg font-bold text-foreground">
            ${remaining.toFixed(2)}
          </p>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Usage</span>
          <span className={`font-semibold ${statusColor}`}>
            {percentage.toFixed(1)}%
          </span>
        </div>
        <div className="w-full h-3 bg-muted rounded-full overflow-hidden">
          <div
            className={`h-full ${progressColor} transition-all duration-500 ease-out rounded-full`}
            style={{
              width: `${Math.min(percentage, 100)}%`,
            }}
          />
        </div>
      </div>

      {/* Warning Messages */}
      {percentage >= 100 && (
        <div className="mt-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20">
          <p className="text-sm text-red-500 font-medium flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" />
            Budget exceeded! Consider increasing the limit or pausing tasks.
          </p>
        </div>
      )}
      {percentage >= 80 && percentage < 100 && (
        <div className="mt-4 p-3 rounded-xl bg-orange-500/10 border border-orange-500/20">
          <p className="text-sm text-orange-500 font-medium flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" />
            Approaching budget limit. {percentage.toFixed(0)}% used.
          </p>
        </div>
      )}
    </Card>
  );
}
