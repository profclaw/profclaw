/**
 * Costs by Agent Donut Chart
 *
 * Shows cost distribution across AI agents using Recharts
 */

import { Card } from '@/components/ui/card';
import { Users } from 'lucide-react';
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Legend,
  Tooltip,
} from 'recharts';

interface CostsByAgentChartProps {
  data: Record<string, { cost: number; tokens: number }>;
}

// Color palette for agents
const COLORS = [
  'hsl(var(--primary))',
  'hsl(var(--chart-1))',
  'hsl(var(--chart-2))',
  'hsl(var(--chart-3))',
  'hsl(var(--chart-4))',
  'hsl(var(--chart-5))',
];

export function CostsByAgentChart({ data }: CostsByAgentChartProps) {
  // Transform data for chart
  const chartData = Object.entries(data)
    .map(([agent, stats], index) => ({
      name: agent,
      value: stats.cost,
      tokens: stats.tokens,
      color: COLORS[index % COLORS.length],
    }))
    .sort((a, b) => b.value - a.value);

  return (
    <Card className="glass p-6 rounded-2xl">
      <div className="mb-4">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <Users className="w-5 h-5 text-primary" />
          Costs by Agent
        </h3>
        <p className="text-sm text-muted-foreground mt-1">
          Cost distribution across AI agents
        </p>
      </div>

      <ResponsiveContainer width="100%" height={300}>
        <PieChart>
          <Pie
            data={chartData}
            cx="50%"
            cy="50%"
            innerRadius={60}
            outerRadius={100}
            paddingAngle={2}
            dataKey="value"
          >
            {chartData.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.color} />
            ))}
          </Pie>
          <Tooltip
            content={({ active, payload }) => {
              if (active && payload && payload.length) {
                return (
                  <div className="glass-heavy p-3 rounded-xl shadow-float border border-border/50">
                    <p className="text-sm font-semibold mb-1">
                      {payload[0].payload.name}
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
          <Legend
            verticalAlign="bottom"
            height={36}
            iconType="circle"
            formatter={(value, entry) => {
              const total = chartData.reduce((sum, item) => sum + item.value, 0);
              const pieValue =
                entry && entry.payload && typeof entry.payload.value === 'number'
                  ? entry.payload.value
                  : 0;
              const percentage = (
                (pieValue / (total || 1)) *
                100
              ).toFixed(1);
              return (
                <span className="text-sm text-foreground">
                  {value} ({percentage}%)
                </span>
              );
            }}
          />
        </PieChart>
      </ResponsiveContainer>

      {/* Agent breakdown list */}
      <div className="mt-6 space-y-2">
        {chartData.map((item) => (
          <div
            key={item.name}
            className="flex items-center justify-between p-2 rounded-lg hover:bg-muted/50 transition-liquid"
          >
            <div className="flex items-center gap-2">
              <div
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: item.color }}
              />
              <span className="text-sm font-medium">{item.name}</span>
            </div>
            <span className="text-sm text-primary font-semibold">
              ${item.value.toFixed(4)}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}
