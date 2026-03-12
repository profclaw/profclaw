import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import type { VelocityDataPoint } from '@/core/types';

interface VelocityChartProps {
  data: VelocityDataPoint[];
  title?: string;
  showLegend?: boolean;
  colors?: { created: string; completed: string };
}

const DEFAULT_COLORS = { created: '#3b82f6', completed: '#22c55e' };

export function VelocityChart({ data, title, showLegend = true, colors }: VelocityChartProps) {
  const chartColors = { ...DEFAULT_COLORS, ...colors };
  // Format date for display
  const formattedData = data.map((d) => ({
    ...d,
    displayDate: new Date(d.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
  }));

  // Only show every 5th date label for readability
  const formatXAxis = (value: string, index: number) => {
    if (index % 5 === 0) return value;
    return '';
  };

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        No data available
      </div>
    );
  }

  return (
    <div className="w-full h-full">
      {title && (
        <h4 className="text-sm font-medium text-muted-foreground mb-2">{title}</h4>
      )}
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={formattedData}
          margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
        >
          <defs>
            <linearGradient id="colorCreated" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={chartColors.created} stopOpacity={0.3} />
              <stop offset="95%" stopColor={chartColors.created} stopOpacity={0} />
            </linearGradient>
            <linearGradient id="colorCompleted" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={chartColors.completed} stopOpacity={0.3} />
              <stop offset="95%" stopColor={chartColors.completed} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
          <XAxis
            dataKey="displayDate"
            tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
            tickFormatter={formatXAxis}
            axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
            tickLine={{ stroke: 'rgba(255,255,255,0.1)' }}
          />
          <YAxis
            tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
            axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
            tickLine={{ stroke: 'rgba(255,255,255,0.1)' }}
            allowDecimals={false}
          />
          <Tooltip
            content={({ active, payload, label }) => {
              if (active && payload && payload.length) {
                return (
                  <div className="glass-heavy px-3 py-2 rounded-lg text-sm border border-white/10">
                    <p className="font-medium mb-1">{label}</p>
                    {payload.map((entry: any) => (
                      <p key={entry.name} style={{ color: entry.color }}>
                        {entry.name}: {entry.value}
                      </p>
                    ))}
                  </div>
                );
              }
              return null;
            }}
          />
          {showLegend && (
            <Legend
              verticalAlign="top"
              height={36}
              iconType="circle"
              iconSize={8}
              wrapperStyle={{ fontSize: '11px' }}
            />
          )}
          <Area
            type="monotone"
            dataKey="created"
            name="Created"
            stroke={chartColors.created}
            strokeWidth={2}
            fillOpacity={1}
            fill="url(#colorCreated)"
          />
          <Area
            type="monotone"
            dataKey="completed"
            name="Completed"
            stroke={chartColors.completed}
            strokeWidth={2}
            fillOpacity={1}
            fill="url(#colorCompleted)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
