/**
 * Burndown Chart Component
 *
 * Shows sprint progress with ideal vs actual burndown lines.
 */

import { useQuery } from '@tanstack/react-query';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  ReferenceLine,
} from 'recharts';
import { Loader2, TrendingDown } from 'lucide-react';
import { api } from '@/core/api/client';
import { format, parseISO } from 'date-fns';

interface BurndownChartProps {
  sprintId: string;
  className?: string;
}

export function BurndownChart({ sprintId, className }: BurndownChartProps) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['sprint-burndown', sprintId],
    queryFn: () => api.stats.sprintBurndown(sprintId),
    enabled: !!sprintId,
  });

  if (isLoading) {
    return (
      <div className={`flex items-center justify-center h-64 ${className}`}>
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className={`flex items-center justify-center h-64 text-muted-foreground ${className}`}>
        <p>Failed to load burndown data</p>
      </div>
    );
  }

  if (data.burndown.length === 0) {
    return (
      <div className={`flex flex-col items-center justify-center h-64 text-muted-foreground ${className}`}>
        <TrendingDown className="h-10 w-10 mb-3 opacity-50" />
        <p>No burndown data available</p>
        <p className="text-xs mt-1">Set sprint start and end dates to see the burndown chart</p>
      </div>
    );
  }

  // Format data for chart
  const chartData = data.burndown.map((point) => ({
    date: point.date,
    displayDate: format(parseISO(point.date), 'MMM d'),
    ideal: point.ideal,
    actual: point.remaining,
  }));

  const progress = data.totalPoints > 0
    ? Math.round((data.completedPoints / data.totalPoints) * 100)
    : 0;

  return (
    <div className={className}>
      {/* Header Stats */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-semibold flex items-center gap-2">
            <TrendingDown className="h-4 w-4 text-primary" />
            Sprint Burndown
          </h3>
          <p className="text-xs text-muted-foreground">{data.sprint.name}</p>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <div className="text-right">
            <p className="font-semibold">{data.completedPoints}/{data.totalPoints}</p>
            <p className="text-xs text-muted-foreground">points completed</p>
          </div>
          <div className="w-16 h-16 relative">
            <svg className="transform -rotate-90" viewBox="0 0 36 36">
              <circle
                cx="18"
                cy="18"
                r="16"
                fill="none"
                className="stroke-muted"
                strokeWidth="3"
              />
              <circle
                cx="18"
                cy="18"
                r="16"
                fill="none"
                className="stroke-primary"
                strokeWidth="3"
                strokeDasharray={`${progress} 100`}
                strokeLinecap="round"
              />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-sm font-bold">
              {progress}%
            </span>
          </div>
        </div>
      </div>

      {/* Chart */}
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis
              dataKey="displayDate"
              tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
              tickLine={{ stroke: 'hsl(var(--border))' }}
              axisLine={{ stroke: 'hsl(var(--border))' }}
            />
            <YAxis
              tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
              tickLine={{ stroke: 'hsl(var(--border))' }}
              axisLine={{ stroke: 'hsl(var(--border))' }}
              domain={[0, 'dataMax']}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: 'hsl(var(--card))',
                border: '1px solid hsl(var(--border))',
                borderRadius: '8px',
                fontSize: '12px',
              }}
              labelStyle={{ color: 'hsl(var(--foreground))' }}
              formatter={(value, name) => [
                `${value ?? 0} points`,
                name === 'ideal' ? 'Ideal' : 'Actual',
              ]}
            />
            <Legend
              wrapperStyle={{ fontSize: '12px' }}
              formatter={(value) => (value === 'ideal' ? 'Ideal' : 'Actual')}
            />
            <ReferenceLine y={0} stroke="hsl(var(--border))" />
            <Line
              type="linear"
              dataKey="ideal"
              stroke="hsl(var(--muted-foreground))"
              strokeDasharray="5 5"
              dot={false}
              strokeWidth={2}
            />
            <Line
              type="monotone"
              dataKey="actual"
              stroke="hsl(var(--primary))"
              dot={{ fill: 'hsl(var(--primary))', strokeWidth: 0, r: 3 }}
              activeDot={{ r: 5 }}
              strokeWidth={2}
              connectNulls={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Footer Stats */}
      <div className="flex items-center justify-between mt-4 text-xs text-muted-foreground border-t border-border pt-3">
        <span>{data.ticketCount} tickets in sprint</span>
        {data.sprint.startDate && data.sprint.endDate && (
          <span>
            {format(parseISO(data.sprint.startDate), 'MMM d')} - {format(parseISO(data.sprint.endDate), 'MMM d')}
          </span>
        )}
      </div>
    </div>
  );
}
