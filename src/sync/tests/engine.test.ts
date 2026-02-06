import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SyncEngine } from '../engine.js';
import { LinearSyncAdapter } from '../adapters/linear.js';
import * as syncConfig from '../config.js';

vi.mock('../adapters/linear.js', () => ({
  LinearSyncAdapter: class {
    connect = vi.fn().mockResolvedValue(undefined);
    disconnect = vi.fn().mockResolvedValue(undefined);
    isConnected = vi.fn().mockReturnValue(true);
    healthCheck = vi.fn().mockResolvedValue({ healthy: true, latencyMs: 10 });
    createTicket = vi.fn().mockResolvedValue({ externalId: 'ext-1', externalUrl: 'http://ext' });
    updateTicket = vi.fn().mockResolvedValue(undefined);
    listTickets = vi.fn().mockResolvedValue({ tickets: [] });
    mapStatusFromExternal = vi.fn().mockReturnValue('todo');
    mapPriorityFromExternal = vi.fn().mockReturnValue('medium');
    mapTypeFromExternal = vi.fn().mockReturnValue('task');
  }
}));

vi.mock('../config.js', () => ({
  loadSyncConfig: vi.fn().mockReturnValue({}),
  toSyncEngineConfig: vi.fn((c) => ({ platforms: { linear: {} } })),
  isSyncEnabled: vi.fn().mockReturnValue(true),
}));

describe('SyncEngine', () => {
  let engine: SyncEngine;

  beforeEach(async () => {
    vi.clearAllMocks();
    engine = new SyncEngine({
        platforms: {
            linear: { apiKey: 'test' } as any
        }
    });
    await engine.initialize();
  });

  it('should initialize and add adapters', async () => {
    // Already done in beforeEach
    expect(engine.getStatus().adapters.linear).toBeDefined();
  });

  it('should push a ticket to external platform', async () => {
    const ticket: any = { id: 't1', title: 'Test Ticket' };
    const result = await engine.pushTicket(ticket, 'linear');
    
    expect(result.success).toBe(true);
    expect(result.externalId).toBe('ext-1');
  });

  it('should detect and resolve conflicts (latest_wins)', async () => {
    const customEngine = new SyncEngine({
      conflictStrategy: 'latest_wins',
      platforms: { linear: {} as any }
    });
    await customEngine.initialize();

    const localTicket: any = {
      id: 't1',
      updatedAt: '2026-02-01T13:00:00Z',
      title: 'Local Title'
    };

    const remoteUpdates: any = { title: 'Remote Title' };
    const externalTicket: any = {
      platform: 'linear',
      externalId: 'e1',
      updatedAt: new Date('2026-02-01T12:00:00Z'), // Older than local
      title: 'Remote Title'
    };

    // @ts-ignore - testing private method
    const conflict = await customEngine.detectConflict(localTicket, remoteUpdates, externalTicket);
    expect(conflict).not.toBeNull();
    expect(conflict?.remoteValue).toBe('Remote Title');

    // @ts-ignore
    const resolved = customEngine.resolveConflict(conflict!);
    expect(resolved).toBe(true);
    expect(conflict?.resolution).toBe('local');
  });

  it('should handle manual conflict resolution', async () => {
    const customEngine = new SyncEngine({
        conflictStrategy: 'manual',
        platforms: { linear: {} as any }
    });
    await customEngine.initialize();

    const localTicket: any = { id: 't1', updatedAt: '2026-02-01T12:00:00Z', title: 'L' };
    const externalTicket: any = { platform: 'linear', updatedAt: new Date('2026-02-01T11:00:00Z'), title: 'R' };
    
    // @ts-ignore
    const conflict = await customEngine.detectConflict(localTicket, { title: 'R' }, externalTicket);
    // @ts-ignore
    const resolved = customEngine.resolveConflict(conflict!);
    expect(resolved).toBe(false);
  });

  it('should pull tickets from platform', async () => {
    const mockTickets = [
      { externalId: 'e1', title: 'External 1', updatedAt: new Date() }
    ];
    // @ts-ignore
    const adapter = engine.adapters.get('linear')!;
    (adapter.listTickets as any).mockResolvedValue({ tickets: mockTickets });
    
    // Mock processExternalTicket to avoid DB calls
    // @ts-ignore
    vi.spyOn(engine, 'processExternalTicket').mockResolvedValue({ success: true, action: 'created' });

    const results = await engine.pullFromPlatform('linear');
    expect(results.length).toBe(1);
    expect(results[0].success).toBe(true);
  });
});
