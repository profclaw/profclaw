import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import { ProviderList, type Provider } from './components/ProviderList.js';
import { TaskList, type Task } from './components/TaskList.js';
import { SystemHealth, type SystemMetrics } from './components/SystemHealth.js';
import { HookStatus, type Hook } from './components/HookStatus.js';
import { ChannelList, type Channel } from './components/ChannelList.js';
import { api } from '../utils/api.js';

// ---- API response shapes ----

interface SystemStatusResponse {
  version?: string;
  uptime?: number;
  mode?: string;
  healthy?: boolean;
  memoryUsedMb?: number;
  memoryTotalMb?: number;
  cpuPercent?: number;
  queueBackend?: 'redis' | 'memory';
  degraded?: boolean;
}

interface ProviderResponse {
  type: string;
  healthy: boolean;
  latencyMs?: number;
  modelCount?: number;
  priority?: number;
}

interface TaskResponse {
  id: string;
  title: string;
  status: string;
  createdAt: string;
  durationMs?: number;
}

interface HookResponse {
  name: string;
  point: string;
  priority?: number;
  active: boolean;
}

interface ChannelResponse {
  name: string;
  type: string;
  status: string;
  messageCount?: number;
  lastActivity?: string;
}

// ---- Tab definitions ----

type TabId = 'overview' | 'tasks' | 'channels' | 'hooks';

const TABS: { id: TabId; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'channels', label: 'Channels' },
  { id: 'hooks', label: 'Hooks' },
];

// ---- Data state ----

interface DashboardData {
  system: SystemMetrics;
  providers: Provider[];
  tasks: Task[];
  hooks: Hook[];
  channels: Channel[];
}

interface LoadState {
  loading: boolean;
  systemError?: string;
  providersError?: string;
  tasksError?: string;
  hooksError?: string;
  channelsError?: string;
}

// ---- Helpers ----

function toTaskStatus(raw: string): Task['status'] {
  const allowed = ['pending', 'running', 'completed', 'failed', 'cancelled'] as const;
  return (allowed as readonly string[]).includes(raw)
    ? (raw as Task['status'])
    : 'pending';
}

function toChannelStatus(raw: string): Channel['status'] {
  const allowed = ['connected', 'disconnected', 'error', 'connecting'] as const;
  return (allowed as readonly string[]).includes(raw)
    ? (raw as Channel['status'])
    : 'disconnected';
}

// ---- Tab bar ----

function TabBar({ current, onSelect }: {
  current: TabId;
  onSelect: (id: TabId) => void;
}): React.ReactElement {
  void onSelect; // navigation handled via keyboard, kept for future mouse use
  return (
    <Box gap={1} marginBottom={1}>
      {TABS.map((tab, i) => (
        <Box key={tab.id} gap={0}>
          <Text
            color={current === tab.id ? 'cyan' : 'white'}
            bold={current === tab.id}
            dimColor={current !== tab.id}
          >
            {i > 0 ? '│ ' : ''}{tab.label}
          </Text>
        </Box>
      ))}
      <Text dimColor>   ← → to switch  q to quit</Text>
    </Box>
  );
}

// ---- Main app ----

