/**
 * Security API Routes
 *
 * Manages security policies, DM pairing, channel allowlists,
 * exec policies, plugin permissions, and risk analysis.
 */

import { Hono } from 'hono';
import { getSecurityManager } from '../chat/execution/security.js';
import type {
  ChannelAllowlistEntry,
  ExecApprovalPolicy,
  PluginAllowlistEntry,
  ChannelPolicy,
} from '../chat/execution/types.js';

const security = new Hono();

// =============================================================================
// Security Policy
// =============================================================================

security.get('/policy', (c) => {
  const manager = getSecurityManager();
  return c.json({ success: true, data: manager.getPolicy() });
});

security.patch('/policy', async (c) => {
  const body = await c.req.json();
  const manager = getSecurityManager();
  manager.updatePolicy(body);
  return c.json({ success: true, data: manager.getPolicy() });
});

// =============================================================================
// DM Pairing
// =============================================================================

security.post('/pairing/generate', async (c) => {
  const { senderId, channelProvider } = await c.req.json();
  if (!senderId || !channelProvider) {
    return c.json({ success: false, error: 'senderId and channelProvider required' }, 400);
  }
  const manager = getSecurityManager();
  const session = manager.generatePairingCode(senderId, channelProvider);
  return c.json({ success: true, data: { code: session.code, expiresAt: session.expiresAt, verified: session.verified } });
});

security.post('/pairing/verify', async (c) => {
  const { senderId, channelProvider, code } = await c.req.json();
  if (!senderId || !channelProvider || !code) {
    return c.json({ success: false, error: 'senderId, channelProvider, and code required' }, 400);
  }
  const manager = getSecurityManager();
  const verified = manager.verifyPairingCode(senderId, channelProvider, code);
  return c.json({ success: true, data: { verified } });
});

security.get('/pairing/trusted/:senderId', (c) => {
  const senderId = c.req.param('senderId');
  const manager = getSecurityManager();
  return c.json({ success: true, data: { trusted: manager.isDMSenderTrusted(senderId) } });
});

// =============================================================================
// Channel Allowlist
// =============================================================================

security.get('/channels', (c) => {
  const manager = getSecurityManager();
  return c.json({ success: true, data: manager.getChannelAllowlist() });
});

security.post('/channels', async (c) => {
  const entry: ChannelAllowlistEntry = await c.req.json();
  if (!entry.channelId || !entry.provider) {
    return c.json({ success: false, error: 'channelId and provider required' }, 400);
  }
  entry.addedAt = entry.addedAt ?? new Date().toISOString();
  entry.enabled = entry.enabled ?? true;
  const manager = getSecurityManager();
  manager.addChannelToAllowlist(entry);
  return c.json({ success: true, data: entry });
});

security.delete('/channels/:provider/:channelId', (c) => {
  const provider = c.req.param('provider');
  const channelId = c.req.param('channelId');
  const manager = getSecurityManager();
  const removed = manager.removeChannelFromAllowlist(channelId, provider);
  return c.json({ success: true, data: { removed } });
});

// =============================================================================
// Exec Approval Policies
// =============================================================================

security.get('/exec-policies', (c) => {
  const manager = getSecurityManager();
  return c.json({ success: true, data: manager.getExecPolicies() });
});

security.post('/exec-policies', async (c) => {
  const policy: ExecApprovalPolicy = await c.req.json();
  if (!policy.id || !policy.name || !policy.action) {
    return c.json({ success: false, error: 'id, name, and action required' }, 400);
  }
  policy.priority = policy.priority ?? 0;
  policy.enabled = policy.enabled ?? true;
  const manager = getSecurityManager();
  manager.addExecPolicy(policy);
  return c.json({ success: true, data: policy });
});

security.delete('/exec-policies/:id', (c) => {
  const id = c.req.param('id');
  const manager = getSecurityManager();
  const removed = manager.removeExecPolicy(id);
  return c.json({ success: true, data: { removed } });
});

// =============================================================================
// Plugin Allowlist
// =============================================================================

security.get('/plugins', (c) => {
  const manager = getSecurityManager();
  return c.json({ success: true, data: manager.getPluginAllowlist() });
});

