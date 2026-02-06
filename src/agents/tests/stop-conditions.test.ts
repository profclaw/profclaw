import { describe, it, expect } from 'vitest';
import { 
  stepCountIs, 
  budgetExceeded, 
  taskCompleted, 
  noToolCallsInLastStep,
  toolCallFailed,
  consecutiveFailures,
  anyOf,
  allOf
} from '../stop-conditions.js';
import type { AgentState } from '../types.js';

describe('Stop Conditions', () => {
  const baseState: AgentState = {
    sessionId: 's1',
    conversationId: 'c1',
    status: 'running',
    goal: 'test',
    currentStep: 1,
    maxBudget: 1000,
    usedBudget: 100,
    toolCallHistory: [],
    pendingToolCalls: [],
    context: {},
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  it('stepCountIs should stop when limit reached', () => {
    const condition = stepCountIs(5);
    expect(condition.check({ ...baseState, currentStep: 4 }, null)).toBe(false);
    expect(condition.check({ ...baseState, currentStep: 5 }, null)).toBe(true);
  });

  it('budgetExceeded should stop when budget spent', () => {
    const condition = budgetExceeded();
    expect(condition.check({ ...baseState, usedBudget: 999 }, null)).toBe(false);
    expect(condition.check({ ...baseState, usedBudget: 1000 }, null)).toBe(true);
  });

  it('taskCompleted should stop when complete_task succeeds', () => {
    const condition = taskCompleted();
    const stateWithCall: AgentState = {
      ...baseState,
      toolCallHistory: [{
        id: '1',
        name: 'complete_task',
        args: {},
        status: 'executed',
        result: { complete: true },
        startedAt: 0
      }]
    };
    expect(condition.check(baseState, null)).toBe(false);
    expect(condition.check(stateWithCall, null)).toBe(true);
  });

  it('noToolCallsInLastStep should stop when no tools called', () => {
    const condition = noToolCallsInLastStep();
    const resultWithTools = { steps: [{ toolCalls: [{}] }] };
    const resultEmpty = { steps: [{ toolCalls: [] }] };
    
    expect(condition.check(baseState, resultWithTools)).toBe(false);
    expect(condition.check(baseState, resultEmpty)).toBe(true);
  });

  it('toolCallFailed should stop if any tool failed', () => {
    const condition = toolCallFailed();
    const stateFailed: AgentState = {
      ...baseState,
      toolCallHistory: [{
        id: '1',
        name: 'test',
        args: {},
        status: 'failed',
        startedAt: 0
      }]
    };
    expect(condition.check(baseState, null)).toBe(false);
    expect(condition.check(stateFailed, null)).toBe(true);
  });

  it('consecutiveFailures should work', () => {
    const condition = consecutiveFailures(2);
    const stateOneFail: AgentState = {
      ...baseState,
      toolCallHistory: [{ id: '1', name: 't', args: {}, status: 'failed', startedAt: 0 }]
    };
    const stateTwoFail: AgentState = {
      ...baseState,
      toolCallHistory: [
        { id: '1', name: 't', args: {}, status: 'failed', startedAt: 0 },
        { id: '2', name: 't', args: {}, status: 'failed', startedAt: 0 }
      ]
    };
    expect(condition.check(stateOneFail, null)).toBe(false);
    expect(condition.check(stateTwoFail, null)).toBe(true);
  });

  it('anyOf should work', async () => {
    const condition = anyOf([stepCountIs(5), budgetExceeded()]);
    expect(await condition.check({ ...baseState, currentStep: 5 }, null)).toBe(true);
    expect(await condition.check({ ...baseState, usedBudget: 1000 }, null)).toBe(true);
    expect(await condition.check(baseState, null)).toBe(false);
  });
});