export function DashboardApp(): React.ReactElement {
  const { exit } = useApp();
  const [tabIndex, setTabIndex] = useState(0);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [data, setData] = useState<DashboardData>({
    system: {},
    providers: [],
    tasks: [],
    hooks: [],
    channels: [],
  });
  const [loadState, setLoadState] = useState<LoadState>({ loading: true });

  const fetchData = useCallback(async () => {
    setLoadState((prev) => ({ ...prev, loading: true }));

    const [sysRes, provRes, taskRes, hookRes, chanRes] = await Promise.allSettled([
      api.get<SystemStatusResponse>('/health'),
      api.get<{ providers: ProviderResponse[] }>('/api/chat/providers'),
      api.get<{ tasks: TaskResponse[] }>('/api/tasks?limit=20&sort=createdAt'),
      api.get<{ hooks: HookResponse[] }>('/api/hooks'),
      api.get<{ channels: ChannelResponse[] }>('/api/channels'),
    ]);

    const next: DashboardData = {
      system: {},
      providers: [],
      tasks: [],
      hooks: [],
      channels: [],
    };
    const errors: Partial<LoadState> = { loading: false };

    if (sysRes.status === 'fulfilled' && sysRes.value.ok && sysRes.value.data) {
      const raw = sysRes.value.data as Record<string, unknown>;
      next.system = {
        ...raw,
        healthy: raw.status === 'ok' || raw.healthy === true,
        queueBackend: (raw.queue ?? raw.queueBackend) as 'redis' | 'memory' | undefined,
      } as SystemMetrics;
    } else {
      errors.systemError =
        sysRes.status === 'fulfilled'
          ? (sysRes.value.error ?? 'Failed to load system status')
          : 'Failed to load system status';
    }

    if (provRes.status === 'fulfilled' && provRes.value.ok && provRes.value.data) {
      next.providers = provRes.value.data.providers as Provider[];
    } else {
      errors.providersError = 'Failed to load providers';
    }

    if (taskRes.status === 'fulfilled' && taskRes.value.ok && taskRes.value.data) {
      next.tasks = taskRes.value.data.tasks.map((t) => ({
        ...t,
        status: toTaskStatus(t.status),
      }));
    } else {
      errors.tasksError = 'Failed to load tasks';
    }

    if (hookRes.status === 'fulfilled' && hookRes.value.ok && hookRes.value.data) {
      next.hooks = hookRes.value.data.hooks as Hook[];
    } else {
      // /api/hooks may not exist yet — show empty list instead of error
      next.hooks = [];
    }

    if (chanRes.status === 'fulfilled' && chanRes.value.ok && chanRes.value.data) {
      // API returns { provider, registered, enabled, configured } — map to our Channel shape
      const raw = chanRes.value.data.channels as unknown as Array<Record<string, unknown>>;
      next.channels = raw.map((c) => ({
        name: (c.name ?? c.provider ?? 'unknown') as string,
        type: (c.type ?? c.provider ?? '') as string,
        status: toChannelStatus(
          c.status as string ??
          (c.registered ? 'connected' : c.configured ? 'disconnected' : 'disconnected')
        ),
        messageCount: (c.messageCount ?? 0) as number,
        lastActivity: (c.lastActivity ?? c.lastActivityAt ?? '') as string,
      }));
    } else {
      errors.channelsError = 'Failed to load channels';
    }

    setData(next);
    setLoadState(errors as LoadState);
    setLastRefresh(new Date());
  }, []);

  // Initial load + auto-refresh every 5 seconds
  useEffect(() => {
    void fetchData();
    const timer = setInterval(() => { void fetchData(); }, 5000);
    return () => clearInterval(timer);
  }, [fetchData]);

  useInput((input, key) => {
    if (input === 'q' || (key.ctrl && input === 'c')) {
      exit();
      return;
    }
    if (key.rightArrow) {
      setTabIndex((i) => (i + 1) % TABS.length);
    }
    if (key.leftArrow) {
      setTabIndex((i) => (i - 1 + TABS.length) % TABS.length);
    }
    if (input === 'r') {
      void fetchData();
    }
  });

  const currentTab = TABS[tabIndex].id;

  return (
    <Box flexDirection="column" padding={1}>
      {/* Header */}
      <Box marginBottom={1} gap={2}>
        <Text bold color="cyan">profClaw Dashboard</Text>
        <Text dimColor>
          {lastRefresh.toLocaleTimeString()} · r to refresh
        </Text>
      </Box>

      {/* Tabs */}
      <TabBar current={currentTab} onSelect={(id) => setTabIndex(TABS.findIndex((t) => t.id === id))} />

      {/* Divider */}
      <Text dimColor>{'─'.repeat(60)}</Text>

      {/* Content */}
      <Box flexDirection="column" marginTop={1}>
        {currentTab === 'overview' && (
          <Box flexDirection="column" gap={2}>
            <SystemHealth
              metrics={data.system}
              loading={loadState.loading}
              error={loadState.systemError}
            />
            <ProviderList
              providers={data.providers}
              loading={loadState.loading}
              error={loadState.providersError}
            />
          </Box>
        )}

        {currentTab === 'tasks' && (
          <TaskList
            tasks={data.tasks}
            loading={loadState.loading}
            error={loadState.tasksError}
          />
        )}

        {currentTab === 'channels' && (
          <ChannelList
            channels={data.channels}
            loading={loadState.loading}
            error={loadState.channelsError}
          />
        )}

        {currentTab === 'hooks' && (
          <HookStatus
            hooks={data.hooks}
            loading={loadState.loading}
            error={loadState.hooksError}
          />
        )}
      </Box>
    </Box>
  );
}
