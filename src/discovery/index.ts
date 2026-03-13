/**
 * Discovery Module
 *
 * LAN-based node discovery for profClaw instances.
 */

export { startMDNS, stopMDNS, getDiscoveredNodes, isMDNSRunning } from './mdns.js';
export type { MDNSConfig } from './mdns.js';
