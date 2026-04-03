/**
 * ChatApp — Full Interactive Chat TUI
 *
 * Layout:
 *   ┌ SessionHeader ──────────────────────────────────┐
 *   │  message history (StreamingMessage list)        │
 *   │  AgentStatus (while streaming)                  │
 *   │  PermissionPrompt (overlay when needed)         │
 *   ├─────────────────────────────────────────────────┤
 *   │  CostBar                                        │
 *   │  > TextInput                                    │
 *   └─────────────────────────────────────────────────┘
 */

import React, { useState, useCallback } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { App } from './App.js';
import { SessionHeader, type SessionHeaderProps } from './components/SessionHeader.js';
import { StreamingMessage } from './components/StreamingMessage.js';
import { AgentStatus, type AgentStatusState } from './components/AgentStatus.js';
import { CostBar } from './components/CostBar.js';
import {
  PermissionPrompt,
  type PermissionDecision,
  type PermissionLevel,
} from './components/PermissionPrompt.js';
import type { ChatMessage } from '../interactive/types.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PendingPermission {
  toolName: string;
  args: Record<string, unknown>;
  permissionLevel: PermissionLevel;
  reason?: string;
  resolve: (decision: PermissionDecision) => void;
}

export interface PickerOption {
  label: string;
  value: string;
  description?: string;
  active?: boolean;
  disabled?: boolean;  // greyed out, not selectable
}

