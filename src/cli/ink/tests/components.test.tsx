/**
 * Ink TUI Component Tests
 *
 * Tests for core Ink TUI components using ink-testing-library.
 * Verifies rendering, props, and interaction behavior.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';

import { AgentStatus } from '../components/AgentStatus.js';
import { ToolCall } from '../components/ToolCall.js';
import { PlanView } from '../components/PlanView.js';
import { CostBar } from '../components/CostBar.js';
import { SessionHeader } from '../components/SessionHeader.js';
import { StreamingMessage } from '../components/StreamingMessage.js';

// ── AgentStatus ────────────────────────────────────────────────────────────────

describe('AgentStatus', () => {
  it('renders current action when provided', () => {
    const { lastFrame } = render(
      <AgentStatus
        status="thinking"
        currentAction="Reading file system"
        stepCount={3}
        tokensUsed={1500}
        elapsedMs={2300}
      />
    );
    expect(lastFrame()).toContain('Reading file system');
  });

  it('shows step count and elapsed time', () => {
    const { lastFrame } = render(
      <AgentStatus
        status="executing"
        stepCount={5}
        tokensUsed={4000}
        elapsedMs={5000}
      />
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('step 5');
    expect(frame).toContain('5.0s');
  });

  it('shows complete state with checkmark', () => {
    const { lastFrame } = render(
      <AgentStatus
        status="complete"
        stepCount={10}
        tokensUsed={8000}
        elapsedMs={12000}
      />
    );
    expect(lastFrame()).toContain('complete');
    expect(lastFrame()).toContain('✓');
  });

  it('shows error state with cross', () => {
    const { lastFrame } = render(
      <AgentStatus
        status="error"
        stepCount={2}
        tokensUsed={500}
        elapsedMs={800}
      />
    );
    expect(lastFrame()).toContain('error');
    expect(lastFrame()).toContain('✗');
  });

  it('formats tokens in K notation', () => {
    const { lastFrame } = render(
      <AgentStatus
        status="idle"
        stepCount={1}
        tokensUsed={15000}
        elapsedMs={1000}
      />
    );
    expect(lastFrame()).toContain('15.0K');
  });
});

// ── ToolCall ───────────────────────────────────────────────────────────────────

describe('ToolCall', () => {
  it('shows tool name', () => {
    const { lastFrame } = render(
      <ToolCall
        name="read_file"
        args={{ path: '/foo/bar.ts' }}
        status="success"
      />
    );
    expect(lastFrame()).toContain('read_file');
  });

  it('shows success icon for success status', () => {
    const { lastFrame } = render(
      <ToolCall
        name="write_file"
        args={{ path: '/tmp/out.txt', content: 'hello' }}
        status="success"
        durationMs={120}
      />
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('✓');
    expect(frame).toContain('120ms');
  });

  it('shows error icon for error status', () => {
    const { lastFrame } = render(
      <ToolCall
        name="exec"
        args={{ command: 'rm -rf /' }}
        result="Permission denied"
        status="error"
      />
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('✗');
    expect(frame).toContain('Permission denied');
  });

  it('shows timeout icon for timeout status', () => {
    const { lastFrame } = render(
      <ToolCall
        name="web_fetch"
        args={{ url: 'https://example.com' }}
        status="timeout"
        durationMs={30000}
      />
    );
    expect(lastFrame()).toContain('⏱');
  });

  it('truncates long args preview', () => {
    const longValue = 'a'.repeat(100);
    const { lastFrame } = render(
      <ToolCall
        name="search"
        args={{ query: longValue }}
        status="pending"
      />
    );
    const frame = lastFrame() ?? '';
    // Should not show full 100-char value
    expect(frame.length).toBeLessThan(200);
  });
});

// ── PlanView ───────────────────────────────────────────────────────────────────

describe('PlanView', () => {
  const steps = [
    { index: 0, description: 'Analyze codebase', status: 'completed' as const },
    { index: 1, description: 'Write tests', status: 'in_progress' as const },
    { index: 2, description: 'Implement feature', status: 'pending' as const },
    { index: 3, description: 'Deploy', status: 'failed' as const },
  ];

  it('renders all step descriptions', () => {
    const { lastFrame } = render(<PlanView steps={steps} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Analyze codebase');
    expect(frame).toContain('Write tests');
    expect(frame).toContain('Implement feature');
    expect(frame).toContain('Deploy');
  });

  it('shows checkmark for completed steps', () => {
    const { lastFrame } = render(<PlanView steps={steps} />);
    expect(lastFrame()).toContain('✓');
  });

  it('shows circle for in_progress steps', () => {
    const { lastFrame } = render(<PlanView steps={steps} />);
    expect(lastFrame()).toContain('◐');
  });

  it('shows dash for pending steps', () => {
    const { lastFrame } = render(<PlanView steps={steps} />);
    expect(lastFrame()).toContain('○');
  });

  it('shows cross for failed steps', () => {
    const { lastFrame } = render(<PlanView steps={steps} />);
    expect(lastFrame()).toContain('✗');
  });

  it('renders optional title', () => {
    const { lastFrame } = render(
      <PlanView title="Refactoring Plan" steps={steps} />
    );
    expect(lastFrame()).toContain('Refactoring Plan');
  });

  it('renders step detail when provided', () => {
    const stepsWithDetail = [
      {
        index: 0,
        description: 'Run tests',
        status: 'in_progress' as const,
        detail: '14 of 20 passed',
      },
    ];
    const { lastFrame } = render(<PlanView steps={stepsWithDetail} />);
    expect(lastFrame()).toContain('14 of 20 passed');
  });
});

// ── CostBar ────────────────────────────────────────────────────────────────────

describe('CostBar', () => {
  it('shows tokens used and max', () => {
    const { lastFrame } = render(
      <CostBar tokensUsed={20000} tokensMax={100000} />
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('20.0K');
    expect(frame).toContain('100.0K');
  });

  it('shows estimated cost when provided', () => {
    const { lastFrame } = render(
      <CostBar tokensUsed={5000} tokensMax={100000} estimatedCost={0.0042} />
    );
    expect(lastFrame()).toContain('$0.0042');
  });

  it('shows 0% when no tokens used', () => {
    const { lastFrame } = render(
      <CostBar tokensUsed={0} tokensMax={100000} />
    );
    expect(lastFrame()).toContain('0%');
  });

  it('shows 100% when max tokens reached', () => {
    const { lastFrame } = render(
      <CostBar tokensUsed={100000} tokensMax={100000} />
    );
    expect(lastFrame()).toContain('100%');
  });
});

// ── SessionHeader ──────────────────────────────────────────────────────────────

describe('SessionHeader', () => {
  it('displays model name', () => {
    const { lastFrame } = render(
      <SessionHeader
        model="claude-sonnet-4-6"
        provider="anthropic"
        sessionId="abc123def456"
        mode="chat"
      />
    );
    expect(lastFrame()).toContain('claude-sonnet-4-6');
  });

  it('displays provider', () => {
    const { lastFrame } = render(
      <SessionHeader
        model="gpt-4o"
        provider="openai"
        sessionId="xyz789"
        mode="pro"
      />
    );
    expect(lastFrame()).toContain('openai');
  });

  it('displays shortened session ID', () => {
    const { lastFrame } = render(
      <SessionHeader
        model="claude-haiku"
        provider="anthropic"
        sessionId="abc12345longSessionId"
        mode="pico"
      />
    );
    // Should show first 8 chars
    expect(lastFrame()).toContain('abc12345');
  });

  it('displays mode', () => {
    const { lastFrame } = render(
      <SessionHeader
        model="mistral"
        provider="ollama"
        sessionId="sess001"
        mode="agentic"
      />
    );
    expect(lastFrame()).toContain('agentic');
  });
});

// ── StreamingMessage ───────────────────────────────────────────────────────────

describe('StreamingMessage', () => {
  it('renders plain text content', () => {
    const { lastFrame } = render(
      <StreamingMessage role="assistant" content="Hello, world!" />
    );
    expect(lastFrame()).toContain('Hello, world!');
  });

  it('renders user role', () => {
    const { lastFrame } = render(
      <StreamingMessage role="user" content="What is 2+2?" />
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('You');
    expect(frame).toContain('What is 2+2?');
  });

  it('renders assistant role with model', () => {
    const { lastFrame } = render(
      <StreamingMessage
        role="assistant"
        content="The answer is 4."
        model="claude-sonnet-4-6"
      />
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('profClaw');
    expect(frame).toContain('claude-sonnet-4-6');
  });

  it('shows streaming cursor when isStreaming is true', () => {
    const { lastFrame } = render(
      <StreamingMessage
        role="assistant"
        content="Partial respon"
        isStreaming
      />
    );
    expect(lastFrame()).toContain('▌');
  });

  it('does not show cursor when not streaming', () => {
    const { lastFrame } = render(
      <StreamingMessage
        role="assistant"
        content="Complete response."
        isStreaming={false}
      />
    );
    expect(lastFrame()).not.toContain('▌');
  });

  it('renders bold markdown', () => {
    const { lastFrame } = render(
      <StreamingMessage role="assistant" content="This is **important** text." />
    );
    // Text should be present (bold rendered via Ink Text bold prop)
    expect(lastFrame()).toContain('important');
  });

  it('renders heading markdown', () => {
    const { lastFrame } = render(
      <StreamingMessage role="assistant" content="## Section Title" />
    );
    expect(lastFrame()).toContain('Section Title');
  });
});
