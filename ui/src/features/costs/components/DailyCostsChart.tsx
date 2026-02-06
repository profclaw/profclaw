/**
 * Daily Costs Area Chart
 *
 * Shows cost trends over time using Recharts
 */

import { Card } from '@/components/ui/card';
import { TrendingUp } from 'lucide-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

interface DailyCostsChartProps {
  data: Array<{ date: string; cost: number; tokens: number }>;
}

export function DailyCostsChart({ data }: DailyCostsChartProps) {
  // Format data for chart
  const chartData = data.map((item) => ({
    ...item,
    // Format date to be more readable (MM/DD)
    displayDate: new Date(item.date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    }),
  }));

  return (
    <Card className="glass p-6 rounded-2xl">
      <div className="mb-4">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-primary" />
          Daily Costs
        </h3>
        <p className="text-sm text-muted-foreground mt-1">
          Cost trend over the last {data.length} days
        </p>
      </div>

      <ResponsiveContainer width="100%" height={300}>
        <AreaChart
          data={chartData}
          margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
        >
          <defs>
            <linearGradient id="costGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
              <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="hsl(var(--border))"
            opacity={0.3}
          />
          <XAxis
            dataKey="displayDate"
            stroke="hsl(var(--muted-foreground))"
            fontSize={12}
            tickLine={false}
          />
          <YAxis
            stroke="hsl(var(--muted-foreground))"
            fontSize={12}
            tickLine={false}
            tickFormatter={(value) => `$${value.toFixed(2)}`}
          />
          <Tooltip
            content={({ active, payload }) => {
              if (active && payload && payload.length) {
                return (
                  <div className="glass-heavy p-3 rounded-xl shadow-float border border-border/50">
                    <p className="text-sm font-semibold mb-1">
                      {payload[0].payload.displayDate}
                    </p>
                    <p className="text-sm text-primary font-medium">
                      ${payload[0].value?.toFixed(4)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {payload[0].payload.tokens.toLocaleString()} tokens
                    </p>
                  </div>
                );
              }
              return null;
            }}
          />
          <Area
            type="monotone"
            dataKey="cost"
            stroke="hsl(var(--primary))"
            strokeWidth={2}
            fill="url(#costGradient)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </Card>
  );
}
