import { describe, it, expect, vi } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  createContextualLogger: vi.fn(() => ({
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  })),
}));

// Mock the storage client
const mockExecute = vi.fn(() => Promise.resolve({ rows: [], rowsAffected: 0 }));
vi.mock('../../storage/index.js', () => ({
  getClient: vi.fn(() => ({ execute: mockExecute })),
}));

import {
  initTeamsTables,
  createTeam,
  getTeam,
  listMembers,
  canMemberSpend,
  type Team,
  type TeamRole,
} from '../index.js';

describe('Teams Module', () => {
  describe('initTeamsTables', () => {
    it('creates tables without error', async () => {
      await initTeamsTables();
      // Should call execute for CREATE TABLE + indexes
      expect(mockExecute).toHaveBeenCalled();
      const calls = mockExecute.mock.calls.map(c => String(c[0]?.sql ?? c[0]));
      expect(calls.some(c => c.includes('CREATE TABLE IF NOT EXISTS teams'))).toBe(true);
      expect(calls.some(c => c.includes('CREATE TABLE IF NOT EXISTS team_members'))).toBe(true);
      expect(calls.some(c => c.includes('CREATE TABLE IF NOT EXISTS team_invites'))).toBe(true);
    });
  });

  describe('type safety', () => {
    it('TeamRole type covers all roles', () => {
      const roles: TeamRole[] = ['owner', 'admin', 'member', 'viewer'];
      expect(roles).toHaveLength(4);
    });

    it('Team interface has budget fields', () => {
      const team: Partial<Team> = {
        monthlyBudgetUsd: 100,
        dailyBudgetUsd: 10,
        budgetAlertThresholds: [50, 80, 100],
        smartRoutingEnabled: true,
      };
      expect(team.monthlyBudgetUsd).toBe(100);
      expect(team.smartRoutingEnabled).toBe(true);
    });
  });

  describe('canMemberSpend', () => {
    it('returns not found for nonexistent team', async () => {
      mockExecute.mockResolvedValueOnce({ rows: [] }); // getTeam returns null
      const result = await canMemberSpend('fake-team', 'fake-user', 0.01);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('not found');
    });
  });
});
