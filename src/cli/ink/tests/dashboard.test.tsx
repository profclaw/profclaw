import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect } from 'vitest';
import { ProviderList, type Provider } from '../components/ProviderList.js';
import { TaskList, type Task } from '../components/TaskList.js';
import { SystemHealth, type SystemMetrics } from '../components/SystemHealth.js';
import { HookStatus, type Hook } from '../components/HookStatus.js';
import { ChannelList, type Channel } from '../components/ChannelList.js';

// ---- ProviderList ----

describe('ProviderList', () => {
  it('renders providers with status labels', () => {
    const providers: Provider[] = [
      { type: 'anthropic', healthy: true, latencyMs: 120, priority: 1 },
      { type: 'openai', healthy: false, latencyMs: undefined, priority: 2 },
    ];
    const { lastFrame } = render(<ProviderList providers={providers} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('anthropic');
    expect(frame).toContain('openai');
    expect(frame).toContain('online');
    expect(frame).toContain('offline');
  });

  it('shows latency for healthy providers', () => {
    const providers: Provider[] = [
      { type: 'ollama', healthy: true, latencyMs: 45 },
    ];
    const { lastFrame } = render(<ProviderList providers={providers} />);
    expect(lastFrame() ?? '').toContain('45ms');
  });

  it('shows no providers message when list is empty', () => {
    const { lastFrame } = render(<ProviderList providers={[]} />);
    expect(lastFrame() ?? '').toContain('No providers configured');
  });

  it('renders loading state', () => {
    const { lastFrame } = render(<ProviderList providers={[]} loading />);
    expect(lastFrame() ?? '').toContain('Loading');
  });

  it('renders error state', () => {
    const { lastFrame } = render(
      <ProviderList providers={[]} error="Failed to load providers" />
    );
    expect(lastFrame() ?? '').toContain('Failed to load providers');
  });

  it('sorts providers by priority', () => {
    const providers: Provider[] = [
      { type: 'ollama', healthy: true, priority: 3 },
      { type: 'anthropic', healthy: true, priority: 1 },
      { type: 'openai', healthy: true, priority: 2 },
    ];
    const { lastFrame } = render(<ProviderList providers={providers} />);
    const frame = lastFrame() ?? '';
    const aIdx = frame.indexOf('anthropic');
    const oIdx = frame.indexOf('openai');
    const olIdx = frame.indexOf('ollama');
    expect(aIdx).toBeLessThan(oIdx);
    expect(oIdx).toBeLessThan(olIdx);
  });
});

// ---- TaskList ----

describe('TaskList', () => {
  const now = new Date();
  const tasks: Task[] = [
    {
      id: 'task-aaa1',
      title: 'Analyze repository',
      status: 'completed',
      createdAt: new Date(now.getTime() - 60000).toISOString(),
      durationMs: 3200,
    },
    {
      id: 'task-bbb2',
      title: 'Run tests',
      status: 'running',
      createdAt: new Date(now.getTime() - 10000).toISOString(),
    },
    {
      id: 'task-ccc3',
      title: 'Deploy',
      status: 'pending',
      createdAt: new Date(now.getTime() - 5000).toISOString(),
    },
  ];

  it('shows tasks sorted newest first', () => {
    const { lastFrame } = render(<TaskList tasks={tasks} />);
    const frame = lastFrame() ?? '';
    const deployIdx = frame.indexOf('Deploy');
    const analyzeIdx = frame.indexOf('Analyze');
    expect(deployIdx).toBeLessThan(analyzeIdx);
  });

  it('shows correct status labels', () => {
    const { lastFrame } = render(<TaskList tasks={tasks} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('done');
    expect(frame).toContain('running');
    expect(frame).toContain('pending');
  });

  it('truncates long IDs to 8 chars', () => {
    const { lastFrame } = render(<TaskList tasks={tasks} />);
    expect(lastFrame() ?? '').toContain('task-aaa');
    expect(lastFrame() ?? '').not.toContain('task-aaa1-extra');
  });

  it('shows empty message when no tasks', () => {
    const { lastFrame } = render(<TaskList tasks={[]} />);
    expect(lastFrame() ?? '').toContain('No tasks yet');
  });

  it('shows loading state', () => {
    const { lastFrame } = render(<TaskList tasks={[]} loading />);
    expect(lastFrame() ?? '').toContain('Loading');
  });
});

// ---- SystemHealth ----

describe('SystemHealth', () => {
  const metrics: SystemMetrics = {
    version: '2.0.0',
    uptime: 3661,
    mode: 'full',
    healthy: true,
    queueBackend: 'redis',
  };

  it('displays uptime formatted correctly', () => {
    const { lastFrame } = render(<SystemHealth metrics={metrics} />);
    const frame = lastFrame() ?? '';
    // 3661s = 1h 1m
    expect(frame).toContain('1h');
    expect(frame).toContain('1m');
  });

  it('shows healthy status', () => {
    const { lastFrame } = render(<SystemHealth metrics={metrics} />);
    expect(lastFrame() ?? '').toContain('healthy');
  });

  it('shows mode value', () => {
    const { lastFrame } = render(<SystemHealth metrics={metrics} />);
    expect(lastFrame() ?? '').toContain('full');
  });

  it('shows redis queue backend', () => {
    const { lastFrame } = render(<SystemHealth metrics={metrics} />);
    expect(lastFrame() ?? '').toContain('redis');
  });

  it('shows connection error when error prop provided', () => {
    const { lastFrame } = render(
      <SystemHealth metrics={{}} error="ECONNREFUSED" />
    );
    expect(lastFrame() ?? '').toContain('profClaw server');
  });

  it('shows loading state', () => {
    const { lastFrame } = render(<SystemHealth metrics={{}} loading />);
    expect(lastFrame() ?? '').toContain('Loading');
  });

  it('shows degraded warning badge', () => {
    const { lastFrame } = render(
      <SystemHealth metrics={{ ...metrics, degraded: true, healthy: false }} />
    );
    expect(lastFrame() ?? '').toContain('DEGRADED');
  });
});

// ---- HookStatus ----

describe('HookStatus', () => {
  const hooks: Hook[] = [
    { name: 'auth-check', point: 'pre-request', priority: 10, active: true },
    { name: 'rate-limit', point: 'pre-request', priority: 20, active: false },
  ];

  it('renders hook names and points', () => {
    const { lastFrame } = render(<HookStatus hooks={hooks} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('auth-check');
    expect(frame).toContain('pre-request');
  });

  it('shows active/inactive labels', () => {
    const { lastFrame } = render(<HookStatus hooks={hooks} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('active');
    expect(frame).toContain('inactive');
  });

  it('shows empty message when no hooks', () => {
    const { lastFrame } = render(<HookStatus hooks={[]} />);
    expect(lastFrame() ?? '').toContain('No hooks registered');
  });
});

// ---- ChannelList ----

describe('ChannelList', () => {
  const channels: Channel[] = [
    { name: 'slack-main', type: 'slack', status: 'connected', messageCount: 42 },
    { name: 'discord-dev', type: 'discord', status: 'disconnected', messageCount: 0 },
  ];

  it('renders channel names', () => {
    const { lastFrame } = render(<ChannelList channels={channels} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('slack-main');
    expect(frame).toContain('discord-dev');
  });

  it('shows connection status', () => {
    const { lastFrame } = render(<ChannelList channels={channels} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('connected');
    expect(frame).toContain('disconnected');
  });

  it('shows message counts', () => {
    const { lastFrame } = render(<ChannelList channels={channels} />);
    expect(lastFrame() ?? '').toContain('42');
  });

  it('shows empty message when no channels', () => {
    const { lastFrame } = render(<ChannelList channels={[]} />);
    expect(lastFrame() ?? '').toContain('No channels configured');
  });
});
