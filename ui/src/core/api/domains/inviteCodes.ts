/**
 * Invite Codes API
 *
 * Admin endpoints for invite code management and registration mode
 */

const API_BASE = 'http://localhost:3000';

export interface InviteCode {
  id: string;
  createdBy: string;
  usedBy: string | null;
  usedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  label: string | null;
}

export interface InviteCodesResponse {
  invites: InviteCode[];
  total: number;
}

export interface GenerateInviteCodesInput {
  count?: number;
  label?: string;
  expiresInDays?: number;
}

export interface GeneratedCode {
  id: string;
  code: string;
  expiresAt: string | null;
}

export interface GenerateInviteCodesResponse {
  codes: GeneratedCode[];
  message: string;
}

export interface RegistrationModeResponse {
  mode: 'open' | 'invite';
  message?: string;
}

async function adminRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}/api/users${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    credentials: 'include',
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export const inviteCodesApi = {
  list: () =>
    adminRequest<InviteCodesResponse>('/admin/invites'),

  generate: (input: GenerateInviteCodesInput) =>
    adminRequest<GenerateInviteCodesResponse>('/admin/invites', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  delete: (id: string) =>
    adminRequest<{ message: string }>(`/admin/invites/${id}`, { method: 'DELETE' }),

  getRegistrationMode: () =>
    adminRequest<RegistrationModeResponse>('/admin/registration-mode'),

  setRegistrationMode: (mode: 'open' | 'invite') =>
    adminRequest<RegistrationModeResponse>('/admin/registration-mode', {
      method: 'PATCH',
      body: JSON.stringify({ mode }),
    }),
};
