/**
 * Tests for Unified Queue Facade
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the deployment module
vi.mock('../../core/deployment.js', () => ({
  shouldUseRedis: vi.fn(() => false),
}));

// Mock logger
vi.mock('../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  createContextualLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

// Mock ioredis to prevent actual Redis connections
vi.mock('ioredis', () => ({
  default: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockRejectedValue(new Error('No Redis')),
    disconnect: vi.fn(),
  })),
}));

// Mock the memory queue module
const mockInitTaskQueue = vi.fn().mockResolvedValue(undefined);
const mockAddTask = vi.fn().mockResolvedValue({
  id: 'test-id',
  title: 'Test',
  status: 'queued',
  priority: 2,
  source: 'api',
  createdAt: new Date(),
  updatedAt: new Date(),
  attempts: 0,
  maxAttempts: 3,
  labels: [],
  metadata: {},
});
const mockGetTask = vi.fn().mockReturnValue(undefined);
const mockGetTasks = vi.fn().mockReturnValue([]);
const mockOnTaskEvent = vi.fn().mockReturnValue(() => {});
const mockRegisterSSEBroadcaster = vi.fn();
const mockCancelTask = vi.fn().mockResolvedValue(false);
const mockRetryTask = vi.fn().mockResolvedValue(null);
const mockCloseTaskQueue = vi.fn().mockResolvedValue(undefined);

vi.mock('../memory-queue.js', () => ({
  initTaskQueue: mockInitTaskQueue,
  addTask: mockAddTask,
  getTask: mockGetTask,
  getTasks: mockGetTasks,
  onTaskEvent: mockOnTaskEvent,
  registerSSEBroadcaster: mockRegisterSSEBroadcaster,
  cancelTask: mockCancelTask,
  retryTask: mockRetryTask,
  closeTaskQueue: mockCloseTaskQueue,
}));

// Mock task-queue.js (BullMQ) — won't be used in these tests
vi.mock('../task-queue.js', () => ({}));

describe('Unified Queue Facade', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('initializes with memory backend when Redis is unavailable', async () => {
    // Fresh import to reset module state
    const queue = await import('../index.js');
    await queue.initQueue();
    expect(mockInitTaskQueue).toHaveBeenCalled();
  });

  it('getQueueType returns the backend type', async () => {
    const queue = await import('../index.js');
    // After init, should be 'memory'
    const type = queue.getQueueType();
    expect(type === 'memory' || type === null).toBe(true);
  });
});