security.post('/plugins', async (c) => {
  const entry: PluginAllowlistEntry = await c.req.json();
  if (!entry.pluginId || !entry.name) {
    return c.json({ success: false, error: 'pluginId and name required' }, 400);
  }
  entry.addedAt = entry.addedAt ?? new Date().toISOString();
  entry.permissions = entry.permissions ?? [];
  entry.trusted = entry.trusted ?? false;
  const manager = getSecurityManager();
  manager.addPluginToAllowlist(entry);
  return c.json({ success: true, data: entry });
});

security.delete('/plugins/:pluginId', (c) => {
  const pluginId = c.req.param('pluginId');
  const manager = getSecurityManager();
  const removed = manager.removePluginFromAllowlist(pluginId);
  return c.json({ success: true, data: { removed } });
});

// =============================================================================
// Channel Policies (retry/timeout)
// =============================================================================

security.get('/channel-policies', (c) => {
  const manager = getSecurityManager();
  return c.json({ success: true, data: manager.getChannelPolicies() });
});

security.post('/channel-policies', async (c) => {
  const policy: ChannelPolicy = await c.req.json();
  if (!policy.channelId || !policy.provider) {
    return c.json({ success: false, error: 'channelId and provider required' }, 400);
  }
  policy.retryAttempts = policy.retryAttempts ?? 3;
  policy.retryDelayMs = policy.retryDelayMs ?? 1000;
  policy.timeoutMs = policy.timeoutMs ?? 300_000;
  const manager = getSecurityManager();
  manager.setChannelPolicy(policy);
  return c.json({ success: true, data: policy });
});

security.delete('/channel-policies/:provider/:channelId', (c) => {
  const provider = c.req.param('provider');
  const channelId = c.req.param('channelId');
  const manager = getSecurityManager();
  const removed = manager.removeChannelPolicy(channelId, provider);
  return c.json({ success: true, data: { removed } });
});

// =============================================================================
// Risk Analysis
// =============================================================================

security.post('/analyze-risk', async (c) => {
  const { toolName, params } = await c.req.json();
  if (!toolName) {
    return c.json({ success: false, error: 'toolName required' }, 400);
  }

  // Build a minimal tool definition for analysis
  const { getToolRegistry } = await import('../chat/execution/registry.js');
  const registry = getToolRegistry();
  const tool = registry.get(toolName);

  if (!tool) {
    return c.json({ success: false, error: `Tool not found: ${toolName}` }, 404);
  }

  const manager = getSecurityManager();
  const analysis = manager.analyzeRisk(tool, params ?? {});
  return c.json({ success: true, data: analysis });
});

// =============================================================================
// Approval Management
// =============================================================================

security.get('/approvals', (c) => {
  const conversationId = c.req.query('conversationId');
  const manager = getSecurityManager();
  return c.json({ success: true, data: manager.getPendingApprovals(conversationId) });
});

security.post('/approvals/:id/respond', async (c) => {
  const requestId = c.req.param('id');
  const { decision, userId } = await c.req.json();
  if (!decision || !['allow-once', 'allow-always', 'deny'].includes(decision)) {
    return c.json({ success: false, error: 'Valid decision required: allow-once, allow-always, deny' }, 400);
  }
  const manager = getSecurityManager();
  const handled = manager.handleApprovalResponse({ requestId, decision, userId });
  return c.json({ success: true, data: { handled } });
});

// =============================================================================
// Audit / Status
// =============================================================================

security.get('/status', (c) => {
  const manager = getSecurityManager();
  const policy = manager.getPolicy();
  return c.json({
    success: true,
    data: {
      mode: policy.mode,
      allowlistEntries: policy.allowlist?.length ?? 0,
      channelAllowlistEntries: policy.channelAllowlist?.length ?? 0,
      execPolicies: policy.execPolicies?.length ?? 0,
      pluginAllowlistEntries: policy.pluginAllowlist?.length ?? 0,
      channelPolicies: policy.channelPolicies?.length ?? 0,
      dmPairingEnabled: policy.dmPairing?.enabled ?? false,
      pendingApprovals: manager.getPendingApprovals().length,
    },
  });
});

export default security;