export interface ChatAppProps {
  sessionInfo: Omit<SessionHeaderProps, 'sessionId'> & { sessionId: string };
  tokensUsed: number;
  tokensMax: number;
  estimatedCost?: number;
  agentStatus: AgentStatusState;
  agentAction?: string;
  stepCount: number;
  elapsedMs: number;
  messages: ChatMessage[];
  streamingContent?: string;
  pendingPermission?: PendingPermission;
  availableModels?: PickerOption[];
  availableProviders?: PickerOption[];
  onSubmit: (message: string) => void;
  onPermissionDecision?: (decision: PermissionDecision) => void;
  onCancel?: () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

// Slash command definitions
interface SlashCommand {
  name: string;
  description: string;
  hasSubPicker: boolean;  // opens a secondary picker
  immediate: boolean;     // executes on select (no args)
}

const SLASH_COMMANDS: SlashCommand[] = [
  { name: '/model', description: 'Switch AI model', hasSubPicker: true, immediate: false },
  { name: '/provider', description: 'Switch provider', hasSubPicker: true, immediate: false },
  { name: '/agentic', description: 'Toggle agentic mode (tools + multi-step)', hasSubPicker: false, immediate: true },
  { name: '/effort', description: 'Set effort: low | medium | high', hasSubPicker: false, immediate: false },
  { name: '/thinking', description: 'Toggle thinking display', hasSubPicker: false, immediate: true },
  { name: '/tools', description: 'Toggle tool call verbosity', hasSubPicker: false, immediate: true },
  { name: '/new', description: 'Start a fresh conversation', hasSubPicker: false, immediate: true },
  { name: '/sessions', description: 'List recent conversations', hasSubPicker: false, immediate: true },
  { name: '/resume', description: 'Resume a session by id prefix', hasSubPicker: false, immediate: false },
  { name: '/status', description: 'Server and provider health', hasSubPicker: false, immediate: true },
  { name: '/run', description: 'Execute a shell command', hasSubPicker: false, immediate: false },
  { name: '/retry', description: 'Retry last message', hasSubPicker: false, immediate: true },
  { name: '/diff', description: 'Show unified diff of all file changes this session', hasSubPicker: false, immediate: true },
  { name: '/rewind', description: 'List or restore file snapshots (optional: <path> or --turn <n>)', hasSubPicker: false, immediate: false },
  { name: '/compact', description: 'Compact context — summarize old turns (--llm for LLM summary)', hasSubPicker: false, immediate: true },
  { name: '/branch', description: 'Fork conversation at current turn (or /branch <n> for turn N)', hasSubPicker: false, immediate: false },
  { name: '/branches', description: 'List all branches for this conversation', hasSubPicker: false, immediate: true },
  { name: '/clear', description: 'Clear display', hasSubPicker: false, immediate: true },
  { name: '/help', description: 'Show all commands', hasSubPicker: false, immediate: true },
  { name: '/exit', description: 'Quit', hasSubPicker: false, immediate: true },
];

// Picker state: 'commands' = top-level slash menu, 'sub' = secondary picker (models/providers)
type PickerMode = 'none' | 'commands' | 'sub';

// Max number of history entries to retain
const MAX_HISTORY = 50;

export const ChatApp: React.FC<ChatAppProps> = ({
  sessionInfo,
  tokensUsed,
  tokensMax,
  estimatedCost,
  agentStatus,
  agentAction,
  stepCount,
  elapsedMs,
  messages,
  streamingContent,
  pendingPermission,
  availableModels = [],
  availableProviders = [],
  onSubmit,
  onPermissionDecision,
  onCancel,
}) => {
  const { exit } = useApp();
  const [inputValue, setInputValue] = useState('');
  const [pickerMode, setPickerMode] = useState<PickerMode>('none');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [subPickerTitle, setSubPickerTitle] = useState('');
  const [subPickerItems, setSubPickerItems] = useState<PickerOption[]>([]);
  const [subPickerCommand, setSubPickerCommand] = useState('');

  // ── Multiline state ──────────────────────────────────────────────────────────
  const [isMultiline, setIsMultiline] = useState(false);
  const [multilineLines, setMultilineLines] = useState<string[]>([]);

  // ── Input history state ──────────────────────────────────────────────────────
  const [inputHistory, setInputHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  // Saved draft before navigating history (so Down arrow restores it)
  const [historyDraft, setHistoryDraft] = useState('');

  const isStreaming = agentStatus === 'thinking' || agentStatus === 'executing';

  // Compute matching commands when in command picker mode
  const inCommandPicker = inputValue.startsWith('/') && inputValue.indexOf(' ') === -1 && !isStreaming && !isMultiline;
  const matchingCmds = inCommandPicker
    ? SLASH_COMMANDS.filter(c => c.name.startsWith(inputValue.toLowerCase()))
    : [];

  // Auto-show/hide command picker
  if (inCommandPicker && matchingCmds.length > 0 && pickerMode === 'none') {
    setPickerMode('commands');
    setSelectedIdx(0);
  } else if (!inCommandPicker && pickerMode === 'commands') {
    setPickerMode('none');
  }

  // Current picker items
  const pickerItems: PickerOption[] =
    pickerMode === 'commands'
      ? matchingCmds.map(c => ({ label: c.name, value: c.name, description: c.description }))
      : pickerMode === 'sub'
      ? subPickerItems
      : [];

  // Keep index in bounds
  const maxIdx = Math.max(0, pickerItems.length - 1);
  const safeIdx = Math.min(selectedIdx, maxIdx);

  // Ghost text
  const ghostText = pickerMode === 'commands' && matchingCmds.length > 0
    ? (matchingCmds[safeIdx]?.name ?? '').slice(inputValue.length)
    : '';

  // Open sub-picker for a command
  const openSubPicker = useCallback((cmd: SlashCommand) => {
    if (cmd.name === '/model') {
      setSubPickerTitle(`Select Model (${availableModels.length} available)`);
      setSubPickerItems(availableModels);
      setSubPickerCommand('/model');
    } else if (cmd.name === '/provider') {
      setSubPickerTitle(`Select Provider (${availableProviders.length} available)`);
      setSubPickerItems(availableProviders);
      setSubPickerCommand('/provider');
    }
    setPickerMode('sub');
    setSelectedIdx(0);
    setInputValue('');
  }, [availableModels, availableProviders]);

  // ── Ctrl+C handler — always active to intercept before Ink's default exit ────
  useInput((input, key) => {
    if (!key.ctrl || input !== 'c') return;

    if (isStreaming) {
      // Cancel the in-flight stream; do not exit
      onCancel?.();
      return;
    }

    if (inputValue.length > 0 || isMultiline) {
      // Clear pending input
      setInputValue('');
      setIsMultiline(false);
      setMultilineLines([]);
      setHistoryIndex(-1);
      return;
    }

    // Nothing to cancel — exit normally
    exit();
  });

  // ── Alt+Enter / history navigation ──────────────────────────────────────────
  useInput((input, key) => {
    // Alt+Enter: toggle multiline mode
    if (key.meta && key.return) {
      if (!isMultiline) {
        setIsMultiline(true);
      } else {
        // Cancel multiline; discard accumulated lines
        setIsMultiline(false);
        setMultilineLines([]);
      }
      return;
    }

    // Up arrow: navigate backward through history (picker closed, not in multiline)
    if (key.upArrow && pickerMode === 'none' && !isMultiline) {
      if (inputHistory.length === 0) return;
      if (historyIndex === -1) {
        setHistoryDraft(inputValue);
      }
      const newIdx = historyIndex === -1
        ? inputHistory.length - 1
        : Math.max(0, historyIndex - 1);
      setHistoryIndex(newIdx);
      setInputValue(inputHistory[newIdx] ?? '');
      return;
    }

    // Down arrow: navigate forward through history (picker closed, not in multiline)
    if (key.downArrow && pickerMode === 'none' && !isMultiline) {
      if (historyIndex === -1) return;
      const newIdx = historyIndex + 1;
      if (newIdx >= inputHistory.length) {
        setHistoryIndex(-1);
        setInputValue(historyDraft);
      } else {
        setHistoryIndex(newIdx);
        setInputValue(inputHistory[newIdx] ?? '');
      }
      return;
    }

    // Ctrl+Enter in multiline mode: submit all accumulated lines + current line
    if (isMultiline && key.ctrl && key.return) {
      const allLines = [...multilineLines, inputValue].filter(l => l.length > 0);
      if (allLines.length === 0) return;
      const combined = allLines.join('\n');
      setIsMultiline(false);
      setMultilineLines([]);
      setInputValue('');
      setHistoryIndex(-1);
      setHistoryDraft('');
      setInputHistory(prev => {
        const next = [...prev, combined];
        return next.length > MAX_HISTORY ? next.slice(next.length - MAX_HISTORY) : next;
      });
      onSubmit(combined);
      return;
    }

    void input;
  }, { isActive: !isStreaming && pendingPermission === undefined });

  // ── Picker keyboard navigation ───────────────────────────────────────────────
  useInput((_input, key) => {
    if (pickerMode === 'none' || pickerItems.length === 0) return;

    if (key.upArrow) {
      setSelectedIdx(prev => {
        let next = prev <= 0 ? pickerItems.length - 1 : prev - 1;
        // Skip disabled items
        let attempts = 0;
        while (pickerItems[next] && pickerItems[next]?.disabled && attempts < pickerItems.length) {
          next = next <= 0 ? pickerItems.length - 1 : next - 1;
          attempts++;
        }
        return next;
      });
    } else if (key.downArrow) {
      setSelectedIdx(prev => {
        let next = prev >= pickerItems.length - 1 ? 0 : prev + 1;
        let attempts = 0;
        while (pickerItems[next] && pickerItems[next]?.disabled && attempts < pickerItems.length) {
          next = next >= pickerItems.length - 1 ? 0 : next + 1;
          attempts++;
        }
        return next;
      });
    } else if (key.escape) {
      setPickerMode('none');
      setInputValue('');
      setSelectedIdx(0);
    }
  }, { isActive: pickerMode !== 'none' && !isStreaming });

  const handleSubmit = useCallback(
    (value: string) => {
      // In multiline mode, Enter appends the current line and moves to the next
      if (isMultiline) {
        setMultilineLines(prev => [...prev, value]);
        setInputValue('');
        return;
      }

      const trimmed = value.trim();

      // Sub-picker: Enter selects the highlighted option (skip disabled)
      if (pickerMode === 'sub' && subPickerItems.length > 0) {
        const item = subPickerItems[safeIdx];
        if (item && !(item.disabled)) {
          setPickerMode('none');
          setInputValue('');
          setSelectedIdx(0);
          onSubmit(`${subPickerCommand} ${item.value}`);
        }
        return;
      }

      // Command picker: Enter selects highlighted command
      if (pickerMode === 'commands' && matchingCmds.length > 0) {
        const cmd = matchingCmds[safeIdx];
        if (cmd) {
          if (cmd.hasSubPicker) {
            openSubPicker(cmd);
          } else if (cmd.immediate) {
            setPickerMode('none');
            setInputValue('');
            setSelectedIdx(0);
            if (cmd.name === '/exit') { exit(); return; }
            onSubmit(cmd.name);
          }
        }
        return;
      }

      if (trimmed.length === 0) return;
      if (trimmed === '/exit' || trimmed === '/quit') { exit(); return; }

      setInputValue('');
      setSelectedIdx(0);
      setPickerMode('none');
      setHistoryIndex(-1);
      setHistoryDraft('');
      setInputHistory(prev => {
        const next = [...prev, trimmed];
        return next.length > MAX_HISTORY ? next.slice(next.length - MAX_HISTORY) : next;
      });
      onSubmit(trimmed);
    },
    [
      onSubmit,
      exit,
      pickerMode,
      safeIdx,
      matchingCmds,
      subPickerItems,
      subPickerCommand,
      openSubPicker,
      isMultiline,
    ]
  );

  const handlePermission = useCallback(
    (decision: PermissionDecision) => {
      if (pendingPermission) {
        pendingPermission.resolve(decision);
      }
      onPermissionDecision?.(decision);
    },
    [pendingPermission, onPermissionDecision]
  );

  // ── Prompt prefix ────────────────────────────────────────────────────────────
  const promptPrefix = isMultiline ? '... ' : '> ';

  return (
    <App>
      {/* Session header */}
      <SessionHeader
        model={sessionInfo.model}
        provider={sessionInfo.provider}
        sessionId={sessionInfo.sessionId}
        mode={sessionInfo.mode}
      />

      {/* Message history */}
      <Box flexDirection="column" flexGrow={1} paddingY={1}>
        {messages.map((msg, idx) => (
          <StreamingMessage
            key={idx}
            role={msg.role === 'system' ? 'assistant' : msg.role}
            content={msg.content}
            model={msg.model}
          />
        ))}

        {/* Streaming assistant response */}
        {streamingContent !== undefined && streamingContent.length > 0 && (
          <StreamingMessage
            role="assistant"
            content={streamingContent}
            isStreaming
            model={sessionInfo.model}
          />
        )}
      </Box>

      {/* Agent status */}
      {(isStreaming || agentStatus === 'complete') && (
        <AgentStatus
          status={agentStatus}
          currentAction={agentAction}
          stepCount={stepCount}
          tokensUsed={tokensUsed}
          elapsedMs={elapsedMs}
        />
      )}

      {/* Permission prompt overlay */}
      {pendingPermission !== undefined && (
        <PermissionPrompt
          toolName={pendingPermission.toolName}
          args={pendingPermission.args}
          permissionLevel={pendingPermission.permissionLevel}
          reason={pendingPermission.reason}
          onDecision={handlePermission}
        />
      )}

      {/* Picker dropdown (commands or sub-picker) */}
      {pickerMode !== 'none' && pickerItems.length > 0 && (() => {
        const MAX_VISIBLE = 6;
        const total = pickerItems.length;
        const start = Math.max(0, Math.min(safeIdx - Math.floor(MAX_VISIBLE / 2), total - MAX_VISIBLE));
        const visible = pickerItems.slice(start, start + MAX_VISIBLE);
        const showScrollUp = start > 0;
        const showScrollDown = start + MAX_VISIBLE < total;
        const title = pickerMode === 'sub' ? subPickerTitle : 'Commands';

        return (
          <Box flexDirection="column" paddingX={2}>
            <Box borderStyle="round" borderColor="cyan" flexDirection="column" paddingX={1}>
              <Text bold color="cyan">{' '}{title}</Text>
              <Text dimColor>{' ─'.repeat(20)}</Text>
              {showScrollUp && <Text dimColor>  ↑ more ({start} above)</Text>}
              {visible.map((item) => {
                const realIdx = pickerItems.indexOf(item);
                const isSelected = realIdx === safeIdx;
                const isDisabled = item.disabled;
                return (
                  <Box key={item.value + (isDisabled ? '-disabled' : '')} gap={1}>
                    <Text
                      color={isDisabled ? 'gray' : isSelected ? 'cyan' : undefined}
                      bold={isSelected && !isDisabled}
                      inverse={isSelected && !isDisabled}
                      dimColor={isDisabled}
                      strikethrough={isDisabled}
                    >
                      {' '}{item.label.padEnd(20)}
                    </Text>
                    {item.description && <Text dimColor>{item.description}</Text>}
                    {item.active && !isDisabled && <Text color="green"> ●</Text>}
                    {isDisabled && <Text color="gray"> ⊘</Text>}
                  </Box>
                );
              })}
              {showScrollDown && <Text dimColor>  ↓ more ({total - start - MAX_VISIBLE} below)</Text>}
              <Text dimColor>  ↑↓ navigate · Enter select · Esc back</Text>
            </Box>
          </Box>
        );
      })()}

      {/* Accumulated multiline lines displayed above the active input line */}
      {isMultiline && multilineLines.length > 0 && (
        <Box flexDirection="column" paddingX={1}>
          {multilineLines.map((line, idx) => (
            <Box key={idx} flexDirection="row" gap={0}>
              <Text color="yellow" bold>{'... '}</Text>
              <Text>{line}</Text>
            </Box>
          ))}
        </Box>
      )}

      {/* Input with ghost text */}
      <Box flexDirection="row" gap={0} paddingX={1}>
        <Text color={isMultiline ? 'yellow' : 'cyan'} bold>{promptPrefix}</Text>
        {pendingPermission === undefined && !isStreaming ? (
          <Box flexDirection="row">
            <TextInput
              value={inputValue}
              onChange={(val) => { setInputValue(val); if (!isMultiline) setSelectedIdx(0); }}
              onSubmit={handleSubmit}
              placeholder={
                isMultiline
                  ? 'Add line... (Ctrl+Enter to send · Alt+Enter to cancel)'
                  : 'Message profClaw... (/ for commands)'
              }
            />
            {ghostText.length > 0 && <Text dimColor>{ghostText}</Text>}
          </Box>
        ) : (
          <Text dimColor>
            {pendingPermission !== undefined
              ? 'Waiting for permission...'
              : 'Agent is working... (Ctrl+C to cancel)'}
          </Text>
        )}
      </Box>

      {/* Multiline mode hint */}
      {isMultiline && (
        <Box paddingX={1}>
          <Text dimColor>  multiline — Enter adds line · Ctrl+Enter sends · Alt+Enter cancels</Text>
        </Box>
      )}

      {/* Cost bar at very bottom */}
      <CostBar
        tokensUsed={tokensUsed}
        tokensMax={tokensMax}
        estimatedCost={estimatedCost}
      />
    </App>
  );
};
