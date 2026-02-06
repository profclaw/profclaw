/**
 * Session Spawn Module
 *
 * Exports for the agent session hierarchy and messaging system.
 * See docs/SESSION_SPAWN.md for full documentation.
 */

export * from './types.js';
export {
  getSessionSpawnConfig,
  getRootSessionLimits,
  clearSessionSpawnConfigCache,
  type SessionSpawnConfig,
} from './config.js';
export { AgentSessionManagerImpl, getAgentSessionManager } from './manager.js';
