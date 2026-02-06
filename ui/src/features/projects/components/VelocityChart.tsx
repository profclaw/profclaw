/**
 * Velocity Chart Component
 *
 * Shows project velocity over completed sprints with bar chart visualization.
 */

import { useQuery } from '@tanstack/react-query';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  ReferenceLine,
} from 'recharts';
import { Loader2, Zap, TrendingUp, TrendingDown } from 'lucide-react';
import { api } from '@/core/api/client';

interface VelocityChartProps {
  projectId: string;
  className?: string;
}

export function VelocityChart({ projectId, className }: VelocityChartProps) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['project-velocity', projectId],
    queryFn: () => api.stats.projectVelocity(projectId),
    enabled: !!projectId,
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
        <p>Failed to load velocity data</p>
      </div>
    );
  }

  if (data.sprints.length === 0) {
    return (
      <div className={`flex flex-col items-center justify-center h-64 text-muted-foreground ${className}`}>
        <Zap className="h-10 w-10 mb-3 opacity-50" />
        <p>No velocity data yet</p>
        <p className="text-xs mt-1">Complete sprints to see velocity trends</p>
      </div>
    );
  }

  // Format data for chart
  const chartData = data.sprints.map((sprint) => ({
    name: sprint.sprintName,
    planned: sprint.plannedPoints,
    completed: sprint.completedPoints,
    ticketCount: sprint.ticketCount,
    completedTickets: sprint.completedTickets,
  }));

  // Calculate trend (comparing last sprint to average)
  const lastSprint = data.sprints[data.sprints.length - 1];
  const trendPercent = data.averageVelocity > 0
    ? Math.round(((lastSprint.completedPoints - data.averageVelocity) / data.averageVelocity) * 100)
    : 0;

  return (
    <div className={className}>
      {/* Header Stats */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-semibold flex items-center gap-2">
            <Zap className="h-4 w-4 text-amber-500" />
            Velocity Trend
          </h3>
          <p className="text-xs text-muted-foreground">Last {data.sprintCount} sprints</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="text-2xl font-bold">{data.averageVelocity}</p>
            <p className="text-xs text-muted-foreground">avg points/sprint</p>
          </div>
          {trendPercent !== 0 && (
            <div className={`flex items-center gap-1 text-sm ${trendPercent > 0 ? 'text-green-500' : 'text-red-500'}`}>
              {trendPercent > 0 ? (
                <TrendingUp className="h-4 w-4" />
              ) : (
                <TrendingDown className="h-4 w-4" />
              )}
              <span>{Math.abs(trendPercent)}%</span>
            </div>
          )}
        </div>
      </div>

      {/* Chart */}
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis
              dataKey="name"
              tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
              tickLine={{ stroke: 'hsl(var(--border))' }}
              axisLine={{ stroke: 'hsl(var(--border))' }}
            />
            <YAxis
              tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
              tickLine={{ stroke: 'hsl(var(--border))' }}
              axisLine={{ stroke: 'hsl(var(--border))' }}
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
                name === 'planned' ? 'Planned' : 'Completed',
              ]}
            />
            <Legend
              wrapperStyle={{ fontSize: '12px' }}
              formatter={(value) => (value === 'planned' ? 'Planned' : 'Completed')}
            />
            <ReferenceLine
              y={data.averageVelocity}
              stroke="hsl(var(--primary))"
              strokeDasharray="3 3"
              label={{
                value: `Avg: ${data.averageVelocity}`,
                position: 'right',
                fontSize: 10,
                fill: 'hsl(var(--muted-foreground))',
              }}
            />
            <Bar
              dataKey="planned"
              fill="hsl(var(--muted))"
              radius={[4, 4, 0, 0]}
              maxBarSize={40}
            />
            <Bar
              dataKey="completed"
              fill="hsl(var(--primary))"
              radius={[4, 4, 0, 0]}
              maxBarSize={40}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Sprint Summary Table */}
      {data.sprints.length > 0 && (
        <div className="mt-4 border-t border-border pt-3">
          <div className="grid grid-cols-4 gap-2 text-xs text-muted-foreground mb-2">
            <span>Sprint</span>
            <span className="text-right">Planned</span>
            <span className="text-right">Completed</span>
            <span className="text-right">Tickets</span>
          </div>
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {[...data.sprints].reverse().map((sprint) => (
              <div key={sprint.sprintId} className="grid grid-cols-4 gap-2 text-xs">
                <span className="truncate">{sprint.sprintName}</span>
                <span className="text-right text-muted-foreground">{sprint.plannedPoints}</span>
                <span className="text-right font-medium">{sprint.completedPoints}</span>
                <span className="text-right text-muted-foreground">
                  {sprint.completedTickets}/{sprint.ticketCount}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
