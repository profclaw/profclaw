import { getConfig } from './config.js';

export interface ApiResponse<T = unknown> {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
}

/**
 * Make an API request to the profClaw server
 */
export async function apiRequest<T = unknown>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown
): Promise<ApiResponse<T>> {
  const config = getConfig();
  const baseUrl = config.apiUrl || 'http://localhost:3000';
  const url = `${baseUrl}${path}`;

  try {
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
