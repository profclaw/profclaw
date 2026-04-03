import { getConfig } from './config.js';

export interface ApiResponse<T = unknown> {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
}

/** Ports to probe when looking for a running profClaw server. */
const CANDIDATE_PORTS = ['3000', '3001', '3002', '9100'];

let resolvedBaseUrl: string | undefined;
let detectPromise: Promise<string> | undefined;

/**
 * Auto-detect the profClaw server by probing /health on candidate ports.
 * Caches the result so subsequent calls don't re-probe.
 * Uses a shared promise to deduplicate concurrent calls.
 *
 * Exported so callers that need the base URL directly (e.g. TUI, REPL, print
 * mode) can share the same detection logic without duplicating it.
 */
export async function detectBaseUrl(): Promise<string> {
  if (resolvedBaseUrl) return resolvedBaseUrl;
  if (detectPromise) return detectPromise;
  detectPromise = doDetect();
  return detectPromise;
}

async function doDetect(): Promise<string> {

  // If PORT env is set, use it directly (user knows best)
  if (process.env.PORT) {
    resolvedBaseUrl = `http://localhost:${process.env.PORT}`;
    return resolvedBaseUrl;
  }

  // Check user-configured apiUrl from config file (not the default)
  const config = getConfig();
  const configPath = config.apiUrl;
  const isUserConfigured = configPath && configPath !== 'http://localhost:3000';
  if (isUserConfigured) {
    resolvedBaseUrl = configPath;
    return resolvedBaseUrl;
  }

  // Probe candidate ports for a running profClaw server
  for (const port of CANDIDATE_PORTS) {
    try {
      const res = await fetch(`http://localhost:${port}/health`, {
        signal: AbortSignal.timeout(1000),
      });
      if (res.ok) {
        const body = await res.json() as Record<string, unknown>;
        if (body.service === 'profclaw') {
          resolvedBaseUrl = `http://localhost:${port}`;
          return resolvedBaseUrl;
        }
      }
    } catch {
      // Port not responding or not profClaw — try next
    }
  }

  // Fallback to default
  resolvedBaseUrl = 'http://localhost:3000';
  return resolvedBaseUrl;
}

/**
 * Make an API request to the profClaw server
 */
export async function apiRequest<T = unknown>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown
): Promise<ApiResponse<T>> {
  const baseUrl = await detectBaseUrl();
  const url = `${baseUrl}${path}`;

  try {
    const config = getConfig();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Add auth token if configured
    if (config.apiToken) {
      headers['Authorization'] = `Bearer ${config.apiToken}`;
    }

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    const data = await response.json().catch(() => ({})) as Record<string, unknown>;

    if (!response.ok) {
      const errorMessage = typeof data?.error === 'string' ? data.error
        : typeof data?.message === 'string' ? data.message
        : `HTTP ${response.status}`;
      return {
        ok: false,
        status: response.status,
        error: errorMessage,
      };
    }

    return {
      ok: true,
      status: response.status,
      data: data as T,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';

    // Check for connection refused
    if (message.includes('ECONNREFUSED') || message.includes('fetch failed')) {
      return {
        ok: false,
        status: 0,
        error: `Cannot connect to profClaw server at ${baseUrl}. Is it running? Try: profclaw serve`,
      };
    }

    return {
      ok: false,
      status: 0,
      error: message,
    };
  }
}

// Convenience methods
export const api = {
  get: <T = unknown>(path: string) => apiRequest<T>('GET', path),
  post: <T = unknown>(path: string, body?: unknown) => apiRequest<T>('POST', path, body),
  patch: <T = unknown>(path: string, body?: unknown) => apiRequest<T>('PATCH', path, body),
  delete: <T = unknown>(path: string) => apiRequest<T>('DELETE', path),
};
