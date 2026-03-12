/**
 * Slack OAuth Authentication
 *
 * Handles OAuth flow for installing profClaw Slack app into workspaces.
 */

import { logger } from '../utils/logger.js';
import { getChatRegistry } from '../chat/providers/index.js';

// =============================================================================
// CONFIGURATION
// =============================================================================

const SLACK_CLIENT_ID = process.env.SLACK_CLIENT_ID || '';
const SLACK_CLIENT_SECRET = process.env.SLACK_CLIENT_SECRET || '';
const SLACK_REDIRECT_URI = process.env.SLACK_REDIRECT_URI || '';

// =============================================================================
// TYPES
// =============================================================================

export interface SlackOAuthResult {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  teamId: string;
  teamName: string;
  botUserId: string;
  scopes: string[];
}

// =============================================================================
// OAUTH FUNCTIONS
// =============================================================================

/**
 * Check if Slack OAuth is configured
 */
export function isSlackOAuthConfigured(): boolean {
  return !!(SLACK_CLIENT_ID && SLACK_CLIENT_SECRET && SLACK_REDIRECT_URI);
}

/**
 * Get Slack OAuth authorization URL
 */
export function getSlackAuthUrl(state: string): string {
  const registry = getChatRegistry();
  const provider = registry.get('slack');

  if (!provider?.auth) {
    throw new Error('Slack provider not registered or missing auth adapter');
  }

  return provider.auth.getAuthUrl(state);
}

/**
 * Handle Slack OAuth callback
 */
export async function handleSlackCallback(
  code: string,
  state: string
): Promise<SlackOAuthResult> {
  const registry = getChatRegistry();
  const provider = registry.get('slack');

  if (!provider?.auth) {
    throw new Error('Slack provider not registered or missing auth adapter');
  }

  logger.info('[Slack OAuth] Exchanging code for tokens', { state });

  const result = await provider.auth.exchangeCode(code);

  logger.info('[Slack OAuth] Successfully obtained tokens', {
    teamId: result.teamId,
    teamName: result.teamName,
  });

  // Register the account
  if (result.teamId) {
    registry.registerAccount({
      id: result.teamId,
      provider: 'slack',
      name: result.teamName || result.teamId,
      enabled: true,
      isDefault: true,
      mode: 'http',
      botToken: result.accessToken,
      teamId: result.teamId,
      teamName: result.teamName,
    });
  }

  return {
    accessToken: result.accessToken,
    refreshToken: result.refreshToken,
    expiresIn: result.expiresIn,
    teamId: result.teamId || '',
    teamName: result.teamName || '',
    botUserId: result.botUserId || '',
    scopes: [], // Would need to parse from response
  };
}

/**
 * Verify Slack webhook signature
 */
export function verifySlackSignature(
  signature: string,
  timestamp: string,
  body: string
): boolean {
  const registry = getChatRegistry();
  const provider = registry.get('slack');

  if (!provider?.auth) {
    return false;
  }

  return provider.auth.verifyWebhook(signature, timestamp, body);
}
