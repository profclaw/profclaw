import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type GatewayExecuteRequest, type GatewayExecuteResponse } from '@/core/api/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { Activity, CheckCircle, XCircle, Clock, Zap, Server, TrendingUp } from 'lucide-react';

export function GatewayDashboard() {
  const queryClient = useQueryClient();
  const [taskTitle, setTaskTitle] = useState('');
  const [taskPrompt, setTaskPrompt] = useState('');
  const [selectedWorkflow, setSelectedWorkflow] = useState<string>('__auto__');
  const [selectedAgent, setSelectedAgent] = useState<string>('__auto__');
  const [executionResult, setExecutionResult] = useState<GatewayExecuteResponse | null>(null);

  // Fetch gateway agents
  const { data: agentsData, isLoading: agentsLoading } = useQuery({
    queryKey: ['gateway', 'agents'],
    queryFn: () => api.gateway.agents(),
    refetchInterval: 30000,
  });

  // Fetch workflows
  const { data: workflowsData, isLoading: workflowsLoading } = useQuery({
    queryKey: ['gateway', 'workflows'],
    queryFn: () => api.gateway.workflows(),
  });

  // Fetch gateway config
  const { data: configData } = useQuery({
    queryKey: ['gateway', 'config'],
    queryFn: () => api.gateway.config(),
  });

  // Fetch gateway status (primary source for connection info)
  const { data: statusData, isLoading: statusLoading } = useQuery({
    queryKey: ['gateway', 'status'],
    queryFn: () => api.gateway.status(),
    refetchInterval: 5000, // Poll every 5 seconds for real-time status
  });

  // Execute mutation
  const executeMutation = useMutation({
    mutationFn: (req: GatewayExecuteRequest) => api.gateway.execute(req),
    onSuccess: (data) => {
      setExecutionResult(data);
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
    },
  });

  const handleExecute = () => {
    if (!taskTitle.trim()) return;

    const request: GatewayExecuteRequest = {
      task: {
        title: taskTitle,
        prompt: taskPrompt || taskTitle,
        source: 'gateway-ui',
        priority: 3,
      },
      workflow: selectedWorkflow && selectedWorkflow !== '__auto__' ? selectedWorkflow : undefined,
      preferredAgent: selectedAgent && selectedAgent !== '__auto__' ? selectedAgent : undefined,
      autonomous: true,
    };

    executeMutation.mutate(request);
  };

  const agents = agentsData?.agents || [];
  const workflows = workflowsData?.workflows || [];
  const config = configData?.config;
  const status = statusData;

  // Format uptime
  const formatUptime = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    if (days > 0) return `${days}d ${hours % 24}h`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  };

  return (
    <div className="space-y-6">
      {/* Header with Status */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Gateway</h1>
          <p className="text-muted-foreground">
            Execute tasks through the unified routing system
          </p>
        </div>
        <div className="flex items-center gap-2">
          {statusLoading ? (
            <Badge variant="secondary">Checking...</Badge>
          ) : status?.status.online ? (
            <Badge variant="default" className="gap-1">
              <Activity className="h-3 w-3" />
              Online
            </Badge>
          ) : (
            <Badge variant="destructive" className="gap-1">
              <XCircle className="h-3 w-3" />
              Offline
            </Badge>
          )}
          {status && (
            <Badge variant="outline" className="gap-1">
              <Clock className="h-3 w-3" />
              {formatUptime(status.status.uptime)}
            </Badge>
          )}
        </div>
      </div>

      {/* Status Panel */}
      {status && (
        <Card className="shadow-elevated">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Server className="h-5 w-5" />
                Gateway Status
              </CardTitle>
              <Badge variant={status.status.activeRequests > 0 ? 'default' : 'secondary'}>
                {status.status.activeRequests} active request{status.status.activeRequests !== 1 ? 's' : ''}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Utilization */}
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Capacity Utilization</span>
                <span className="font-medium">{status.status.utilizationPercent}%</span>
              </div>
              <Progress value={status.status.utilizationPercent} className="h-2" />
              <p className="text-xs text-muted-foreground">
                {status.status.activeRequests} / {status.status.maxConcurrent} concurrent slots used
              </p>
            </div>

            {/* Metrics Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="rounded-lg bg-muted/50 p-3 text-center">
                <div className="flex items-center justify-center gap-1 text-muted-foreground text-xs mb-1">
                  <Zap className="h-3 w-3" />
                  Total Tasks
                </div>
                <div className="text-xl font-bold">{status.metrics.totalTasks}</div>
              </div>
              <div className="rounded-lg bg-muted/50 p-3 text-center">
                <div className="flex items-center justify-center gap-1 text-muted-foreground text-xs mb-1">
                  <CheckCircle className="h-3 w-3" />
                  Success Rate
                </div>
                <div className="text-xl font-bold">{status.metrics.successRate}%</div>
              </div>
              <div className="rounded-lg bg-muted/50 p-3 text-center">
                <div className="flex items-center justify-center gap-1 text-muted-foreground text-xs mb-1">
                  <Clock className="h-3 w-3" />
                  Avg Duration
                </div>
                <div className="text-xl font-bold">
                  {status.metrics.averageDurationMs > 60000
                    ? `${Math.round(status.metrics.averageDurationMs / 60000)}m`
                    : `${Math.round(status.metrics.averageDurationMs / 1000)}s`}
                </div>
              </div>
              <div className="rounded-lg bg-muted/50 p-3 text-center">
                <div className="flex items-center justify-center gap-1 text-muted-foreground text-xs mb-1">
                  <TrendingUp className="h-3 w-3" />
                  Total Load
                </div>
                <div className="text-xl font-bold">{status.agents.totalLoad}</div>
              </div>
            </div>

            {/* Connected Agents */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">Connected Agents</span>
                <span className="text-muted-foreground">
                  {status.agents.healthy}/{status.agents.total} healthy
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {status.agents.list.map((agent) => (
                  <Badge
                    key={agent.type}
                    variant={agent.healthy ? 'outline' : 'destructive'}
                    className="gap-1"
                  >
                    {agent.healthy ? (
                      <CheckCircle className="h-3 w-3 text-green-500" />
                    ) : (
                      <XCircle className="h-3 w-3" />
                    )}
                    {agent.name}
                    {agent.load > 0 && (
                      <span className="text-xs opacity-70">({agent.load})</span>
                    )}
                    {agent.latencyMs !== undefined && (
                      <span className="text-xs opacity-70">{agent.latencyMs}ms</span>
                    )}
                  </Badge>
                ))}
                {status.agents.list.length === 0 && (
                  <span className="text-sm text-muted-foreground">No agents connected</span>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stats Row */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Available Agents</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{agents.length}</div>
            <p className="text-xs text-muted-foreground">
              {agents.filter(a => a.health.healthy).length} healthy
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Workflows</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{workflows.length}</div>
            <p className="text-xs text-muted-foreground">
              Available templates
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Config</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {config?.enableScoring ? 'Smart' : 'Basic'}
            </div>
            <p className="text-xs text-muted-foreground">
              Routing mode
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Main Content */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Execute Task Card */}
        <Card>
          <CardHeader>
            <CardTitle>Execute Task</CardTitle>
            <CardDescription>
              Route a task through the gateway for intelligent agent selection
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="title">Task Title</Label>
              <Input
                id="title"
                placeholder="Fix authentication bug"
                value={taskTitle}
                onChange={(e) => setTaskTitle(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="prompt">Task Prompt (optional)</Label>
              <Textarea
                id="prompt"
                placeholder="Detailed description of the task..."
                value={taskPrompt}
                onChange={(e) => setTaskPrompt(e.target.value)}
                rows={3}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Workflow</Label>
                <Select value={selectedWorkflow} onValueChange={setSelectedWorkflow}>
                  <SelectTrigger>
                    <SelectValue placeholder="Auto-detect" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__auto__">Auto-detect</SelectItem>
                    {workflows.map((w) => (
                      <SelectItem key={w.type} value={w.type}>
                        {w.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Preferred Agent</Label>
                <Select value={selectedAgent} onValueChange={setSelectedAgent}>
                  <SelectTrigger>
                    <SelectValue placeholder="Auto-select" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__auto__">Auto-select</SelectItem>
                    {agents.map((a) => (
                      <SelectItem key={a.type} value={a.type} disabled={!a.health.healthy}>
                        {a.name} {!a.health.healthy && '(unhealthy)'}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Button
              onClick={handleExecute}
              disabled={!taskTitle.trim() || executeMutation.isPending}
              className="w-full"
            >
              {executeMutation.isPending ? 'Executing...' : 'Execute Task'}
            </Button>
          </CardContent>
        </Card>

        {/* Result Card */}
        <Card>
          <CardHeader>
            <CardTitle>Execution Result</CardTitle>
            <CardDescription>
              {executionResult ? 'Last execution result' : 'Execute a task to see results'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {executionResult ? (
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <Badge variant={executionResult.success ? 'default' : 'destructive'}>
                    {executionResult.success ? 'Success' : 'Failed'}
                  </Badge>
                  {executionResult.agent && (
                    <Badge variant="outline">{executionResult.agent}</Badge>
                  )}
                  {executionResult.workflow && (
                    <Badge variant="secondary">{executionResult.workflow}</Badge>
                  )}
                </div>

                {executionResult.routing && (
                  <div className="rounded-lg bg-muted p-3 space-y-2">
                    <div className="text-sm font-medium">Routing Decision</div>
                    <div className="text-sm text-muted-foreground">
                      {executionResult.routing.reason}
                    </div>
                    {executionResult.routing.scores.length > 0 && (
                      <div className="mt-2 space-y-1">
                        <div className="text-xs font-medium">Scores:</div>
                        {executionResult.routing.scores.map((s) => (
                          <div key={s.agent} className="flex justify-between text-xs">
                            <span>{s.agent}</span>
                            <span className="font-mono">{s.score.toFixed(1)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {executionResult.metrics && (
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div>
                      <div className="text-xs text-muted-foreground">Total</div>
                      <div className="font-mono text-sm">
                        {(executionResult.metrics.totalDuration / 1000).toFixed(2)}s
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Routing</div>
                      <div className="font-mono text-sm">
                        {executionResult.metrics.routingDuration}ms
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Execution</div>
                      <div className="font-mono text-sm">
                        {(executionResult.metrics.executionDuration / 1000).toFixed(2)}s
                      </div>
                    </div>
                  </div>
                )}

                {executionResult.error && (
                  <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
                    {executionResult.error}
                  </div>
                )}
              </div>
            ) : (
              <div className="flex h-32 items-center justify-center text-muted-foreground">
                No execution yet
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Agents Section */}
      <Card>
        <CardHeader>
          <CardTitle>Available Agents</CardTitle>
          <CardDescription>
            Agents registered with the gateway for task execution
          </CardDescription>
        </CardHeader>
        <CardContent>
          {agentsLoading ? (
            <div className="text-muted-foreground">Loading agents...</div>
          ) : agents.length === 0 ? (
            <div className="text-muted-foreground">No agents available</div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {agents.map((agent) => (
                <div
                  key={agent.type}
                  className="rounded-lg bg-card/50 shadow-sm p-4 space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <div className="font-medium">{agent.name}</div>
                    <Badge variant={agent.health.healthy ? 'default' : 'destructive'}>
                      {agent.health.healthy ? 'Healthy' : 'Unhealthy'}
                    </Badge>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {agent.description}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {agent.capabilities.slice(0, 4).map((cap) => (
                      <Badge key={cap} variant="outline" className="text-xs">
                        {cap}
                      </Badge>
                    ))}
                    {agent.capabilities.length > 4 && (
                      <Badge variant="outline" className="text-xs">
                        +{agent.capabilities.length - 4}
                      </Badge>
                    )}
                  </div>
                  {agent.health.latencyMs !== undefined && (
                    <div className="text-xs text-muted-foreground">
                      Latency: {agent.health.latencyMs}ms
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Workflows Section */}
      <Card>
        <CardHeader>
          <CardTitle>Workflow Templates</CardTitle>
          <CardDescription>
            Pre-defined workflows for common task types
          </CardDescription>
        </CardHeader>
        <CardContent>
          {workflowsLoading ? (
            <div className="text-muted-foreground">Loading workflows...</div>
          ) : workflows.length === 0 ? (
            <div className="text-muted-foreground">No workflows available</div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {workflows.map((workflow) => (
                <div
                  key={workflow.type}
                  className="rounded-lg bg-card/50 shadow-sm p-4 space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <div className="font-medium">{workflow.name}</div>
                    <Badge variant="secondary">{workflow.steps} steps</Badge>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {workflow.description}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {workflow.requiredCapabilities.map((cap) => (
                      <Badge key={cap} variant="outline" className="text-xs">
                        {cap}
                      </Badge>
                    ))}
                  </div>
                  {workflow.defaultTimeoutMs && (
                    <div className="text-xs text-muted-foreground">
                      Timeout: {Math.round(workflow.defaultTimeoutMs / 1000 / 60)}min
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
