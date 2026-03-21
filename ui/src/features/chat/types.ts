/**
 * Chat Feature Types
 */

import type { ChatMessage } from '@/core/api/client';
import type { LucideIcon } from 'lucide-react';

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  result?: unknown;
  status?: 'pending' | 'running' | 'success' | 'error';
  duration?: number;
}

export interface MessageRouting {
  /** Human-readable label, e.g. "Haiku" */
  modelLabel: string;
  /** Savings percentage vs the default model (0-100) */
  savingsPercent?: number;
  /** Routing tier used, e.g. "fast" | "balanced" | "powerful" */
  tier?: string;
}

export interface Message extends ChatMessage {
  id: string;
  isLoading?: boolean;
  error?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cost?: number;
  };
  images?: string[];
  toolCalls?: ToolCall[];
  /** Smart routing info - only present when the router selected a non-default model */
  routing?: MessageRouting;
  /** Proactive follow-up suggestions after task completion */
  suggestions?: Array<{
    id: string;
    type: string;
    message: string;
    confidence: number;
    action?: { label: string; command: string };
  }>;
}

export type ProviderStatus = 'stable' | 'beta' | 'experimental';

export interface ProviderInfo {
  type: string;
  name: string;
  description: string;
  Logo: React.ComponentType<{ className?: string }>;
  setupUrl: string;
  envVar: string;
  placeholder: string;
  status?: ProviderStatus; // Stability status for display
  requiresBaseUrl?: boolean; // For providers like Azure Foundry
}

export interface ChatPreset {
  id: string;
  name: string;
  description: string;
  icon: string;
  examples: string[];
}

export interface QuickAction {
  id: string;
  label: string;
  icon: string;
  prompt: string;
}

export interface Conversation {
  id: string;
  title: string;
  presetId: string;
  preview?: string;
  messageCount: number;
  updatedAt: string;
}

export interface MemoryStats {
  stats: {
    messageCount: number;
    estimatedTokens: number;
    contextWindow: number;
    usagePercentage: number;
    needsCompaction: boolean;
    summaryCount: number;
  };
}

export interface Provider {
  type: string;
  healthy: boolean;
}

export interface ModelAlias {
  alias: string;
  provider: string;
}

// Preset icons mapping type
export type PresetIconMap = Record<string, LucideIcon>;
