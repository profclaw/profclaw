/**
 * useSessionStream Hook
 *
 * Provides real-time streaming of tool execution session output via SSE.
 * Connects to /api/tools/sessions/:sessionId/stream and receives live updates.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { logger } from '../../lib/logger';

// Types for session stream events
export interface SessionStreamInit {
  sessionId: string;
  toolName: string;
  status: string;
  command?: string;
  startedAt?: number;
  existingOutput: string;
}

export interface SessionStreamOutput {
  stream: 'stdout' | 'stderr';
  data: string;
  timestamp: number;
}

export interface SessionStreamComplete {
  status: 'completed' | 'failed' | 'killed' | 'timeout';
  exitCode?: number;
  exitSignal?: string;
  completedAt?: number;
  output: string;
}

export interface SessionStreamState {
  connected: boolean;
  sessionId: string | null;
  toolName: string | null;
  status: 'connecting' | 'running' | 'completed' | 'failed' | 'killed' | 'timeout' | 'disconnected';
  output: string;
  exitCode?: number;
  exitSignal?: string;
  error?: string;
}

export interface UseSessionStreamOptions {
  onOutput?: (data: SessionStreamOutput) => void;
  onComplete?: (data: SessionStreamComplete) => void;
  onError?: (error: string) => void;
  autoReconnect?: boolean;
}

const API_BASE = '/api';

export function useSessionStream(
  sessionId: string | null,
  options: UseSessionStreamOptions = {}
) {
  const { onOutput, onComplete, onError, autoReconnect = false } = options;

  const [state, setState] = useState<SessionStreamState>({
    connected: false,
    sessionId: null,
    toolName: null,
    status: 'disconnected',
    output: '',
  });

  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const outputRef = useRef<string>('');

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setState((prev) => ({
      ...prev,
      connected: false,
      status: 'disconnected',
    }));
  }, []);

  const connect = useCallback(
    (id: string) => {
      // Clean up existing connection
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }

      outputRef.current = '';
      setState({
        connected: false,
        sessionId: id,
        toolName: null,
        status: 'connecting',
        output: '',
      });

      const eventSource = new EventSource(`${API_BASE}/tools/sessions/${id}/stream`);
      eventSourceRef.current = eventSource;

      // Handle initial state
      eventSource.addEventListener('init', (event) => {
        try {
          const data: SessionStreamInit = JSON.parse(event.data);
          outputRef.current = data.existingOutput || '';
          setState((prev) => ({
            ...prev,
            connected: true,
            sessionId: data.sessionId,
            toolName: data.toolName,
            status: data.status === 'running' ? 'running' : 'connecting',
            output: outputRef.current,
          }));
        } catch (e) {
          logger.error('[SessionStream] Failed to parse init event', e);
        }
      });

      // Handle output events
      eventSource.addEventListener('output', (event) => {
        try {
          const data: SessionStreamOutput = JSON.parse(event.data);
          outputRef.current += data.data;
          setState((prev) => ({
            ...prev,
            output: outputRef.current,
          }));
          onOutput?.(data);
        } catch (e) {
          logger.error('[SessionStream] Failed to parse output event', e);
        }
      });

      // Handle completion
      eventSource.addEventListener('complete', (event) => {
        try {
          const data: SessionStreamComplete = JSON.parse(event.data);
          outputRef.current = data.output || outputRef.current;
          setState((prev) => ({
            ...prev,
            connected: false,
            status: data.status,
            output: outputRef.current,
            exitCode: data.exitCode,
            exitSignal: data.exitSignal ?? undefined,
          }));
          onComplete?.(data);
          eventSource.close();
          eventSourceRef.current = null;
        } catch (e) {
          logger.error('[SessionStream] Failed to parse complete event', e);
        }
      });

      // Handle errors
      eventSource.addEventListener('error', (event) => {
        if (event instanceof MessageEvent) {
          try {
            const data = JSON.parse(event.data);
            setState((prev) => ({
              ...prev,
              connected: false,
              status: 'failed',
              error: data.message,
            }));
            onError?.(data.message);
          } catch {
            // Not a JSON error event
          }
        }
      });

      // Handle connection errors
      eventSource.onerror = () => {
        logger.warn('[SessionStream] Connection error');
        eventSource.close();
        eventSourceRef.current = null;

        setState((prev) => ({
          ...prev,
          connected: false,
        }));

        // Auto-reconnect if enabled and session might still be running
        if (autoReconnect) {
          reconnectTimeoutRef.current = setTimeout(() => {
            if (id) {
              connect(id);
            }
          }, 3000);
        }
      };
    },
    [onOutput, onComplete, onError, autoReconnect]
  );

  // Connect when sessionId changes
  useEffect(() => {
    if (sessionId) {
      connect(sessionId);
    } else {
      disconnect();
    }

    return () => {
      disconnect();
    };
  }, [sessionId, connect, disconnect]);

  // Expose methods
  const appendToStdin = useCallback(
    async (data: string) => {
      if (!sessionId) return false;

      try {
        const response = await fetch(`${API_BASE}/tools/sessions/${sessionId}/write`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data }),
        });
        const result = await response.json();
        return result.success;
      } catch {
        return false;
      }
    },
    [sessionId]
  );

  const kill = useCallback(async () => {
    if (!sessionId) return false;

    try {
      const response = await fetch(`${API_BASE}/tools/sessions/${sessionId}/kill`, {
        method: 'POST',
      });
      const result = await response.json();
      return result.success;
    } catch {
      return false;
    }
  }, [sessionId]);

  return {
    ...state,
    connect,
    disconnect,
    appendToStdin,
    kill,
  };
}
