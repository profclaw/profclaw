import type { ComponentType } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, BarChart, Bar, Legend
} from 'recharts';
import {
  Coins, TrendingUp, CreditCard, Activity,
  ArrowUpRight, ArrowDownRight, Zap, Download
} from 'lucide-react';
import { useCostAnalytics, useCostBudget } from '../api/costs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

const COLORS = ['#60a5fa', '#818cf8', '#ec4899', '#f97316', '#10b981'];

export function CostDashboard() {
  const { data: analytics, isLoading } = useCostAnalytics();
  const { data: budget } = useCostBudget();

  if (isLoading) {
    return (
      <div className="space-y-6">
        <header>
          <h2 className="text-2xl font-bold tracking-tight">Cost Analytics</h2>
          <p className="text-muted-foreground text-sm">Analyzing token usage and spend.</p>
        </header>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-32 rounded-3xl skeleton-glass" />)}
        </div>
        <Skeleton className="h-[400px] rounded-3xl skeleton-glass" />
      </div>
    );
  }

  const dailyData = analytics?.daily || [];
  const modelData = Object.entries(analytics?.byModel || {}).map(([name, data]) => ({ name, ...data }));
  const agentData = Object.entries(analytics?.byAgent || {}).map(([name, data]) => ({ name, ...data }));

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Cost Analytics</h2>
          <p className="text-muted-foreground text-sm">Real-time visualization of AI operation expenses.</p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            className="rounded-full gap-2"
            onClick={() => {
              window.open('/api/costs/export', '_blank');
            }}
          >
            <Download className="h-4 w-4" />
            Export CSV
          </Button>
          <div className="flex items-center gap-2 px-4 py-2 rounded-full glass border-white/10">
            <Zap className="h-4 w-4 text-yellow-400 fill-yellow-400" />
            <span className="text-[10px] font-bold uppercase tracking-widest">Live Billing</span>
          </div>
        </div>
      </header>

      {/* Stats Overview */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total Spend"
          value={`$${(analytics?.totalCost ?? 0).toFixed(4)}`}
          icon={Coins}
          trend="+12%"
          trendDir="up"
          glowColor="bg-blue-500"
        />
        <StatCard
          title="Total Tokens"
          value={(analytics?.totalTokens ?? 0).toLocaleString()}
          icon={Activity}
          trend="+5%"
          trendDir="up"
          glowColor="bg-indigo-500"
        />
        <StatCard
          title="Avg. Cost / Task"
          value={`$${((analytics?.totalCost ?? 0) / (dailyData.length || 1)).toFixed(6)}`}
          icon={TrendingUp}
          trend="-2%"
          trendDir="down"
          glowColor="bg-green-500"
        />
        <StatCard
          title="Projected Monthly"
          value={`$${((analytics?.totalCost ?? 0) * 4).toFixed(2)}`}
          icon={CreditCard}
          glowColor="bg-orange-500"
        />
      </div>

      {/* Budget Progress */}
      {budget && (
        <Card className="glass rounded-[32px] overflow-hidden border-white/5">
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-bold">Monthly Budget</h3>
                <p className="text-sm text-muted-foreground">
                  ${(budget.spent ?? 0).toFixed(2)} of ${(budget.limit ?? 0).toFixed(2)} used
                </p>
              </div>
              <div className={cn(
                "text-2xl font-bold",
                (budget.percentage ?? 0) > 90 ? "text-red-400" :
                (budget.percentage ?? 0) > 70 ? "text-yellow-400" : "text-green-400"
              )}>
                {(budget.percentage ?? 0).toFixed(0)}%
              </div>
            </div>
            <div className="relative h-4 bg-white/5 rounded-full overflow-hidden">
              <div
                className={cn(
                  "absolute inset-y-0 left-0 rounded-full transition-all duration-500",
                  (budget.percentage ?? 0) > 90 ? "bg-gradient-to-r from-red-500 to-red-400" :
                  (budget.percentage ?? 0) > 70 ? "bg-gradient-to-r from-yellow-500 to-orange-400" :
                  "bg-gradient-to-r from-green-500 to-emerald-400"
                )}
                style={{ width: `${Math.min(budget.percentage ?? 0, 100)}%` }}
              />
              {/* Glow effect */}
              <div
                className={cn(
                  "absolute inset-y-0 left-0 rounded-full blur-sm opacity-50",
                  (budget.percentage ?? 0) > 90 ? "bg-red-500" :
                  (budget.percentage ?? 0) > 70 ? "bg-yellow-500" : "bg-green-500"
                )}
                style={{ width: `${Math.min(budget.percentage ?? 0, 100)}%` }}
              />
            </div>
            <div className="flex justify-between mt-3 text-xs text-muted-foreground">
              <span>${(budget.spent ?? 0).toFixed(2)} spent</span>
              <span>${(budget.remaining ?? 0).toFixed(2)} remaining</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Daily Cost Chart */}
      <Card className="glass rounded-[32px] overflow-hidden border-white/5">
        <CardHeader>
          <CardTitle className="text-lg font-bold">Spending Trend</CardTitle>
        </CardHeader>
        <CardContent className="h-[350px] w-full pt-4">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={dailyData}>
              <defs>
                <linearGradient id="colorCost" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#60a5fa" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="#60a5fa" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.05)" />
              <XAxis 
                dataKey="date" 
                axisLine={false} 
                tickLine={false} 
                tick={{fill: 'rgba(255,255,255,0.4)', fontSize: 10}}
                dy={10}
              />
              <YAxis 
                axisLine={false} 
                tickLine={false} 
                tick={{fill: 'rgba(255,255,255,0.4)', fontSize: 10}}
              />
              <Tooltip content={<CustomTooltip />} />
              <Area 
                type="monotone" 
                dataKey="cost" 
                stroke="#60a5fa" 
                strokeWidth={3}
                fillOpacity={1} 
                fill="url(#colorCost)" 
              />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Costs by Agent */}
        <Card className="glass rounded-[32px] border-white/5">
          <CardHeader>
            <CardTitle className="text-lg font-bold">Cost by Agent</CardTitle>
          </CardHeader>
          <CardContent className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={agentData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={80}
                  paddingAngle={5}
                  dataKey="cost"
                >
                  {agentData.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} stroke="none" />
                  ))}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
                <Legend verticalAlign="bottom" height={36}/>
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Tokens by Model */}
        <Card className="glass rounded-[32px] border-white/5">
          <CardHeader>
            <CardTitle className="text-lg font-bold">Tokens by Model</CardTitle>
          </CardHeader>
          <CardContent className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={modelData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="rgba(255,255,255,0.05)" />
                <XAxis type="number" hide />
                <YAxis 
                  dataKey="name" 
                  type="category" 
                  axisLine={false} 
                  tickLine={false}
                  tick={{fill: 'rgba(255,255,255,0.6)', fontSize: 11}}
                  width={100}
                />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="tokens" fill="#818cf8" radius={[0, 10, 10, 0]} barSize={20} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

interface StatCardProps {
  title: string;
  value: string | number;
  icon: ComponentType<{ className?: string }>;
  trend?: string;
  trendDir?: 'up' | 'down';
  glowColor?: string;
}

function StatCard({ title, value, icon: Icon, trend, trendDir, glowColor }: StatCardProps) {
  return (
    <Card className="glass hover-lift transition-liquid overflow-hidden relative group border-white/5">
      <div className={cn("absolute -top-12 -right-12 w-24 h-24 rounded-full blur-3xl opacity-10 group-hover:opacity-20 transition-opacity", glowColor)} />
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{title}</CardTitle>
        <div className="h-8 w-8 rounded-xl glass-heavy flex items-center justify-center border-white/10">
          <Icon className="h-4 w-4 text-blue-400" />
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-bold tracking-tight">{value}</span>
          {trend && (
            <div className={cn(
              "flex items-center text-[10px] font-bold px-1.5 py-0.5 rounded-lg",
              trendDir === 'up' ? "text-green-400 bg-green-400/10" : "text-red-400 bg-red-400/10"
            )}>
              {trendDir === 'up' ? <ArrowUpRight className="h-3 w-3 mr-0.5" /> : <ArrowDownRight className="h-3 w-3 mr-0.5" />}
              {trend}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

type ChartPayloadEntry = { name: string; value: number; payload: { name: string } };
type CustomTooltipProps = {
  active?: boolean;
  payload?: ChartPayloadEntry[];
  label?: string;
};

function CustomTooltip({ active, payload, label }: CustomTooltipProps) {
  if (active && payload && payload.length) {
    return (
      <div className="glass-heavy p-3 rounded-2xl border border-white/10 shadow-2xl animate-in zoom-in-95 duration-200">
        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1">{label || payload[0].payload.name}</p>
        {payload.map((p, i) => (
          <div key={i} className="flex items-center justify-between gap-4 mt-0.5">
            <span className="text-[12px] font-medium text-white/70">{p.name === 'cost' ? 'Spend' : 'Tokens'}:</span>
            <span className="text-[12px] font-bold text-white">
              {p.name === 'cost' ? `$${p.value.toFixed(4)}` : p.value.toLocaleString()}
            </span>
          </div>
        ))}
      </div>
    );
  }
  return null;
}
