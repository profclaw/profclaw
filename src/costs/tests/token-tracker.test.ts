import { describe, it, expect, beforeEach, vi } from 'vitest';
import { initTokenTracker, getUsageSummary, resetUsage } from '../token-tracker.js';
import * as taskQueue from '../../queue/task-queue.js';

// Mock the queue event emitter
vi.mock('../../queue/task-queue.js', async (importOriginal) => {
  const actual = await importOriginal() as any;
  let callback: any;
  return {
    ...actual,
    onTaskEvent: vi.fn((cb) => {
      callback = cb;
      return () => {};
    }),
    // Helper to trigger events in tests
    _triggerEvent: (event: any) => callback && callback(event),
  };
});

describe('Token Tracker', () => {
  beforeEach(() => {
    resetUsage();
    vi.clearAllMocks();
  });

  it('should initialize and subscribe to events', () => {
    initTokenTracker();
    expect(taskQueue.onTaskEvent).toHaveBeenCalled();
  });

  it('should track usage when a task is completed', () => {
    initTokenTracker();

    const mockTask = {
      id: 'task-1',
      metadata: { model: 'claude-3-5-sonnet' },
      assignedAgentId: 'agent-1',
    };

    const mockResult = {
      success: true,
      tokensUsed: {
        input: 1000,
        output: 500,
        total: 1500,
      },
    };

    // Trigger the event through the mock
    (taskQueue as any)._triggerEvent({
      type: 'completed',
      task: mockTask,
      result: mockResult,
    });

    const summary = getUsageSummary();
    expect(summary.taskCount).toBe(1);
    expect(summary.totalTokens).toBe(1500);
    expect(summary.inputTokens).toBe(1000);
    expect(summary.outputTokens).toBe(500);
    
    // Claude 3.5 Sonnet: 1000 input ($3/1M) = $0.003, 500 output ($15/1M) = $0.0075
    // Total = $0.0105
    expect(summary.totalCost).toBeCloseTo(0.0105, 6);
  });

  it('should aggregate usage by model', () => {
    initTokenTracker();

    // Task 1: Sonnet
    (taskQueue as any)._triggerEvent({
      type: 'completed',
      task: { metadata: { model: 'claude-3-5-sonnet' } },
      result: { tokensUsed: { input: 1000, output: 500, total: 1500 } },
    });

    // Task 2: GPT-4o
    (taskQueue as any)._triggerEvent({
      type: 'completed',
      task: { metadata: { model: 'gpt-4o' } },
      result: { tokensUsed: { input: 1000, output: 500, total: 1500 } },
    });

    const summary = getUsageSummary();
    expect(summary.byModel['claude-3-5-sonnet']).toBeDefined();
    expect(summary.byModel['gpt-4o']).toBeDefined();
    expect(summary.taskCount).toBe(2);
  });
});
