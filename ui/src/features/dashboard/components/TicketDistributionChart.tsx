import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';

interface TicketDistributionChartProps {
  data: Record<string, number>;
  title?: string;
  colorMap?: Record<string, string>;
}

const DEFAULT_COLORS: Record<string, string> = {
  // Types
  task: '#3b82f6',
  bug: '#ef4444',
  feature: '#a855f7',
  epic: '#f97316',
  story: '#22c55e',
  subtask: '#6b7280',
  enhancement: '#6366f1',
  documentation: '#06b6d4',
  // Priorities
  critical: '#ef4444',
  high: '#f97316',
  medium: '#facc15',
  low: '#3b82f6',
  none: '#6b7280',
  // Statuses
  backlog: '#6b7280',
  todo: '#3b82f6',
  in_progress: '#f59e0b',
  in_review: '#a855f7',
  done: '#22c55e',
  cancelled: '#94a3b8',
};

export function TicketDistributionChart({
  data,
  title,
  colorMap = DEFAULT_COLORS,
}: TicketDistributionChartProps) {
  const chartData = Object.entries(data)
    .filter(([_, value]) => value > 0)
    .map(([name, value]) => ({
      name: name.replace('_', ' '),
      value,
      color: colorMap[name] || '#6b7280',
    }))
    .sort((a, b) => b.value - a.value);

  if (chartData.length === 0) {
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
        <BarChart
          data={chartData}
          layout="vertical"
          margin={{ top: 5, right: 10, left: 0, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" horizontal={false} />
          <XAxis
            type="number"
            tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
            axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
            tickLine={{ stroke: 'rgba(255,255,255,0.1)' }}
            allowDecimals={false}
          />
          <YAxis
            type="category"
            dataKey="name"
            tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
            axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
            tickLine={false}
            width={70}
          />
          <Tooltip
            content={({ active, payload }) => {
              if (active && payload && payload.length) {
                const data = payload[0].payload;
                return (
                  <div className="glass-heavy px-3 py-2 rounded-lg text-sm border border-white/10">
                    <span className="font-medium capitalize">{data.name}: </span>
                    <span>{data.value}</span>
                  </div>
                );
              }
              return null;
            }}
          />
          <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={16}>
            {chartData.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
